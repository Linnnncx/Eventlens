"""Persistent last-known market data used for instant page and order responses."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import desc
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.database.session import MarketBarCache, MarketQuoteRow, SessionLocal
from app.schemas.market import Bar, Quote, Snapshot


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def load_quote(symbol: str) -> Quote | None:
    db = SessionLocal()
    try:
        row = (
            db.query(MarketQuoteRow)
            .filter(MarketQuoteRow.symbol == symbol.upper())
            .order_by(desc(MarketQuoteRow.updated_at))
            .first()
        )
        if row is None:
            return None
        return Quote(
            symbol=row.symbol,
            price=row.price,
            previousClose=row.previous_close,
            change=row.change,
            changePercent=row.change_percent,
            dayHigh=row.day_high,
            dayLow=row.day_low,
            volume=row.volume,
            marketState=row.market_state,
            timestamp=_aware(row.timestamp),
            delayed=True,
            provider=row.provider,
        )
    finally:
        db.close()


def load_all_quotes(limit: int = 2000) -> list[Quote]:
    db = SessionLocal()
    try:
        rows = db.query(MarketQuoteRow).order_by(desc(MarketQuoteRow.updated_at)).limit(limit).all()
        seen: set[str] = set()
        quotes: list[Quote] = []
        for row in rows:
            if row.symbol in seen:
                continue
            seen.add(row.symbol)
            quotes.append(
                Quote(
                    symbol=row.symbol,
                    price=row.price,
                    previousClose=row.previous_close,
                    change=row.change,
                    changePercent=row.change_percent,
                    dayHigh=row.day_high,
                    dayLow=row.day_low,
                    volume=row.volume,
                    marketState=row.market_state,
                    timestamp=_aware(row.timestamp),
                    delayed=True,
                    provider=row.provider,
                )
            )
        return quotes
    finally:
        db.close()


def _apply_quote(row: MarketQuoteRow, quote: Quote, updated_at: datetime) -> None:
    row.price = quote.price
    row.previous_close = quote.previous_close
    row.change = quote.change
    row.change_percent = quote.change_percent
    row.day_high = quote.day_high
    row.day_low = quote.day_low
    row.volume = quote.volume
    row.market_state = quote.market_state
    row.provider = quote.provider
    row.timestamp = quote.timestamp
    row.updated_at = updated_at


def save_quote(quote: Quote) -> None:
    db = SessionLocal()
    try:
        row = (
            db.query(MarketQuoteRow)
            .filter(MarketQuoteRow.symbol == quote.symbol.upper())
            .order_by(desc(MarketQuoteRow.updated_at))
            .first()
        )
        if row is None:
            row = MarketQuoteRow(symbol=quote.symbol.upper())
            db.add(row)
        _apply_quote(row, quote, datetime.now(timezone.utc))
        db.commit()
    finally:
        db.close()


def save_snapshots(snapshots: list[Snapshot]) -> None:
    if not snapshots:
        return
    symbols = [snapshot.symbol.upper() for snapshot in snapshots]
    db = SessionLocal()
    try:
        existing = {
            row.symbol: row
            for row in db.query(MarketQuoteRow).filter(MarketQuoteRow.symbol.in_(symbols)).all()
        }
        updated_at = datetime.now(timezone.utc)
        for snapshot in snapshots:
            quote = Quote(
                symbol=snapshot.symbol,
                price=snapshot.price,
                previousClose=snapshot.previous_close,
                change=snapshot.change,
                changePercent=snapshot.change_percent,
                dayHigh=snapshot.day_high,
                dayLow=snapshot.day_low,
                volume=snapshot.volume,
                marketState="regular",
                timestamp=snapshot.timestamp,
                delayed=False,
                provider=snapshot.provider,
            )
            row = existing.get(quote.symbol.upper())
            if row is None:
                row = MarketQuoteRow(symbol=quote.symbol.upper())
                db.add(row)
                existing[quote.symbol.upper()] = row
            _apply_quote(row, quote, updated_at)
        db.commit()
    finally:
        db.close()


def load_bars(symbol: str, timeframe: str, provider: str, limit: int) -> list[Bar]:
    db = SessionLocal()
    try:
        rows = (
            db.query(MarketBarCache)
            .filter(
                MarketBarCache.symbol == symbol.upper(),
                MarketBarCache.timeframe == timeframe,
                MarketBarCache.provider == provider,
            )
            .order_by(desc(MarketBarCache.timestamp))
            .limit(max(1, limit))
            .all()
        )
        rows.reverse()
        return [
            Bar(
                symbol=row.symbol,
                timestamp=_aware(row.timestamp),
                open=row.open,
                high=row.high,
                low=row.low,
                close=row.close,
                volume=row.volume,
                vwap=row.vwap,
            )
            for row in rows
        ]
    finally:
        db.close()


def save_bars(provider: str, symbol: str, timeframe: str, bars: list[Bar]) -> None:
    if not bars:
        return
    values = [
        {
            "provider": provider,
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "timestamp": bar.timestamp,
            "open": bar.open,
            "high": bar.high,
            "low": bar.low,
            "close": bar.close,
            "volume": bar.volume,
            "vwap": bar.vwap,
        }
        for bar in bars
    ]
    stmt = sqlite_insert(MarketBarCache).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["provider", "symbol", "timeframe", "timestamp"],
        set_={
            "open": stmt.excluded.open,
            "high": stmt.excluded.high,
            "low": stmt.excluded.low,
            "close": stmt.excluded.close,
            "volume": stmt.excluded.volume,
            "vwap": stmt.excluded.vwap,
        },
    )
    db = SessionLocal()
    try:
        db.execute(stmt)
        db.commit()
    finally:
        db.close()
