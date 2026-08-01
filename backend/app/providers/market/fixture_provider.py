from __future__ import annotations

import asyncio
import hashlib
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import pandas as pd

from app.providers.base import ProviderUnavailable
from app.schemas.market import Bar, MarketStatus, NewsItem, Quote, Snapshot, SymbolProfile

# backend/app/providers/market/this_file.py -> parents[3] == backend/
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
FIXTURE_DIR = DATA_DIR / "fixtures"
UNIVERSE_PATH = DATA_DIR / "symbol_universe.json"

TIMEFRAME_MAP = {
    "1Min": "1m",
    "5Min": "5m",
    "15Min": "15m",
    "1Hour": "1h",
    "1Day": "1d",
}

DEFAULT_RANGES = {
    "1Min": timedelta(days=5),
    "5Min": timedelta(days=30),
    "15Min": timedelta(days=60),
    "1Hour": timedelta(days=180),
    "1Day": timedelta(days=365 * 2),
}


def load_universe() -> list[dict[str, Any]]:
    with open(UNIVERSE_PATH, encoding="utf-8") as f:
        return json.load(f)


def universe_profiles() -> list[SymbolProfile]:
    rows = load_universe()
    return [
        SymbolProfile(
            symbol=r["symbol"],
            name=r["companyName"],
            exchange=r.get("exchange", "NASDAQ"),
            assetType=r.get("assetType", "equity"),
            sector=r.get("sector", "Unknown"),
            industry=r.get("industry", "Unknown"),
        )
        for r in rows
    ]


def find_universe(symbol: str) -> Optional[dict[str, Any]]:
    symbol = symbol.upper()
    for row in load_universe():
        if row["symbol"].upper() == symbol:
            return row
    return None


def content_hash(headline: str, url: str | None, published_at: str) -> str:
    raw = f"{(url or '').strip().lower()}|{headline.strip().lower()}|{published_at}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def parse_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = pd.Timestamp(value).to_pydatetime()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def market_status_now() -> MarketStatus:
    # Approximate US regular hours in ET without requiring pytz install issues
    from zoneinfo import ZoneInfo

    now = datetime.now(ZoneInfo("America/New_York"))
    weekday = now.weekday()
    minutes = now.hour * 60 + now.minute
    open_m, close_m = 9 * 60 + 30, 16 * 60
    is_open = weekday < 5 and open_m <= minutes < close_m
    if is_open:
        session = "regular"
    elif weekday < 5 and (4 * 60 <= minutes < open_m or close_m <= minutes < 20 * 60):
        session = "extended"
    else:
        session = "closed"
    return MarketStatus(isOpen=is_open, session=session)


def generate_fixture_bars(symbol: str, timeframe: str, limit: int = 300) -> list[Bar]:
    quotes_path = FIXTURE_DIR / "quotes.json"
    base_price = 100.0
    if quotes_path.exists():
        quotes = json.loads(quotes_path.read_text(encoding="utf-8"))
        if symbol in quotes:
            base_price = float(quotes[symbol]["price"])

    step = {
        "1Min": timedelta(minutes=1),
        "5Min": timedelta(minutes=5),
        "15Min": timedelta(minutes=15),
        "1Hour": timedelta(hours=1),
        "1Day": timedelta(days=1),
    }.get(timeframe, timedelta(minutes=5))

    # Anchor near a fixed demo time so news alignment works
    end = datetime(2026, 7, 30, 20, 0, tzinfo=timezone.utc)
    rng = random.Random(hash(symbol + timeframe) & 0xFFFFFFFF)
    price = base_price * 0.92
    bars: list[Bar] = []
    event_idx = max(0, limit - 40)

    for i in range(limit):
        ts = end - step * (limit - i)
        # Inject NVDA event spike around demo news time
        shock = 0.0
        if symbol == "NVDA" and timeframe in {"1Min", "5Min", "15Min"} and i >= event_idx:
            shock = 0.012 if i < event_idx + 8 else 0.002
        drift = (rng.random() - 0.48) * 0.004 + shock
        open_p = price
        close_p = max(0.5, price * (1 + drift))
        high_p = max(open_p, close_p) * (1 + rng.random() * 0.002)
        low_p = min(open_p, close_p) * (1 - rng.random() * 0.002)
        vol = 800_000 + rng.random() * 1_200_000
        if shock > 0.005:
            vol *= 3.2
        bars.append(
            Bar(
                symbol=symbol,
                timestamp=ts,
                open=round(open_p, 4),
                high=round(high_p, 4),
                low=round(low_p, 4),
                close=round(close_p, 4),
                volume=round(vol),
            )
        )
        price = close_p
    return bars


class FixtureMarketDataProvider:
    name = "fixture"

    async def search_symbols(self, query: str, limit: int = 20) -> list[SymbolProfile]:
        q = query.lower().strip()
        out: list[SymbolProfile] = []
        for p in universe_profiles():
            row = find_universe(p.symbol) or {}
            hay = f"{p.symbol} {p.name} {row.get('searchKeywords', '')}".lower()
            if q in hay:
                out.append(p)
            if len(out) >= limit:
                break
        return out

    async def get_symbol_profile(self, symbol: str) -> SymbolProfile:
        row = find_universe(symbol)
        if not row:
            raise ProviderUnavailable(self.name, f"Unknown symbol {symbol}")
        return SymbolProfile(
            symbol=row["symbol"],
            name=row["companyName"],
            exchange=row.get("exchange", "NASDAQ"),
            assetType=row.get("assetType", "equity"),
            sector=row.get("sector", "Unknown"),
            industry=row.get("industry", "Unknown"),
        )

    async def get_snapshots(self, symbols: list[str]) -> list[Snapshot]:
        quotes = json.loads((FIXTURE_DIR / "quotes.json").read_text(encoding="utf-8"))
        out: list[Snapshot] = []
        for sym in symbols:
            q = quotes.get(sym.upper())
            row = find_universe(sym) or {}
            if not q:
                continue
            out.append(
                Snapshot(
                    symbol=sym.upper(),
                    name=row.get("companyName", sym.upper()),
                    price=q["price"],
                    previousClose=q["previousClose"],
                    change=q["change"],
                    changePercent=q["changePercent"],
                    dayHigh=q.get("dayHigh", q["price"]),
                    dayLow=q.get("dayLow", q["price"]),
                    volume=q.get("volume", 0),
                    sector=row.get("sector", "Unknown"),
                    provider=self.name,
                    timestamp=parse_dt(q["timestamp"]),
                )
            )
        return out

    async def get_quote(self, symbol: str) -> Quote:
        quotes = json.loads((FIXTURE_DIR / "quotes.json").read_text(encoding="utf-8"))
        q = quotes.get(symbol.upper())
        if not q:
            # synthesize from universe
            bars = generate_fixture_bars(symbol.upper(), "5Min", 50)
            last = bars[-1]
            prev = bars[-2].close
            return Quote(
                symbol=symbol.upper(),
                price=last.close,
                previousClose=prev,
                change=last.close - prev,
                changePercent=((last.close - prev) / prev) * 100 if prev else 0,
                dayHigh=max(b.high for b in bars[-20:]),
                dayLow=min(b.low for b in bars[-20:]),
                volume=sum(b.volume for b in bars[-20:]),
                marketState="regular",
                timestamp=last.timestamp,
                delayed=True,
                provider=self.name,
            )
        return Quote(
            symbol=symbol.upper(),
            price=q["price"],
            previousClose=q["previousClose"],
            change=q["change"],
            changePercent=q["changePercent"],
            dayHigh=q["dayHigh"],
            dayLow=q["dayLow"],
            volume=q["volume"],
            marketState=q.get("marketState", "regular"),
            timestamp=parse_dt(q["timestamp"]),
            delayed=True,
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
        lim = limit or 300
        bars = generate_fixture_bars(symbol.upper(), timeframe, lim)
        if start:
            bars = [b for b in bars if b.timestamp >= start]
        if end:
            bars = [b for b in bars if b.timestamp <= end]
        return bars

    async def get_market_status(self) -> MarketStatus:
        return market_status_now()


class FixtureNewsProvider:
    name = "fixture"

    async def get_news(
        self,
        symbol: str,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> list[NewsItem]:
        data = json.loads((FIXTURE_DIR / "news.json").read_text(encoding="utf-8"))
        items = data.get(symbol.upper(), [])
        out: list[NewsItem] = []
        for raw in items[:limit]:
            published = parse_dt(raw["publishedAt"])
            if start and published < start:
                continue
            if end and published > end:
                continue
            out.append(NewsItem.model_validate(raw))
        return out


class FixtureRealtimeProvider:
    name = "fixture"

    def __init__(self) -> None:
        self._symbols: set[str] = set()
        self._closed = False

    async def subscribe(self, symbols: list[str]) -> None:
        self._symbols.update(s.upper() for s in symbols)

    async def unsubscribe(self, symbols: list[str]) -> None:
        for s in symbols:
            self._symbols.discard(s.upper())

    async def stream(self):
        market = FixtureMarketDataProvider()
        while not self._closed:
            for sym in list(self._symbols):
                try:
                    q = await market.get_quote(sym)
                    jitter = 1 + (random.random() - 0.5) * 0.001
                    yield {
                        "type": "quote",
                        "symbol": sym,
                        "price": round(q.price * jitter, 4),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "provider": self.name,
                    }
                except Exception:
                    continue
            await asyncio.sleep(5)

    async def close(self) -> None:
        self._closed = True
