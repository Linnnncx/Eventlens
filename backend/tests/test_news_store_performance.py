import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database.session import Base
from app.services import news_store


@pytest.mark.asyncio
async def test_cold_news_returns_recent_window_and_backfills_history(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    calls: list[tuple[str, datetime | None, int]] = []

    async def fake_fetch(symbol, start, end, limit):
        calls.append(("cold", start, limit))
        return [], "fake"

    async def fake_refresh(symbol, start, end, limit):
        calls.append(("backfill", start, limit))

    monkeypatch.setattr(news_store, "_fetch_upstream", fake_fetch)
    monkeypatch.setattr(news_store, "_refresh", fake_refresh)
    requested_start = datetime.now(timezone.utc) - timedelta(days=470)
    try:
        items, provider, cached = await news_store.get_news_window(
            db,
            "AAPL",
            requested_start,
            None,
            800,
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
    finally:
        db.close()

    assert items == []
    assert provider == "fake"
    assert cached is False
    assert calls[0][0] == "cold"
    assert calls[0][1] is not None
    assert calls[0][1] > datetime.now(timezone.utc) - timedelta(days=15)
    assert calls[0][2] == news_store.COLD_START_LIMIT
    assert ("backfill", requested_start, 800) in calls
