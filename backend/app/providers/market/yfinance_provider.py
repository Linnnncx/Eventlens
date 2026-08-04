from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd
import yfinance as yf

from app.core.config import get_settings
from app.providers.base import ProviderUnavailable
from app.providers.market.fixture_provider import (
    DEFAULT_RANGES,
    TIMEFRAME_MAP,
    FixtureMarketDataProvider,
    aggregate_bars,
    find_universe,
    market_status_now,
    parse_dt,
    universe_profiles,
)
from app.schemas.market import Bar, MarketStatus, Quote, Snapshot, SymbolProfile


def _normalize_history_df(df: pd.DataFrame, symbol: str) -> list[Bar]:
    if df is None or df.empty:
        return []
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    bars: list[Bar] = []
    for idx, row in df.iterrows():
        try:
            ts = parse_dt(idx)
            bars.append(
                Bar(
                    symbol=symbol.upper(),
                    timestamp=ts,
                    open=float(row.get("Open", row.get("open", 0)) or 0),
                    high=float(row.get("High", row.get("high", 0)) or 0),
                    low=float(row.get("Low", row.get("low", 0)) or 0),
                    close=float(row.get("Close", row.get("close", 0)) or 0),
                    volume=float(row.get("Volume", row.get("volume", 0)) or 0),
                )
            )
        except Exception:
            continue
    return bars


from app.providers.yahoo_http import apply_proxy_env, chart_to_ohlcv, fetch_chart


class YFinanceMarketDataProvider:
    name = "yfinance"

    def __init__(self) -> None:
        self.settings = get_settings()
        self._fallback = FixtureMarketDataProvider()
        apply_proxy_env()

    async def search_symbols(self, query: str, limit: int = 20) -> list[SymbolProfile]:
        local = await self._fallback.search_symbols(query, limit)
        if len(local) >= limit:
            return local

        def _remote() -> list[SymbolProfile]:
            out: list[SymbolProfile] = list(local)
            seen = {p.symbol for p in out}
            try:
                from app.providers.yahoo_http import yahoo_get

                data = yahoo_get(
                    "https://query2.finance.yahoo.com/v1/finance/search",
                    params={"q": query, "quotesCount": limit, "newsCount": 0},
                ).json()
                for item in data.get("quotes") or []:
                    sym = str(item.get("symbol") or "").upper()
                    if not sym or sym in seen:
                        continue
                    exch = str(item.get("exchange") or item.get("exchDisp") or "")
                    out.append(
                        SymbolProfile(
                            symbol=sym,
                            name=str(item.get("shortname") or item.get("longname") or sym),
                            exchange=exch or "US",
                            assetType="equity",
                            sector="Unknown",
                            industry="Unknown",
                        )
                    )
                    seen.add(sym)
                    if len(out) >= limit:
                        break
            except Exception:
                pass
            return out[:limit]

        return await asyncio.to_thread(_remote)

    async def get_symbol_profile(self, symbol: str) -> SymbolProfile:
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

        def _info() -> SymbolProfile:
            t = yf.Ticker(symbol)
            info = {}
            try:
                info = t.info or {}
            except Exception:
                info = {}
            return SymbolProfile(
                symbol=symbol.upper(),
                name=str(info.get("shortName") or info.get("longName") or symbol.upper()),
                exchange=str(info.get("exchange") or "US"),
                assetType="equity",
                sector=str(info.get("sector") or "Unknown"),
                industry=str(info.get("industry") or "Unknown"),
            )

        try:
            return await asyncio.to_thread(_info)
        except Exception as exc:
            raise ProviderUnavailable(self.name, str(exc)) from exc

    async def get_snapshots(self, symbols: list[str]) -> list[Snapshot]:
        symbols = [s.upper() for s in symbols]
        if not symbols:
            return []

        def _one(sym: str) -> Snapshot | None:
            try:
                result = fetch_chart(sym, interval="1d", range_="5d")
                rows = chart_to_ohlcv(result)
                if not rows:
                    return None
                last = rows[-1]
                prev = rows[-2] if len(rows) > 1 else last
                price = last["close"]
                prev_close = prev["close"]
                change = price - prev_close
                pct = (change / prev_close * 100) if prev_close else 0
                meta = result.get("meta") or {}
                row = find_universe(sym) or {}
                volume = float(meta.get("regularMarketVolume") or last["volume"])
                mcap = meta.get("marketCap")
                try:
                    mcap_f = float(mcap) if mcap is not None else None
                except (TypeError, ValueError):
                    mcap_f = None
                # Prefer approximate market cap from the local universe when Yahoo omits it
                if mcap_f is None and row.get("marketCap"):
                    try:
                        mcap_f = float(row["marketCap"])
                    except (TypeError, ValueError):
                        mcap_f = None
                return Snapshot(
                    symbol=sym,
                    name=row.get("companyName", meta.get("shortName") or sym),
                    price=price,
                    previousClose=prev_close,
                    change=change,
                    changePercent=pct,
                    dayHigh=float(meta.get("regularMarketDayHigh") or last["high"]),
                    dayLow=float(meta.get("regularMarketDayLow") or last["low"]),
                    volume=volume,
                    turnover=price * volume,
                    marketCap=mcap_f,
                    sector=row.get("sector", "Unknown"),
                    assetType=row.get("assetType", "equity"),
                    indices=list(row.get("indices") or []),
                    provider=self.name,
                    timestamp=last["timestamp"],
                )
            except Exception:
                return None

        async def one(sym: str) -> Snapshot | None:
            return await asyncio.to_thread(_one, sym)

        results = await asyncio.gather(*[one(s) for s in symbols], return_exceptions=True)
        out: list[Snapshot] = []
        for r in results:
            if isinstance(r, Snapshot):
                out.append(r)
        have = {s.symbol for s in out}
        missing = [s for s in symbols if s not in have]
        if missing:
            try:
                out.extend(await self._fallback.get_snapshots(missing))
            except Exception:
                pass
        return out

    async def get_quote(self, symbol: str) -> Quote:
        symbol = symbol.upper()

        def _quote() -> Quote:
            result = fetch_chart(symbol, interval="1d", range_="5d")
            meta = result.get("meta") or {}
            rows = chart_to_ohlcv(result)
            price = meta.get("regularMarketPrice")
            if price is None and rows:
                price = rows[-1]["close"]
            if price is None:
                raise ProviderUnavailable(self.name, f"No quote for {symbol}")
            price = float(price)
            prev = float(
                meta.get("chartPreviousClose")
                or meta.get("previousClose")
                or (rows[-2]["close"] if len(rows) > 1 else price)
            )
            change = price - prev
            pct = (change / prev * 100) if prev else 0
            day_high = float(meta.get("regularMarketDayHigh") or (rows[-1]["high"] if rows else price))
            day_low = float(meta.get("regularMarketDayLow") or (rows[-1]["low"] if rows else price))
            volume = float(meta.get("regularMarketVolume") or (rows[-1]["volume"] if rows else 0))
            state = str(meta.get("marketState") or "REGULAR").lower()
            return Quote(
                symbol=symbol,
                price=price,
                previousClose=prev,
                change=change,
                changePercent=pct,
                dayHigh=day_high,
                dayLow=day_low,
                volume=volume,
                marketState=state,
                timestamp=datetime.now(timezone.utc),
                delayed=False,
                provider=self.name,
            )

        try:
            return await asyncio.to_thread(_quote)
        except Exception:
            return await self._fallback.get_quote(symbol)

    async def get_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime | None,
        end: datetime | None,
        limit: int | None,
    ) -> list[Bar]:
        symbol = symbol.upper()
        if timeframe not in TIMEFRAME_MAP and timeframe not in DEFAULT_RANGES:
            raise ProviderUnavailable(self.name, f"Unsupported timeframe {timeframe}")
        interval = TIMEFRAME_MAP.get(timeframe)
        if not interval:
            raise ProviderUnavailable(self.name, f"Unsupported timeframe {timeframe}")
        end = end or datetime.now(timezone.utc)
        start = start or (end - DEFAULT_RANGES.get(timeframe, timedelta(days=180)))
        # Clip intraday ranges to Yahoo chart limits
        if timeframe == "1Min":
            start = max(start, end - timedelta(days=7))
        elif timeframe == "5Min":
            start = max(start, end - timedelta(days=60))
        elif timeframe == "15Min":
            start = max(start, end - timedelta(days=60))
        elif timeframe == "4Hour":
            # Need denser 1h history before aggregating to 4h
            start = max(start, end - timedelta(days=730))

        def _hist() -> list[Bar]:
            result = fetch_chart(symbol, interval=interval, period1=start, period2=end)
            rows = chart_to_ohlcv(result)
            bars = [
                Bar(
                    symbol=symbol,
                    timestamp=r["timestamp"],
                    open=r["open"],
                    high=r["high"],
                    low=r["low"],
                    close=r["close"],
                    volume=r["volume"],
                )
                for r in rows
            ]
            if timeframe == "4Hour":
                bars = aggregate_bars(bars, 4 * 3600)
            if limit:
                bars = bars[-limit:]
            return bars

        try:
            bars = await asyncio.to_thread(_hist)
            if not bars:
                return await self._fallback.get_bars(symbol, timeframe, None, None, limit)
            return bars
        except Exception:
            return await self._fallback.get_bars(symbol, timeframe, None, None, limit)

    async def get_market_status(self) -> MarketStatus:
        return market_status_now()


class YFinanceRealtimeProvider:
    """Poll-based realtime with optional websocket attempt; always safe for local demo."""

    name = "yfinance"

    def __init__(self) -> None:
        self._symbols: set[str] = set()
        self._closed = False
        self._market = YFinanceMarketDataProvider()
        self.settings = get_settings()

    async def subscribe(self, symbols: list[str]) -> None:
        self._symbols.update(s.upper() for s in symbols)

    async def unsubscribe(self, symbols: list[str]) -> None:
        for s in symbols:
            self._symbols.discard(s.upper())

    async def stream(self):
        while not self._closed:
            status = market_status_now()
            delay = self.settings.yfinance_quote_refresh_seconds
            if not status.is_open:
                delay = max(delay * 4, 20)
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
            await asyncio.sleep(delay)

    async def close(self) -> None:
        self._closed = True
