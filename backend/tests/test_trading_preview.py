from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import pytest

from app.database.session import Base, OrderRow, PositionRow, WatchlistRow
from app.schemas.market import OrderModifyRequest, OrderPreviewRequest
from app.services.trading import (
    cancel_open_order,
    ensure_positions_watchlisted,
    modify_open_order,
    preview_order,
)


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


@pytest.mark.asyncio
async def test_open_limit_order_can_be_modified_and_canceled():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    now = datetime.now(timezone.utc)
    try:
        db.add(
            OrderRow(
                id="open-order",
                symbol="AAPL",
                side="buy",
                order_type="limit",
                quantity=2,
                limit_price=100,
                status="open",
                created_at=now,
            )
        )
        db.commit()

        modified = await modify_open_order(
            db,
            "open-order",
            OrderModifyRequest(quantity=3, limitPrice=95.5),
        )
        assert modified["quantity"] == 3
        assert modified["limitPrice"] == 95.5
        assert modified["status"] == "open"

        canceled = cancel_open_order(db, "open-order")
        assert canceled["status"] == "canceled"

        with pytest.raises(ValueError, match="unfilled"):
            await modify_open_order(
                db,
                "open-order",
                OrderModifyRequest(quantity=4, limitPrice=90),
            )
    finally:
        db.close()
