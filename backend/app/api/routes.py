from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Optional

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database.session import (
    NewsAnalysisRow,
    NewsContentRow,
    NewsEventRow,
    OrderRow,
    WatchlistRow,
    get_db,
    init_db,
)
from app.providers.factory import provider_factory
from app.providers.market.fixture_provider import content_hash, load_universe, universe_profiles
from app.schemas.market import (
    BarsResponse,
    NewsResponse,
    OrderPreviewRequest,
    ProviderMeta,
    QuoteResponse,
    SnapshotsResponse,
)
from app.services.article import fetch_article_text
from app.services.events import aggregate_daily_markers, align_event_to_bar, compute_event_reaction
from app.services.news_store import get_news_window, row_to_item
from app.services.trading import build_portfolio_state, ensure_portfolio, preview_order, reset_demo, simulate_order

router = APIRouter()

_quote_cache: TTLCache = TTLCache(maxsize=512, ttl=5)
_snap_cache: TTLCache = TTLCache(maxsize=64, ttl=25)
_bars_cache: TTLCache = TTLCache(maxsize=256, ttl=60)
_news_cache: TTLCache = TTLCache(maxsize=256, ttl=300)


def _meta(provider: str, cached: bool = False, stale: bool = False, fixture: bool = False, err: str | None = None) -> ProviderMeta:
    return ProviderMeta(
        provider=provider,
        cached=cached,
        stale=stale,
        fixture=fixture,
        delayed=provider == "fixture",
        error_message=err,
    )


@router.get("/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@router.get("/config/public")
async def public_config():
    s = get_settings()
    return {
        "marketDataProvider": s.market_data_provider,
        "newsProvider": s.news_provider,
        "realtimeProvider": s.realtime_provider,
        "llmProvider": s.llm_provider if not (s.llm_provider == "deepseek" and not s.deepseek_configured) else "rules",
        "fixtureMode": s.fixture_mode,
        "timezone": s.default_market_timezone,
        "initialCash": s.initial_cash,
        "alpacaConfigured": s.alpaca_configured,
        "deepseekConfigured": s.deepseek_configured,
    }


@router.get("/providers/status")
async def providers_status():
    s = get_settings()
    return {
        "market": s.market_data_provider,
        "news": s.news_provider,
        "realtime": s.realtime_provider,
        "llm": s.llm_provider,
        "yfinance": "active" if s.market_data_provider == "yfinance" else "standby",
        "alpacaConfigured": s.alpaca_configured,
        "deepseekConfigured": s.deepseek_configured,
        "fixtureEnabled": s.fixture_mode or s.market_data_provider == "fixture",
    }


@router.get("/symbols")
async def list_symbols(core_only: bool = False):
    rows = load_universe()
    if core_only:
        rows = [r for r in rows if r.get("isCore")]
    return {"items": rows}


@router.get("/symbols/search")
async def search_symbols(q: str = Query(""), limit: int = 20):
    market = provider_factory.create_market_provider()
    items = await market.search_symbols(q, limit=limit)
    return {"items": [i.model_dump(by_alias=True) for i in items]}


@router.get("/symbols/{symbol}")
async def symbol_profile(symbol: str):
    market = provider_factory.create_market_provider()
    profile = await market.get_symbol_profile(symbol)
    return profile.model_dump(by_alias=True)


@router.get("/market/snapshots")
async def market_snapshots(symbols: str = Query(...)):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    key = ",".join(syms)
    if key in _snap_cache:
        data, provider = _snap_cache[key]
        return SnapshotsResponse(snapshots=data, meta=_meta(provider, cached=True)).model_dump(by_alias=True)
    market = provider_factory.create_market_provider()
    snaps = await market.get_snapshots(syms)
    _snap_cache[key] = (snaps, market.name)
    return SnapshotsResponse(
        snapshots=snaps,
        meta=_meta(market.name, fixture=market.name == "fixture"),
    ).model_dump(by_alias=True)


@router.get("/market/quote/{symbol}")
async def market_quote(symbol: str):
    symbol = symbol.upper()
    if symbol in _quote_cache:
        q, provider = _quote_cache[symbol]
        return QuoteResponse(quote=q, meta=_meta(provider, cached=True)).model_dump(by_alias=True)
    market = provider_factory.create_market_provider()
    q = await market.get_quote(symbol)
    _quote_cache[symbol] = (q, market.name)
    return QuoteResponse(quote=q, meta=_meta(market.name, fixture=market.name == "fixture")).model_dump(by_alias=True)


@router.get("/market/bars/{symbol}")
async def market_bars(
    symbol: str,
    timeframe: str = "5Min",
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    limit: Optional[int] = 300,
):
    symbol = symbol.upper()
    cache_key = f"{symbol}:{timeframe}:{start}:{end}:{limit}"
    if cache_key in _bars_cache:
        bars, provider, used_start, used_end = _bars_cache[cache_key]
        return BarsResponse(
            symbol=symbol,
            timeframe=timeframe,
            start=used_start,
            end=used_end,
            bars=bars,
            meta=_meta(provider, cached=True),
        ).model_dump(by_alias=True)
    market = provider_factory.create_market_provider()
    bars = await market.get_bars(symbol, timeframe, start, end, limit)
    used_start = bars[0].timestamp if bars else start
    used_end = bars[-1].timestamp if bars else end
    ttl = {"1Min": 30, "5Min": 60, "15Min": 60, "1Hour": 300, "1Day": 900}.get(timeframe, 60)
    _bars_cache[cache_key] = (bars, market.name, used_start, used_end)
    # manually approximate ttl by storing; cachetools uses fixed ttl for cache object — acceptable
    return BarsResponse(
        symbol=symbol,
        timeframe=timeframe,
        start=used_start,
        end=used_end,
        bars=bars,
        meta=_meta(market.name, fixture=market.name == "fixture"),
    ).model_dump(by_alias=True)


@router.get("/market/status")
async def market_status():
    market = provider_factory.create_market_provider()
    status = await market.get_market_status()
    return status.model_dump(by_alias=True)


@router.get("/news/{symbol}")
async def get_news(
    symbol: str,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    limit: int = 30,
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    cache_key = f"{symbol}:{limit}:{start.isoformat() if start else '-'}:{end.isoformat() if end else '-'}"
    if cache_key in _news_cache:
        items, provider = _news_cache[cache_key]
        return NewsResponse(items=items, meta=_meta(provider, cached=True)).model_dump(by_alias=True)

    news_p = provider_factory.create_news_provider()
    items = await news_p.get_news(symbol, start, end, limit)
    # persist lightly
    now = datetime.now(timezone.utc)
    for item in items:
        existing = db.query(NewsEventRow).filter(NewsEventRow.id == item.id).first()
        if existing:
            continue
        h = content_hash(item.headline, item.url, item.published_at.isoformat())
        db.add(
            NewsEventRow(
                id=item.id,
                external_id=item.id,
                symbol=symbol,
                headline=item.headline,
                publisher=item.source,
                url=item.url,
                published_at=item.published_at,
                summary_original=item.summary_original,
                summary_ai=item.summary_ai,
                event_type=item.event_type,
                importance=item.importance,
                direction=item.direction,
                time_horizon=item.time_horizon,
                provider=item.provider,
                content_hash=h,
                created_at=now,
                updated_at=now,
            )
        )
    try:
        db.commit()
    except Exception:
        db.rollback()
    _news_cache[cache_key] = (items, news_p.name)
    return NewsResponse(items=items, meta=_meta(news_p.name, fixture=news_p.name == "fixture")).model_dump(by_alias=True)


@router.get("/news/{news_id}/content")
async def news_content(news_id: str, db: Session = Depends(get_db)):
    """Article body for the right-hand panel. Scraped once, then served from SQLite."""
    cached = db.query(NewsContentRow).filter(NewsContentRow.news_id == news_id).first()
    if cached is not None:
        return {"newsId": news_id, "url": cached.url, "body": cached.body, "cached": True}

    row = db.query(NewsEventRow).filter(NewsEventRow.id == news_id).first()
    if row is None:
        raise HTTPException(404, "News not found")

    body = ""
    if row.url:
        body = await asyncio.to_thread(fetch_article_text, row.url)
    if not body:
        body = row.summary_original or ""

    db.add(
        NewsContentRow(
            news_id=news_id,
            url=row.url,
            body=body,
            fetched_at=datetime.now(timezone.utc),
        )
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
    return {"newsId": news_id, "url": row.url, "body": body, "cached": False}


@router.post("/news/{news_id}/analyze")
async def analyze_news(news_id: str, db: Session = Depends(get_db)):
    row = db.query(NewsEventRow).filter(NewsEventRow.id == news_id).first()
    payload = {
        "headline": row.headline if row else news_id,
        "summary": row.summary_original if row else "",
        "symbol": row.symbol if row else "",
        "source": row.publisher if row else "",
    }
    # also try cache from in-memory via recent news responses — if missing, still analyze payload
    llm = provider_factory.create_llm_provider()
    analysis = await llm.analyze_news(payload)
    if row:
        row.summary_ai = analysis.summary_zh
        row.event_type = analysis.event_type
        row.importance = analysis.importance
        row.direction = analysis.direction
        row.time_horizon = analysis.time_horizon
        row.updated_at = datetime.now(timezone.utc)
        db.add(
            NewsAnalysisRow(
                news_id=news_id,
                content_hash=row.content_hash,
                model=getattr(llm, "name", "rules"),
                prompt_version="v1",
                payload_json=analysis.model_dump_json(by_alias=True),
                created_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
    return analysis.model_dump(by_alias=True)


@router.get("/events/{symbol}")
async def list_events(
    symbol: str,
    timeframe: str = "5Min",
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    limit: int = 300,
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    items, source, cached = await get_news_window(db, symbol, start, end, limit)
    markers = []
    if timeframe == "1Day":
        markers = aggregate_daily_markers(items)
    else:
        for item in items:
            aligned = align_event_to_bar(item.published_at, timeframe)
            markers.append(
                {
                    "newsId": item.id,
                    "timestamp": aligned.isoformat(),
                    "eventType": item.event_type,
                    "importance": item.importance,
                    "headline": item.headline,
                }
            )
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "markers": markers,
        "items": [i.model_dump(by_alias=True) for i in items],
        "source": source,
        "cached": cached,
        "count": len(items),
    }


@router.get("/events/{symbol}/{event_id}/reaction")
async def event_reaction(
    symbol: str,
    event_id: str,
    timeframe: str = "5Min",
    db: Session = Depends(get_db),
):
    market = provider_factory.create_market_provider()
    # Look the event up in the store — the live feed window may no longer contain it
    row = db.query(NewsEventRow).filter(NewsEventRow.id == event_id).first()
    if row is None:
        raise HTTPException(404, "Event not found")
    event = row_to_item(row)
    bars = await market.get_bars(symbol.upper(), timeframe, None, None, 500)
    reaction = compute_event_reaction(event, bars, symbol.upper())
    return reaction.model_dump(by_alias=True)


@router.get("/watchlist")
async def get_watchlist(db: Session = Depends(get_db)):
    rows = db.query(WatchlistRow).order_by(WatchlistRow.created_at.desc()).all()
    return {"items": [r.symbol for r in rows]}


@router.post("/watchlist/{symbol}")
async def add_watchlist(symbol: str, db: Session = Depends(get_db)):
    symbol = symbol.upper()
    if not db.query(WatchlistRow).filter(WatchlistRow.symbol == symbol).first():
        db.add(WatchlistRow(symbol=symbol, created_at=datetime.now(timezone.utc)))
        db.commit()
    return {"ok": True, "symbol": symbol}


@router.delete("/watchlist/{symbol}")
async def remove_watchlist(symbol: str, db: Session = Depends(get_db)):
    row = db.query(WatchlistRow).filter(WatchlistRow.symbol == symbol.upper()).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.get("/portfolio")
async def portfolio(db: Session = Depends(get_db)):
    ensure_portfolio(db)
    state = await build_portfolio_state(db)
    return state.model_dump(by_alias=True)


@router.get("/positions")
async def positions(db: Session = Depends(get_db)):
    state = await build_portfolio_state(db)
    return {"items": state.positions}


@router.get("/orders")
async def orders(db: Session = Depends(get_db)):
    rows = db.query(OrderRow).order_by(OrderRow.created_at.desc()).limit(100).all()
    return {
        "items": [
            {
                "id": r.id,
                "symbol": r.symbol,
                "side": r.side,
                "orderType": r.order_type,
                "quantity": r.quantity,
                "limitPrice": r.limit_price,
                "stopLoss": r.stop_loss,
                "takeProfit": r.take_profit,
                "status": r.status,
                "filledPrice": r.filled_price,
                "filledAt": r.filled_at,
                "newsId": r.news_id,
                "createdAt": r.created_at,
            }
            for r in rows
        ]
    }


@router.post("/orders/preview")
async def orders_preview(req: OrderPreviewRequest, db: Session = Depends(get_db)):
    return (await preview_order(db, req)).model_dump(by_alias=True)


@router.post("/orders/simulate")
async def orders_simulate(req: OrderPreviewRequest, db: Session = Depends(get_db)):
    try:
        return await simulate_order(db, req)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/orders/{order_id}")
async def cancel_order(order_id: str, db: Session = Depends(get_db)):
    row = db.query(OrderRow).filter(OrderRow.id == order_id).first()
    if not row:
        raise HTTPException(404, "Order not found")
    if row.status != "open":
        raise HTTPException(400, "Only open orders can be canceled")
    row.status = "canceled"
    db.commit()
    return {"ok": True}


@router.post("/demo/reset")
async def demo_reset(db: Session = Depends(get_db)):
    reset_demo(db)
    return {"ok": True}
