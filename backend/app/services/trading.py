from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database.session import OrderRow, PortfolioRow, PositionRow, TradeRow
from app.providers.factory import provider_factory
from app.providers.llm.providers import RuleBasedLLMProvider
from app.providers.market.fixture_provider import find_universe
from app.schemas.market import OrderPreviewRequest, OrderPreviewResponse, PortfolioState, RiskSummary


FEE_RATE = 0.0005


def ensure_portfolio(db: Session) -> PortfolioRow:
    row = db.query(PortfolioRow).first()
    if row:
        return row
    settings = get_settings()
    row = PortfolioRow(
        cash=settings.initial_cash,
        initial_cash=settings.initial_cash,
        updated_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


async def _latest_price(symbol: str) -> float:
    market = provider_factory.create_market_provider()
    q = await market.get_quote(symbol)
    return q.price


def _positions_mv(db: Session, prices: dict[str, float]) -> tuple[float, dict[str, float]]:
    positions = db.query(PositionRow).all()
    mv = 0.0
    sector_mv: dict[str, float] = {}
    for p in positions:
        px = prices.get(p.symbol, p.avg_cost)
        val = p.quantity * px
        mv += val
        sector_mv[p.sector] = sector_mv.get(p.sector, 0) + val
    return mv, sector_mv


async def build_portfolio_state(db: Session) -> PortfolioState:
    port = ensure_portfolio(db)
    positions = db.query(PositionRow).all()
    prices: dict[str, float] = {}
    market = provider_factory.create_market_provider()
    for p in positions:
        try:
            prices[p.symbol] = (await market.get_quote(p.symbol)).price
        except Exception:
            prices[p.symbol] = p.avg_cost
    mv, sector_mv = _positions_mv(db, prices)
    equity = port.cash + mv
    sector_weights = {k: (v / equity if equity else 0) for k, v in sector_mv.items()}
    pos_payload = []
    for p in positions:
        px = prices.get(p.symbol, p.avg_cost)
        pos_payload.append(
            {
                "symbol": p.symbol,
                "quantity": p.quantity,
                "avgCost": p.avg_cost,
                "price": px,
                "marketValue": p.quantity * px,
                "pnl": (px - p.avg_cost) * p.quantity,
                "pnlPercent": ((px - p.avg_cost) / p.avg_cost * 100) if p.avg_cost else 0,
                "weight": (p.quantity * px / equity) if equity else 0,
                "sector": p.sector,
            }
        )
    pnl = equity - port.initial_cash
    return PortfolioState(
        cash=port.cash,
        equity=equity,
        marketValue=mv,
        initialCash=port.initial_cash,
        pnl=pnl,
        pnlPercent=(pnl / port.initial_cash * 100) if port.initial_cash else 0,
        positions=pos_payload,
        sectorWeights=sector_weights,
    )


def evaluate_risk_rules(facts: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    if facts.get("positionWeightAfter", 0) > 0.25:
        warnings.append("single_position_concentration")
    if facts.get("sectorWeightAfter", 0) > 0.5:
        warnings.append("sector_concentration")
    if facts.get("cashRatioAfter", 1) < 0.1:
        warnings.append("low_cash_ratio")
    if facts.get("orderPctOfEquity", 0) > 0.2:
        warnings.append("large_order_size")
    if abs(facts.get("priceChangeSinceEvent") or 0) > 0.05:
        warnings.append("post_event_volatility")
    if (facts.get("volumeRatio") or 0) > 3:
        warnings.append("high_volume_spike")
    if not facts.get("hasStopLoss"):
        warnings.append("missing_stop_loss")
    if (facts.get("minutesSinceEvent") or 9999) < 60 and facts.get("eventImportance") == "high":
        warnings.append("fresh_major_event")
    return warnings


async def preview_order(db: Session, req: OrderPreviewRequest) -> OrderPreviewResponse:
    port = ensure_portfolio(db)
    price = req.limit_price if req.order_type == "limit" and req.limit_price else await _latest_price(req.symbol)
    if req.quantity and req.quantity > 0:
        qty = float(req.quantity)
    elif req.notional and req.notional > 0:
        qty = float(req.notional) / price
    else:
        return OrderPreviewResponse(
            estimatedValue=0,
            estimatedFee=0,
            cashBefore=port.cash,
            cashAfter=port.cash,
            positionWeightBefore=0,
            positionWeightAfter=0,
            sectorWeightAfter=0,
            cashRatioAfter=1,
            orderPctOfEquity=0,
            price=price,
            quantity=0,
            ruleWarnings=[],
            risk=RiskSummary(summary="请输入数量或金额", riskLevel="low", attentionPoints=[], disclaimer=""),
            canSubmit=False,
            rejectReason="缺少数量或金额",
        )

    value = qty * price
    fee = value * FEE_RATE
    state = await build_portfolio_state(db)
    pos = next((p for p in state.positions if p["symbol"] == req.symbol.upper()), None)
    pos_val_before = pos["marketValue"] if pos else 0
    weight_before = pos["weight"] if pos else 0
    sector = (find_universe(req.symbol) or {}).get("sector", "Unknown")

    if req.side == "buy":
        cash_after = port.cash - value - fee
        pos_val_after = pos_val_before + value
        reject = None if cash_after >= -1e-6 else "可用现金不足"
    else:
        held = pos["quantity"] if pos else 0
        if qty > held + 1e-9:
            reject = "可卖数量不足"
            cash_after = port.cash
            pos_val_after = pos_val_before
        else:
            reject = None
            cash_after = port.cash + value - fee
            pos_val_after = max(0.0, pos_val_before - value)

    equity_after = state.equity  # approximate with current equity +/- cash effects
    if req.side == "buy":
        equity_after = state.equity  # cash->stock
    else:
        equity_after = state.equity
    # More accurate equity after: cash_after + (market_value - pos_val_before + pos_val_after)
    equity_after = cash_after + (state.market_value - pos_val_before + pos_val_after)
    weight_after = (pos_val_after / equity_after) if equity_after else 0
    sector_after_val = state.sector_weights.get(sector, 0) * state.equity
    if req.side == "buy":
        sector_after_val = sector_after_val - pos_val_before + pos_val_after
    else:
        sector_after_val = max(0.0, sector_after_val - (pos_val_before - pos_val_after))
    sector_weight_after = (sector_after_val / equity_after) if equity_after else 0
    cash_ratio = (cash_after / equity_after) if equity_after else 0
    order_pct = (value / state.equity) if state.equity else 0

    facts = {
        "symbol": req.symbol.upper(),
        "orderSide": req.side,
        "orderValue": value,
        "positionWeightBefore": weight_before,
        "positionWeightAfter": weight_after,
        "sectorWeightAfter": sector_weight_after,
        "cashRatioAfter": cash_ratio,
        "orderPctOfEquity": order_pct,
        "priceChangeSinceEvent": None,
        "volumeRatio": None,
        "minutesSinceEvent": 9999,
        "hasStopLoss": req.stop_loss is not None,
        "eventImportance": "medium",
    }
    warnings = evaluate_risk_rules(facts)
    facts["ruleWarnings"] = warnings
    llm = provider_factory.create_llm_provider()
    try:
        risk = await llm.generate_risk_summary(facts)
    except Exception:
        risk = await RuleBasedLLMProvider().generate_risk_summary(facts)

    return OrderPreviewResponse(
        estimatedValue=value,
        estimatedFee=fee,
        cashBefore=port.cash,
        cashAfter=cash_after,
        positionWeightBefore=weight_before,
        positionWeightAfter=weight_after,
        sectorWeightAfter=sector_weight_after,
        cashRatioAfter=cash_ratio,
        orderPctOfEquity=order_pct,
        price=price,
        quantity=qty,
        ruleWarnings=warnings,
        risk=risk,
        canSubmit=reject is None and qty > 0,
        rejectReason=reject,
    )


async def simulate_order(db: Session, req: OrderPreviewRequest) -> dict[str, Any]:
    preview = await preview_order(db, req)
    if not preview.can_submit:
        raise ValueError(preview.reject_reason or "订单无法提交")

    port = ensure_portfolio(db)
    now = datetime.now(timezone.utc)
    order_id = str(uuid.uuid4())
    trade_id = str(uuid.uuid4())
    symbol = req.symbol.upper()
    qty = preview.quantity
    price = preview.price
    fee = preview.estimated_fee
    sector = (find_universe(symbol) or {}).get("sector", "Unknown")

    status = "filled"
    filled_price = price
    if req.order_type == "limit" and req.limit_price is not None:
        # Keep working if not immediately marketable; for demo fill if marketable else open
        live = await _latest_price(symbol)
        marketable = (req.side == "buy" and live <= req.limit_price) or (
            req.side == "sell" and live >= req.limit_price
        )
        if not marketable:
            status = "open"
            filled_price = None

    order = OrderRow(
        id=order_id,
        symbol=symbol,
        side=req.side,
        order_type=req.order_type,
        quantity=qty,
        limit_price=req.limit_price,
        stop_loss=req.stop_loss,
        take_profit=req.take_profit,
        status=status,
        filled_price=filled_price,
        filled_at=now if status == "filled" else None,
        news_id=req.news_id,
        created_at=now,
    )
    db.add(order)

    if status == "filled":
        assert filled_price is not None
        if req.side == "buy":
            port.cash -= qty * filled_price + fee
            pos = db.query(PositionRow).filter(PositionRow.symbol == symbol).first()
            if pos:
                new_qty = pos.quantity + qty
                pos.avg_cost = (pos.avg_cost * pos.quantity + filled_price * qty) / new_qty
                pos.quantity = new_qty
                pos.updated_at = now
            else:
                db.add(
                    PositionRow(
                        symbol=symbol,
                        quantity=qty,
                        avg_cost=filled_price,
                        sector=sector,
                        updated_at=now,
                    )
                )
        else:
            port.cash += qty * filled_price - fee
            pos = db.query(PositionRow).filter(PositionRow.symbol == symbol).first()
            if not pos or pos.quantity < qty:
                raise ValueError("可卖数量不足")
            pos.quantity -= qty
            pos.updated_at = now
            if pos.quantity <= 1e-9:
                db.delete(pos)
        db.add(
            TradeRow(
                id=trade_id,
                order_id=order_id,
                symbol=symbol,
                side=req.side,
                quantity=qty,
                price=filled_price,
                fee=fee,
                created_at=now,
            )
        )
    port.updated_at = now
    db.commit()
    return {"orderId": order_id, "status": status, "preview": preview.model_dump(by_alias=True)}


def reset_demo(db: Session) -> None:
    settings = get_settings()
    db.query(TradeRow).delete()
    db.query(OrderRow).delete()
    db.query(PositionRow).delete()
    port = db.query(PortfolioRow).first()
    if port:
        port.cash = settings.initial_cash
        port.initial_cash = settings.initial_cash
        port.updated_at = datetime.now(timezone.utc)
    else:
        db.add(
            PortfolioRow(
                cash=settings.initial_cash,
                initial_cash=settings.initial_cash,
                updated_at=datetime.now(timezone.utc),
            )
        )
    db.commit()
