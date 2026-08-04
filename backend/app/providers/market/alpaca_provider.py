from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import get_settings
from app.providers.base import ProviderUnavailable
from app.providers.market.fixture_provider import market_status_now, parse_dt
from app.schemas.market import Bar, MarketStatus, Quote, Snapshot, SymbolProfile

ALPACA_DATA = "https://data.alpaca.markets"


class AlpacaMarketDataProvider:
    name = "alpaca"

    def __init__(self) -> None:
        self.settings = get_settings()
        if not self.settings.alpaca_configured:
            # Still constructable; methods raise clear errors
            pass

    def _headers(self) -> dict[str, str]:
        if not self.settings.alpaca_configured:
            raise ProviderUnavailable(self.name, "ALPACA_API_KEY/SECRET not configured")
        return {
            "APCA-API-KEY-ID": self.settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": self.settings.alpaca_api_secret,
        }

    async def search_symbols(self, query: str, limit: int = 20) -> list[SymbolProfile]:
        # Alpaca assets search via paper/broker API is separate; map via universe + remote bars probe
        from app.providers.market.fixture_provider import FixtureMarketDataProvider

        return await FixtureMarketDataProvider().search_symbols(query, limit)

    async def get_symbol_profile(self, symbol: str) -> SymbolProfile:
        from app.providers.market.fixture_provider import find_universe

        row = find_universe(symbol)
        if row:
            return SymbolProfile(
                symbol=row["symbol"],
                name=row["companyName"],
                exchange=row.get("exchange", "NASDAQ"),
                assetType=row.get("assetType", "equity"),
                sector=row.get("sector", "Unknown"),
                industry=row.get("industry", "Unknown"),
            )
        return SymbolProfile(symbol=symbol.upper(), name=symbol.upper())

    async def get_snapshots(self, symbols: list[str]) -> list[Snapshot]:
        headers = self._headers()
        syms = ",".join(s.upper() for s in symbols)

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{ALPACA_DATA}/v2/stocks/snapshots",
                params={"symbols": syms, "feed": self.settings.alpaca_feed},
                headers=headers,
            )
            if resp.status_code >= 400:
                raise ProviderUnavailable(self.name, f"snapshots failed: {resp.text}")
            data = resp.json()

        out: list[Snapshot] = []
        for sym, payload in data.items():
            daily = payload.get("dailyBar") or {}
            prev = payload.get("prevDailyBar") or {}
            latest = payload.get("latestTrade") or {}
            price = float(latest.get("p") or daily.get("c") or 0)
            prev_close = float(prev.get("c") or price)
            change = price - prev_close
            pct = (change / prev_close * 100) if prev_close else 0
            out.append(
                Snapshot(
                    symbol=sym,
                    name=sym,
                    price=price,
                    previousClose=prev_close,
                    change=change,
                    changePercent=pct,
                    dayHigh=float(daily.get("h") or price),
                    dayLow=float(daily.get("l") or price),
                    volume=float(daily.get("v") or 0),
                    turnover=price * float(daily.get("v") or 0),
                    provider=self.name,
                    timestamp=parse_dt(latest.get("t") or datetime.now(timezone.utc)),
                )
            )
        return out

    async def get_quote(self, symbol: str) -> Quote:
        snaps = await self.get_snapshots([symbol])
        if not snaps:
            raise ProviderUnavailable(self.name, f"No quote for {symbol}")
        s = snaps[0]
        return Quote(
            symbol=s.symbol,
            price=s.price,
            previousClose=s.previous_close,
            change=s.change,
            changePercent=s.change_percent,
            dayHigh=s.day_high,
            dayLow=s.day_low,
            volume=s.volume,
            marketState="regular",
            timestamp=s.timestamp,
            delayed=False,
            provider=self.name,
        )

    async def get_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime | None,
        end: datetime | None,
        limit: int | None,
    ) -> list[Bar]:
        headers = self._headers()
        tf_map = {
            "1Min": "1Min",
            "5Min": "5Min",
            "15Min": "15Min",
            "1Hour": "1Hour",
            "4Hour": "4Hour",
            "1Day": "1Day",
            "1Month": "1Month",
        }
        if timeframe not in tf_map:
            raise ProviderUnavailable(self.name, f"Unsupported timeframe {timeframe}")
        params: dict[str, Any] = {
            "timeframe": tf_map[timeframe],
            "adjustment": "raw",
            "feed": self.settings.alpaca_feed,
            "limit": limit or 1000,
        }
        if start:
            params["start"] = start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        if end:
            params["end"] = end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{ALPACA_DATA}/v2/stocks/{symbol.upper()}/bars",
                params=params,
                headers=headers,
            )
            if resp.status_code >= 400:
                raise ProviderUnavailable(self.name, f"bars failed: {resp.text}")
            payload = resp.json()
        bars_raw = payload.get("bars") or []
        return [
            Bar(
                symbol=symbol.upper(),
                timestamp=parse_dt(b["t"]),
                open=float(b["o"]),
                high=float(b["h"]),
                low=float(b["l"]),
                close=float(b["c"]),
                volume=float(b["v"]),
                vwap=float(b["vw"]) if b.get("vw") is not None else None,
            )
            for b in bars_raw
        ]

    async def get_market_status(self) -> MarketStatus:
        return market_status_now()


class AlpacaRealtimeProvider:
    name = "alpaca"

    def __init__(self) -> None:
        self.settings = get_settings()
        self._symbols: set[str] = set()
        self._closed = False
        self._market = AlpacaMarketDataProvider()

    async def subscribe(self, symbols: list[str]) -> None:
        if not self.settings.alpaca_configured:
            raise ProviderUnavailable(self.name, "ALPACA_API_KEY/SECRET not configured")
        self._symbols.update(s.upper() for s in symbols)

    async def unsubscribe(self, symbols: list[str]) -> None:
        for s in symbols:
            self._symbols.discard(s.upper())

    async def stream(self):
        if not self.settings.alpaca_configured:
            raise ProviderUnavailable(self.name, "ALPACA_API_KEY/SECRET not configured")
        # Polling fallback implementing same message shape as yfinance realtime
        while not self._closed:
            for sym in list(self._symbols):
                try:
                    q = await self._market.get_quote(sym)
                    yield {
                        "type": "quote",
                        "symbol": sym,
                        "price": q.price,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "provider": self.name,
                    }
                except Exception:
                    continue
            await asyncio.sleep(5)

    async def close(self) -> None:
        self._closed = True
