from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Optional

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.llm_runtime import effective_llm_config, public_llm_view, save_llm_settings
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
from app.providers.market.fixture_provider import load_universe, universe_profiles
from app.schemas.market import (
    BarsResponse,
    NewsResponse,
    OrderBookResponse,
    OrderPreviewRequest,
    ProviderMeta,
    QuoteResponse,
    RangeAnalysisRequest,
    SnapshotsResponse,
)
from app.services.article import fetch_article_text
from app.services.events import aggregate_daily_markers, align_event_to_bar, compute_event_reaction
from app.services.news_store import get_news_window, row_to_item
from app.services.range_analysis import build_news_facts, build_technical_facts, lookback_start
from app.services.danmaku import list_danmaku, post_danmaku
from app.services.orderbook import build_order_book
from app.services.market_hub import get_shared_quote
from app.services.market_store import load_bars, save_bars, save_snapshots
from app.services.trading import (
    build_portfolio_state,
    closed_position_rankings,
    ensure_portfolio,
    ensure_positions_watchlisted,
    list_orders,
    list_trades,
    preview_order,
    reset_demo,
    simulate_order,
)

router = APIRouter()

_quote_cache: TTLCache = TTLCache(maxsize=512, ttl=5)
_orderbook_cache: TTLCache = TTLCache(maxsize=256, ttl=2)
_snap_cache: TTLCache = TTLCache(maxsize=64, ttl=25)
_screener_cache: TTLCache = TTLCache(maxsize=4, ttl=120)
_bars_cache: TTLCache = TTLCache(maxsize=256, ttl=60)
_request_locks: dict[str, asyncio.Lock] = {}
_screener_last: dict[str, tuple[list, str]] = {}
_background_tasks: set[asyncio.Task] = set()


def _request_lock(key: str) -> asyncio.Lock:
    lock = _request_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _request_locks[key] = lock
    return lock


async def _load_screener(cache_key: str, equities_only: bool) -> tuple[list, str]:
    async with _request_lock(cache_key):
        if cache_key in _screener_cache:
            return _screener_cache[cache_key]
        rows = load_universe()
        if equities_only:
            rows = [r for r in rows if (r.get("assetType") or "equity") == "equity"]
        syms = [r["symbol"].upper() for r in rows]
        market = provider_factory.create_market_provider()
        snaps: list = []
        batch = max(5, min(40, get_settings().yfinance_batch_size))
        for i in range(0, len(syms), batch):
            snaps.extend(await market.get_snapshots(syms[i : i + batch]))
        if snaps and market.name != "fixture":
            await asyncio.to_thread(save_snapshots, snaps)
        result = (snaps, market.name)
        _screener_cache[cache_key] = result
        _screener_last[cache_key] = result
        return result


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
    llm = effective_llm_config()
    return {
        "marketDataProvider": s.market_data_provider,
        "newsProvider": s.news_provider,
        "realtimeProvider": s.realtime_provider,
        "llmProvider": llm["effectiveProvider"],
        "fixtureMode": s.fixture_mode,
        "timezone": s.default_market_timezone,
        "initialCash": s.initial_cash,
        "alpacaConfigured": s.alpaca_configured,
        "deepseekConfigured": llm["deepseekConfigured"],
    }


@router.get("/config/llm")
async def get_llm_config():
    return public_llm_view()


@router.put("/config/llm")
async def put_llm_config(payload: dict):
    """Save runtime LLM settings (provider + DeepSeek key/model). Takes effect immediately."""
    try:
        return save_llm_settings(payload or {})
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/providers/status")
async def providers_status():
    s = get_settings()
    llm = effective_llm_config()
    return {
        "market": s.market_data_provider,
        "news": s.news_provider,
        "realtime": s.realtime_provider,
        "llm": llm["effectiveProvider"],
        "yfinance": "active" if s.market_data_provider == "yfinance" else "standby",
        "alpacaConfigured": s.alpaca_configured,
        "deepseekConfigured": llm["deepseekConfigured"],
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
    syms = list(dict.fromkeys(s.strip().upper() for s in symbols.split(",") if s.strip()))
    key = ",".join(syms)
    if key in _snap_cache:
        data, provider = _snap_cache[key]
        return SnapshotsResponse(snapshots=data, meta=_meta(provider, cached=True)).model_dump(by_alias=True)
    async with _request_lock(f"snapshots:{key}"):
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


@router.get("/market/screener")
async def market_screener(equities_only: bool = True):
    """Full-universe snapshot board for the left-panel screener.

    Sorted / filtered on the client. Cached for 60s so switching sort keys is free.
    """
    cache_key = f"screener:{int(equities_only)}"
    if cache_key in _screener_cache:
        data, provider = _screener_cache[cache_key]
        return SnapshotsResponse(snapshots=data, meta=_meta(provider, cached=True)).model_dump(by_alias=True)

    stale = _screener_last.get(cache_key)
    if stale is not None:
        lock = _request_lock(cache_key)
        if not lock.locked():
            task = asyncio.create_task(_load_screener(cache_key, equities_only))
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
        snaps, provider = stale
        return SnapshotsResponse(
            snapshots=snaps,
            meta=_meta(provider, cached=True, stale=True),
        ).model_dump(by_alias=True)

    snaps, provider = await _load_screener(cache_key, equities_only)
    return SnapshotsResponse(
        snapshots=snaps,
        meta=_meta(provider, fixture=provider == "fixture"),
    ).model_dump(by_alias=True)


@router.get("/market/quote/{symbol}")
async def market_quote(symbol: str):
    symbol = symbol.upper()
    q, provider, cached = await get_shared_quote(symbol, max_age=5.0)
    return QuoteResponse(
        quote=q,
        meta=_meta(provider, cached=cached, fixture=provider == "fixture"),
    ).model_dump(by_alias=True)


@router.get("/market/orderbook/{symbol}")
async def market_orderbook(symbol: str, levels: int = Query(default=12, ge=5, le=25)):
    """Synthetic L2 ladder derived from latest quote (demo depth, not venue data)."""
    symbol = symbol.upper()
    cache_key = f"{symbol}:{levels}"
    if cache_key in _orderbook_cache:
        book = _orderbook_cache[cache_key]
        return OrderBookResponse(
            book=book,
            meta=_meta(book.provider, cached=True, fixture=book.provider == "fixture"),
        ).model_dump(by_alias=True)
    async with _request_lock(f"orderbook:{cache_key}"):
        if cache_key in _orderbook_cache:
            book = _orderbook_cache[cache_key]
            return OrderBookResponse(
                book=book,
                meta=_meta(book.provider, cached=True, fixture=book.provider == "fixture"),
            ).model_dump(by_alias=True)
        try:
            book = await build_order_book(symbol, levels=levels)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        _orderbook_cache[cache_key] = book
    return OrderBookResponse(
        book=book,
        meta=_meta(book.provider, fixture=book.provider == "fixture"),
    ).model_dump(by_alias=True)


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
    async with _request_lock(f"bars:{cache_key}"):
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
        if start is None and end is None and market.name != "fixture":
            stored = await asyncio.to_thread(load_bars, symbol, timeframe, market.name, limit or 300)
            if stored:
                used_start = stored[0].timestamp
                used_end = stored[-1].timestamp
                _bars_cache[cache_key] = (stored, market.name, used_start, used_end)

                async def refresh_stored_bars() -> None:
                    try:
                        fresh = await market.get_bars(symbol, timeframe, None, None, limit)
                        if not fresh:
                            return
                        await asyncio.to_thread(save_bars, market.name, symbol, timeframe, fresh)
                        _bars_cache[cache_key] = (
                            fresh,
                            market.name,
                            fresh[0].timestamp,
                            fresh[-1].timestamp,
                        )
                    except Exception:
                        pass

                task = asyncio.create_task(refresh_stored_bars())
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)
                return BarsResponse(
                    symbol=symbol,
                    timeframe=timeframe,
                    start=used_start,
                    end=used_end,
                    bars=stored,
                    meta=_meta(market.name, cached=True, stale=True),
                ).model_dump(by_alias=True)
        bars = await market.get_bars(symbol, timeframe, start, end, limit)
        used_start = bars[0].timestamp if bars else start
        used_end = bars[-1].timestamp if bars else end
        _bars_cache[cache_key] = (bars, market.name, used_start, used_end)
        if bars and market.name != "fixture":
            await asyncio.to_thread(save_bars, market.name, symbol, timeframe, bars)
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
    items, source, cached = await get_news_window(db, symbol, start, end, limit)
    return NewsResponse(
        items=items,
        meta=_meta(source, cached=cached, fixture=source == "fixture"),
    ).model_dump(by_alias=True)


@router.get("/news/{news_id}/content")
async def news_content(news_id: str, db: Session = Depends(get_db)):
    """Article body for the right-hand panel. Scraped once, then served from SQLite."""
    cached = db.query(NewsContentRow).filter(NewsContentRow.news_id == news_id).first()
    if cached is not None:
        return {"newsId": news_id, "url": cached.url, "body": cached.body, "cached": True}

    async with _request_lock(f"news-content:{news_id}"):
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


@router.post("/ai/range-analysis")
async def ai_range_analysis(body: RangeAnalysisRequest, db: Session = Depends(get_db)):
    """Analyze technical bars + news inside a user-selected chart window."""
    symbol = body.symbol.upper().strip()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol required")
    start, end = body.start, body.end
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if end <= start:
        raise HTTPException(status_code=400, detail="end must be after start")

    market = provider_factory.create_market_provider()
    # Fetch lookback history so RSI/MACD/MA can compute even on short windows.
    fetch_start = lookback_start(start, body.timeframe)
    all_bars = await market.get_bars(symbol, body.timeframe, fetch_start, end, 1200)
    all_bars = [b for b in all_bars if b.timestamp <= end]
    window_bars = [b for b in all_bars if start <= b.timestamp <= end]
    items, _source, _cached = await get_news_window(db, symbol, start, end, 80)
    tech = build_technical_facts(window_bars, body.timeframe, context_bars=all_bars)
    news = build_news_facts(items, limit=25)
    llm = provider_factory.create_llm_provider()
    report = await llm.analyze_range(
        {
            "symbol": symbol,
            "timeframe": body.timeframe,
            "start": start,
            "end": end,
            "technical": tech,
            "news": news,
        }
    )
    return report.model_dump(by_alias=True)


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
def get_watchlist(db: Session = Depends(get_db)):
    return {"items": ensure_positions_watchlisted(db)}


@router.post("/watchlist/{symbol}")
def add_watchlist(symbol: str, db: Session = Depends(get_db)):
    symbol = symbol.upper()
    if not db.query(WatchlistRow).filter(WatchlistRow.symbol == symbol).first():
        db.add(WatchlistRow(symbol=symbol, created_at=datetime.now(timezone.utc)))
        db.commit()
    return {"ok": True, "symbol": symbol}


@router.delete("/watchlist/{symbol}")
def remove_watchlist(symbol: str, db: Session = Depends(get_db)):
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


@router.get("/portfolio/equity-history")
async def portfolio_equity_history(
    range: str = Query("1d", description="1d|1w|1m|6m|1y"),
    db: Session = Depends(get_db),
):
    ensure_portfolio(db)
    state = await build_portfolio_state(db)
    from app.services.equity_history import get_equity_history

    return get_equity_history(
        range,
        current_equity=state.equity,
        current_cash=state.cash,
        current_mv=state.market_value,
    )


@router.get("/portfolio/closed-rankings")
def portfolio_closed_rankings(limit: int = Query(20, ge=1, le=50), db: Session = Depends(get_db)):
    return {"items": closed_position_rankings(db, limit=limit)}


@router.get("/positions")
async def positions(db: Session = Depends(get_db)):
    state = await build_portfolio_state(db)
    return {"items": state.positions}


@router.get("/orders")
def orders(db: Session = Depends(get_db)):
    return {"items": list_orders(db)}


@router.get("/trades")
def trades(db: Session = Depends(get_db)):
    return {"items": list_trades(db)}


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


@router.get("/danmaku/{symbol}")
def danmaku_list(symbol: str, after: Optional[int] = None):
    """Lightweight in-memory room for workbench live comments (demo)."""
    items = list_danmaku(symbol, after=after)
    return {"symbol": symbol.upper(), "items": items}


@router.post("/danmaku/{symbol}")
def danmaku_post(symbol: str, payload: dict):
    text = str(payload.get("text") or "")
    nickname = payload.get("nickname")
    try:
        msg = post_danmaku(symbol, text, nickname=str(nickname) if nickname else None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"item": msg}
