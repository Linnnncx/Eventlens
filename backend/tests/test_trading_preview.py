from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import pytest

from app.database.session import Base, PositionRow, WatchlistRow
from app.schemas.market import OrderPreviewRequest
from app.services.trading import ensure_positions_watchlisted, preview_order


@pytest.mark.asyncio
async def test_preview_uses_page_reference_price_without_market_request(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    monkeypatch.setattr("app.services.equity_history.ensure_baseline", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.services.equity_history.record_equity_snapshot", lambda *_args, **_kwargs: None)
    try:
        result = await preview_order(
            db,
            OrderPreviewRequest(
                symbol="AAPL",
                side="buy",
                orderType="market",
                quantity=2,
                referencePrice=303.42,
            ),
        )
    finally:
        db.close()

    assert result.price == 303.42
    assert result.quantity == 2
    assert result.can_submit is True
    assert result.estimated_value == pytest.approx(606.84)


def test_open_positions_are_automatically_added_to_watchlist():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        db.add(
            PositionRow(
                symbol="NVDA",
                quantity=3,
                avg_cost=100,
                sector="Technology",
                updated_at=datetime.now(timezone.utc),
            )
        )
        db.commit()

        symbols = ensure_positions_watchlisted(db)

        assert symbols == ["NVDA"]
        assert db.query(WatchlistRow).filter(WatchlistRow.symbol == "NVDA").count() == 1
    finally:
        db.close()
