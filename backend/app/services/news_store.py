"""SQLite-backed news cache.

Upstream feeds (Google News RSS / Yahoo / Finnhub) take several seconds and are
rate-limited, so news is persisted once and served from the DB afterwards:

- first visit for a symbol/window: fetch upstream, store, return
- later visits: return from SQLite immediately (milliseconds)
- if the stored copy exceeds the configured refresh interval, update it in the background so the
  user still gets an instant response

A per-symbol lock collapses concurrent requests into a single upstream fetch, which
is also what keeps us well under the feeds' rate limits.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_

from app.database.session import NewsEventRow, NewsSyncRow, SessionLocal
from app.core.config import get_settings
from app.providers.factory import provider_factory
from app.providers.market.fixture_provider import content_hash
from app.providers.news.google_news import even_sample
from app.schemas.market import NewsItem
from app.services.news_classify import classify_headline

logger = logging.getLogger(__name__)

# Serve from DB and refresh in the background once the copy is older than this
# Treat stored coverage as good enough if it reaches within this much of the request
COVERAGE_SLACK = timedelta(days=3)
RECENT_REFRESH_WINDOW = timedelta(days=2)

_locks: dict[str, asyncio.Lock] = {}
# Hold strong references so background refreshes aren't garbage collected mid-flight
_background_tasks: set[asyncio.Task] = set()


def _lock_for(symbol: str) -> asyncio.Lock:
    lock = _locks.get(symbol)
    if lock is None:
        lock = asyncio.Lock()
        _locks[symbol] = lock
    return lock


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def row_to_item(row: NewsEventRow) -> NewsItem:
    rule_event_type, rule_importance, rule_direction = classify_headline(
        row.headline,
        row.summary_original,
    )
    # A user-requested AI analysis is authoritative. Otherwise classify cached
    # rows with the latest deterministic model so rule improvements apply at once.
    ai_classified = bool(row.summary_ai)
    return NewsItem(
        id=row.id,
        headline=row.headline,
        summaryOriginal=row.summary_original,
        summaryAi=row.summary_ai,
        source=row.publisher or "News",
        url=row.url,
        publishedAt=_aware(row.published_at),
        symbols=[row.symbol],
        eventType=row.event_type if ai_classified else rule_event_type,
        importance=row.importance if ai_classified else rule_importance,
        direction=row.direction if ai_classified else rule_direction,
        timeHorizon=row.time_horizon,
        provider=row.provider,
    )


def load_from_db(
    db,
    symbol: str,
    start: datetime | None,
    end: datetime | None,
    limit: int,
) -> list[NewsItem]:
    q = db.query(NewsEventRow).filter(NewsEventRow.symbol == symbol)
    if start:
        q = q.filter(NewsEventRow.published_at >= start)
    if end:
        q = q.filter(NewsEventRow.published_at <= end)
    rows = q.order_by(NewsEventRow.published_at.desc()).all()
    if len(rows) > limit:
        # Keeping only the newest `limit` rows strips every anchor off the left
        # half of the chart once a symbol accumulates more news than the budget.
        # Sample evenly instead so the whole visible window stays covered.
        rows = even_sample(rows, limit)
    return [row_to_item(r) for r in rows]


def save_to_db(
    db,
    symbol: str,
    items: list[NewsItem],
    start: datetime | None,
    end: datetime | None,
) -> None:
    now = datetime.now(timezone.utc)
    # Dedup by primary key AND by (provider, content_hash) — the DB unique
    # constraint is global on that pair, so a prior insert for another symbol
    # (or a different id with the same hash) must be skipped or commit fails
    # and the request path can wedge under load.
    existing_ids = {
        r.id
        for r in db.query(NewsEventRow.id)
        .filter(NewsEventRow.symbol == symbol)
        .all()
    }
    hashes = [
        content_hash(item.headline, item.url, item.published_at.isoformat())
        for item in items
    ]
    if hashes:
        existing_hashes = {
            (provider, h)
            for provider, h in db.query(NewsEventRow.provider, NewsEventRow.content_hash)
            .filter(NewsEventRow.content_hash.in_(hashes))
            .all()
        }
    else:
        existing_hashes = set()
    for item, h in zip(items, hashes):
        if item.id in existing_ids:
            continue
        key = (item.provider, h)
        if key in existing_hashes:
            continue
        existing_ids.add(item.id)
        existing_hashes.add(key)
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

    covered_from = start or (min((i.published_at for i in items), default=now))
    covered_to = end or now
    sync = db.query(NewsSyncRow).filter(NewsSyncRow.symbol == symbol).first()
    if sync is None:
        db.add(
            NewsSyncRow(
                symbol=symbol,
                covered_from=covered_from,
                covered_to=covered_to,
                fetched_at=now,
            )
        )
    else:
        # Coverage only ever grows
        if covered_from < (_aware(sync.covered_from) or now):
            sync.covered_from = covered_from
        sync.covered_to = max(covered_to, _aware(sync.covered_to) or covered_to)
        sync.fetched_at = now

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("news persist failed for %s", symbol, exc_info=True)


async def _fetch_upstream(symbol: str, start: datetime | None, end: datetime | None, limit: int):
    provider = provider_factory.create_news_provider()
    items = await provider.get_news(symbol, start, end, limit)
    return items, getattr(provider, "name", "unknown")


async def _refresh(symbol: str, start: datetime | None, end: datetime | None, limit: int) -> None:
    """Background refresh — never raises into the request path."""
    lock = _lock_for(symbol)
    if lock.locked():
        return
    async with lock:
        try:
            items, _ = await _fetch_upstream(symbol, start, end, limit)
        except Exception:
            logger.warning("background news refresh failed for %s", symbol, exc_info=True)
            return
        if not items:
            return
        db = SessionLocal()
        try:
            save_to_db(db, symbol, items, start, end)
        finally:
            db.close()


async def get_news_window(
    db,
    symbol: str,
    start: datetime | None,
    end: datetime | None,
    limit: int,
) -> tuple[list[NewsItem], str, bool]:
    """Return (items, source, served_from_cache) for the requested window.

    Policy: always prefer SQLite when the symbol already has rows. Upstream is only
    hit on a true cold miss (or as a background refresh when coverage/freshness is weak).
    This keeps the UI fast and avoids rate limits.
    """
    symbol = symbol.upper()
    now = datetime.now(timezone.utc)

    sync = db.query(NewsSyncRow).filter(NewsSyncRow.symbol == symbol).first()
    covered = sync is not None and (
        start is None or (_aware(sync.covered_from) or now) <= start + COVERAGE_SLACK
    )
    refresh_after = timedelta(seconds=max(60, get_settings().yfinance_news_refresh_seconds))
    stale = sync is None or (now - (_aware(sync.fetched_at) or now)) > refresh_after

    # Fast path: anything already in SQLite for this window
    cached_items = load_from_db(db, symbol, start, end, limit)
    if cached_items:
        if stale or not covered:
            # Missing historical coverage still needs the requested full window.
            # Routine freshness updates only fetch the latest two days so a daily
            # chart does not repeat twelve historical RSS requests every few minutes.
            incremental_refresh = covered and (end is None or end >= now - RECENT_REFRESH_WINDOW)
            refresh_start = (
                max(start or (now - RECENT_REFRESH_WINDOW), now - RECENT_REFRESH_WINDOW)
                if incremental_refresh
                else start
            )
            refresh_limit = limit if not covered else min(limit, 120)
            task = asyncio.create_task(_refresh(symbol, refresh_start, end, refresh_limit))
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
        return cached_items, "sqlite", True

    # Cold miss — fetch now, but collapse concurrent callers into one upstream trip
    lock = _lock_for(symbol)
    async with lock:
        db.expire_all()
        cached_items = load_from_db(db, symbol, start, end, limit)
        if cached_items:
            return cached_items, "sqlite", True

        items, provider_name = await _fetch_upstream(symbol, start, end, limit)
        if items:
            save_to_db(db, symbol, items, start, end)
        return items, provider_name, False
