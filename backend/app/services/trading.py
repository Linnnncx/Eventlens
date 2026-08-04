from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, time, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database.session import OrderRow, PortfolioRow, PositionRow, TradeRow, WatchlistRow
from app.providers.llm.providers import RuleBasedLLMProvider
from app.providers.market.fixture_provider import find_universe
from app.schemas.market import OrderPreviewRequest, OrderPreviewResponse, PortfolioState, RiskSummary
from app.services.fees import calc_futu_us_fee
from app.services.market_hub import get_shared_quote

ET = ZoneInfo("America/New_York")


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


def ensure_positions_watchlisted(db: Session) -> list[str]:
    """Persist every open position in the watchlist and return the normalized list."""
    held = {
        symbol.upper()
        for (symbol,) in db.query(PositionRow.symbol).filter(PositionRow.quantity > 1e-9).all()
    }
    existing = {symbol.upper() for (symbol,) in db.query(WatchlistRow.symbol).all()}
    now = datetime.now(timezone.utc)
    for symbol in held - existing:
        db.add(WatchlistRow(symbol=symbol, created_at=now))
    if held - existing:
        db.commit()
    return [
        row.symbol
        for row in db.query(WatchlistRow).order_by(WatchlistRow.created_at.desc()).all()
    ]


async def _latest_price(symbol: str) -> float:
    q, _provider, _cached = await get_shared_quote(symbol, max_age=3.0)
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


def _et_day_start_utc(now: datetime | None = None) -> datetime:
    now_et = (now or datetime.now(timezone.utc)).astimezone(ET)
    start_et = datetime.combine(now_et.date(), time.min, tzinfo=ET)
    return start_et.astimezone(timezone.utc)


def _fill_fee(side: str, quantity: float, price: float) -> float:
    return float(calc_futu_us_fee(side, quantity, price)["total"])


def _trade_ledger(db: Session) -> dict[str, dict[str, float]]:
    """Replay fills → per-symbol qty/cost basis and realized PnL (sells vs avg cost)."""
    trades = db.query(TradeRow).order_by(TradeRow.created_at.asc(), TradeRow.id.asc()).all()
    ledger: dict[str, dict[str, float]] = {}
    for r in trades:
        st = ledger.setdefault(r.symbol, {"qty": 0.0, "cost": 0.0, "realized": 0.0})
        fee = _fill_fee(r.side, r.quantity, r.price)
        if r.side == "buy":
            st["cost"] += r.quantity * r.price + fee
            st["qty"] += r.quantity
        elif st["qty"] > 0:
            avg = st["cost"] / st["qty"]
            sell_qty = min(r.quantity, st["qty"])
            # Realized = (sell proceeds − sell fee) − cost basis of shares sold.
            st["realized"] += sell_qty * r.price - fee - avg * sell_qty
            st["cost"] -= avg * sell_qty
            st["qty"] -= sell_qty
            if st["qty"] <= 1e-9:
                st["qty"] = 0.0
                st["cost"] = 0.0
    return ledger


def sync_position_costs_from_trades(db: Session) -> None:
    """Rebuild avg cost so buy commissions are amortized into cost basis."""
    positions = {p.symbol: p for p in db.query(PositionRow).all()}
    if not positions:
        return
    ledger = _trade_ledger(db)

    dirty = False
    for symbol, pos in positions.items():
        st = ledger.get(symbol)
        if not st or st["qty"] <= 1e-9:
            continue
        new_avg = st["cost"] / st["qty"]
        if abs(new_avg - pos.avg_cost) > 1e-6:
            pos.avg_cost = new_avg
            dirty = True
    if dirty:
        db.commit()


def _today_flow_by_symbol(db: Session) -> dict[str, dict[str, float]]:
    """Aggregate today's buy/sell share counts per symbol (US/Eastern session day)."""
    start = _et_day_start_utc()
    rows = db.query(TradeRow).filter(TradeRow.created_at >= start).all()
    out: dict[str, dict[str, float]] = {}
    for r in rows:
        bucket = out.setdefault(r.symbol, {"buyQty": 0.0, "sellQty": 0.0, "buyNotional": 0.0})
        if r.side == "buy":
            fee = _fill_fee(r.side, r.quantity, r.price)
            bucket["buyQty"] += r.quantity
            # Include buy fees so today's cost basis matches position avg cost.
            bucket["buyNotional"] += r.quantity * r.price + fee
        else:
            bucket["sellQty"] += r.quantity
    return out


def _today_pnl(
    quantity: float,
    avg_cost: float,
    price: float,
    previous_close: float,
    flow: dict[str, float] | None,
) -> tuple[float, float]:
    """Today's P&L.

    Overnight shares mark vs previous close; shares bought today mark vs today's
    buy cost. Pure same-day opens therefore match floating P&L (vs cost), not
    the stock's gap from yesterday's close.
    """
    buy_qty = float((flow or {}).get("buyQty") or 0.0)
    sell_qty = float((flow or {}).get("sellQty") or 0.0)
    buy_notional = float((flow or {}).get("buyNotional") or 0.0)
    # Approximate opening inventory before today's activity.
    overnight_qty = max(0.0, quantity - buy_qty + sell_qty)
    today_bought_held = max(0.0, quantity - overnight_qty)
    today_buy_avg = (buy_notional / buy_qty) if buy_qty > 0 else avg_cost

    overnight_pnl = (price - previous_close) * overnight_qty
    intraday_pnl = (price - today_buy_avg) * today_bought_held
    today = overnight_pnl + intraday_pnl

    # Percent: overnight vs prev close, today's buys vs buy avg, weighted by shares.
    if quantity <= 0:
        return 0.0, 0.0
    if overnight_qty <= 0 and today_bought_held > 0:
        pct = ((price - today_buy_avg) / today_buy_avg * 100) if today_buy_avg else 0.0
    elif today_bought_held <= 0:
        pct = ((price - previous_close) / previous_close * 100) if previous_close else 0.0
    else:
        ref = (
            previous_close * overnight_qty + today_buy_avg * today_bought_held
        ) / quantity
        pct = ((price - ref) / ref * 100) if ref else 0.0
    return today, pct


async def build_portfolio_state(
    db: Session,
    price_overrides: dict[str, float] | None = None,
) -> PortfolioState:
    port = ensure_portfolio(db)
    positions = db.query(PositionRow).all()
    prices: dict[str, float] = {}
    prev_closes: dict[str, float] = {}
    async def _quote_one(symbol: str, fallback: float) -> tuple[str, float, float]:
        override = (price_overrides or {}).get(symbol)
        if override is not None and override > 0:
            return symbol, override, fallback
        try:
            q, _provider, _cached = await get_shared_quote(symbol, max_age=5.0)
            return symbol, q.price, q.previous_close or fallback
        except Exception:
            return symbol, fallback, fallback

    quoted = await asyncio.gather(*[_quote_one(p.symbol, p.avg_cost) for p in positions])
    for symbol, px, prev in quoted:
        prices[symbol] = px
        prev_closes[symbol] = prev
    mv, sector_mv = _positions_mv(db, prices)
    equity = port.cash + mv
    sector_weights = {k: (v / equity if equity else 0) for k, v in sector_mv.items()}
    today_flow = _today_flow_by_symbol(db)
    realized_by_symbol = {
        sym: float(st.get("realized") or 0.0) for sym, st in _trade_ledger(db).items()
    }
    pos_payload = []
    for p in positions:
        px = prices.get(p.symbol, p.avg_cost)
        prev = prev_closes.get(p.symbol, p.avg_cost)
        cost_value = p.avg_cost * p.quantity
        market_value = p.quantity * px
        floating = market_value - cost_value
        floating_pct = ((px - p.avg_cost) / p.avg_cost * 100) if p.avg_cost else 0.0
        today, today_pct = _today_pnl(p.quantity, p.avg_cost, px, prev, today_flow.get(p.symbol))
        # Paper long-only: holding PnL tracks mark-to-cost (same as floating).
        holding = floating
        holding_pct = floating_pct
        realized = realized_by_symbol.get(p.symbol, 0.0)
        pos_payload.append(
            {
                "symbol": p.symbol,
                "quantity": p.quantity,
                "availableQuantity": p.quantity,
                "avgCost": p.avg_cost,
                "costValue": cost_value,
                "price": px,
                "previousClose": prev,
                "marketValue": market_value,
                "pnl": floating,
                "pnlPercent": floating_pct,
                "floatingPnl": floating,
                "floatingPnlPercent": floating_pct,
                "todayPnl": today,
                "todayPnlPercent": today_pct,
                "holdingPnl": holding,
                "holdingPnlPercent": holding_pct,
                "realizedPnl": realized,
                "weight": (market_value / equity) if equity else 0,
                "sector": p.sector,
            }
        )
    pnl = equity - port.initial_cash
    try:
        from app.services.equity_history import ensure_baseline, record_equity_snapshot

        ensure_baseline(port.initial_cash)
        record_equity_snapshot(equity, port.cash, mv)
    except Exception:
        pass
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


def closed_position_rankings(db: Session, limit: int = 20) -> list[dict[str, Any]]:
    """Fully closed symbols ranked by realized PnL (desc)."""
    ledger = _trade_ledger(db)
    open_symbols = {p.symbol for p in db.query(PositionRow).all() if p.quantity > 1e-9}
    rows: list[dict[str, Any]] = []
    for sym, st in ledger.items():
        qty = float(st.get("qty") or 0)
        realized = float(st.get("realized") or 0)
        if abs(qty) > 1e-9 or sym in open_symbols:
            continue
        if abs(realized) < 1e-9:
            continue
        rows.append({"symbol": sym, "realizedPnl": round(realized, 4), "closed": True})
    rows.sort(key=lambda r: r["realizedPnl"], reverse=True)
    return rows[: max(1, min(limit, 50))]


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def serialize_order(row: OrderRow, fee: float | None = None) -> dict[str, Any]:
    return {
        "id": row.id,
        "symbol": row.symbol,
        "side": row.side,
        "orderType": row.order_type,
        "quantity": row.quantity,
        "limitPrice": row.limit_price,
        "stopLoss": row.stop_loss,
        "takeProfit": row.take_profit,
        "status": row.status,
        "filledPrice": row.filled_price,
        "filledAt": _iso(row.filled_at),
        "fee": fee,
        "newsId": row.news_id,
        "createdAt": _iso(row.created_at) or "",
    }


def list_orders(db: Session, limit: int = 100) -> list[dict[str, Any]]:
    rows = db.query(OrderRow).order_by(OrderRow.created_at.desc()).limit(limit).all()
    if not rows:
        return []
    order_ids = [r.id for r in rows]
    fee_rows = (
        db.query(TradeRow.order_id, TradeRow.fee)
        .filter(TradeRow.order_id.in_(order_ids))
        .all()
    )
    fees = {oid: float(fee) for oid, fee in fee_rows}
    return [serialize_order(r, fees.get(r.id)) for r in rows]


def list_trades(db: Session, limit: int = 100) -> list[dict[str, Any]]:
    rows = db.query(TradeRow).order_by(TradeRow.created_at.desc()).limit(limit).all()
    if not rows:
        return []
    order_ids = [r.order_id for r in rows]
    orders = {
        o.id: o
        for o in db.query(OrderRow).filter(OrderRow.id.in_(order_ids)).all()
    }
    items: list[dict[str, Any]] = []
    for r in rows:
        order = orders.get(r.order_id)
        notional = r.quantity * r.price
        fee_info = calc_futu_us_fee(r.side, r.quantity, r.price)
        items.append(
            {
                "id": r.id,
                "orderId": r.order_id,
                "symbol": r.symbol,
                "side": r.side,
                "quantity": r.quantity,
                "price": r.price,
                "fee": fee_info["total"],
                "feeBreakdown": {
                    "commission": fee_info["commission"],
                    "platformFee": fee_info["platformFee"],
                    "clearingFee": fee_info["clearingFee"],
                    "taf": fee_info["taf"],
                    "schedule": fee_info["schedule"],
                },
                "notional": notional,
                "orderType": order.order_type if order else None,
                "orderCreatedAt": _iso(order.created_at) if order else None,
                "filledAt": _iso(r.created_at),
                "createdAt": _iso(r.created_at),
            }
        )
    return items


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
    price = (
        req.limit_price
        if req.order_type == "limit" and req.limit_price
        else req.reference_price
        if req.reference_price and req.reference_price > 0
        else await _latest_price(req.symbol)
    )
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
    fee_info = calc_futu_us_fee(req.side, qty, price)
    fee = float(fee_info["total"])
    state = await build_portfolio_state(db, {req.symbol.upper(): price})
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
    # Order previews are latency-sensitive and are recomputed while the user edits
    # the form. Keep the same deterministic risk facts/warnings, but never block
    # the confirm button on a cloud LLM round-trip (which can take 10–30 seconds).
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
        live = req.reference_price if req.reference_price and req.reference_price > 0 else await _latest_price(symbol)
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
            # Amortize buy fees into average cost: (Σ price·qty + Σ fees) / qty
            lot_cost = filled_price * qty + fee
            pos = db.query(PositionRow).filter(PositionRow.symbol == symbol).first()
            if pos:
                new_qty = pos.quantity + qty
                pos.avg_cost = (pos.avg_cost * pos.quantity + lot_cost) / new_qty
                pos.quantity = new_qty
                pos.updated_at = now
            else:
                db.add(
                    PositionRow(
                        symbol=symbol,
                        quantity=qty,
                        avg_cost=lot_cost / qty,
                        sector=sector,
                        updated_at=now,
                    )
                )
            if not db.query(WatchlistRow).filter(WatchlistRow.symbol == symbol).first():
                db.add(WatchlistRow(symbol=symbol, created_at=now))
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
    if status == "filled":
        # Rebuild cost basis (fees included) only after fills — not on every /portfolio poll.
        sync_position_costs_from_trades(db)
        try:
            from app.services.equity_history import record_equity_snapshot

            # Recompute MV quickly from current positions + last preview equity-ish
            state = await build_portfolio_state(db, {symbol: filled_price})
            record_equity_snapshot(state.equity, state.cash, state.market_value, force=True)
        except Exception:
            pass
    payload = {"orderId": order_id, "status": status, "preview": preview.model_dump(by_alias=True)}
    if status == "filled":
        payload["fee"] = fee
        payload["feeBreakdown"] = calc_futu_us_fee(req.side, qty, filled_price or price)
    return payload


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
    try:
        from app.services.equity_history import clear_equity_history, ensure_baseline, record_equity_snapshot

        clear_equity_history()
        ensure_baseline(settings.initial_cash)
        record_equity_snapshot(settings.initial_cash, settings.initial_cash, 0.0, force=True)
    except Exception:
        pass
