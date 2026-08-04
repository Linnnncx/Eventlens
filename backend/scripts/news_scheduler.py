"""Periodically prewarm recent news for watchlist and core symbols.

This process is intentionally separate from the API server. Production starts it
as its own Compose service, while local development and unit tests remain fully
request-driven.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.config import Settings, get_settings
from app.database.session import SessionLocal, WatchlistRow, init_db
from app.providers.market.fixture_provider import load_universe
from app.services.news_store import _fetch_upstream, save_to_db

logger = logging.getLogger("eventlens.news_scheduler")
HEARTBEAT_PATH = Path("data/news_scheduler_heartbeat.json")


def resolve_symbols(
    explicit: list[str],
    watchlist: list[str],
    core: list[str],
    max_symbols: int,
) -> list[str]:
    """Return a stable, de-duplicated list with explicit/watchlist priority."""
    result: list[str] = []
    seen: set[str] = set()
    for raw in [*explicit, *watchlist, *core]:
        symbol = raw.upper().strip()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        result.append(symbol)
        if len(result) >= max(1, max_symbols):
            break
    return result


def configured_symbols(settings: Settings) -> list[str]:
    explicit = [s for s in settings.news_scheduler_symbols.split(",") if s.strip()]
    db = SessionLocal()
    try:
        watchlist = [row.symbol for row in db.query(WatchlistRow).order_by(WatchlistRow.id).all()]
    finally:
        db.close()
    core = [row["symbol"] for row in load_universe() if row.get("isCore")]
    return resolve_symbols(explicit, watchlist, core, settings.news_scheduler_max_symbols)


def write_heartbeat(status: str, **extra: object) -> None:
    HEARTBEAT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **extra,
    }
    HEARTBEAT_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def heartbeat_is_fresh(settings: Settings) -> bool:
    if not HEARTBEAT_PATH.exists():
        return False
    age = datetime.now(timezone.utc).timestamp() - HEARTBEAT_PATH.stat().st_mtime
    return age <= max(180, settings.news_scheduler_interval_seconds * 2 + 120)


async def refresh_symbol(symbol: str, settings: Settings) -> tuple[str, int, str]:
    start = datetime.now(timezone.utc) - timedelta(days=max(1, settings.news_scheduler_lookback_days))
    items, provider = await _fetch_upstream(symbol, start, None, max(1, settings.news_scheduler_limit))
    if items:
        db = SessionLocal()
        try:
            save_to_db(db, symbol, items, start, None)
        finally:
            db.close()
    return symbol, len(items), provider


async def run_cycle(settings: Settings) -> None:
    symbols = configured_symbols(settings)
    write_heartbeat("running", symbols=symbols, completed=0)
    if not symbols:
        logger.warning("no symbols configured for news prewarming")
        write_heartbeat("idle", symbols=[])
        return

    semaphore = asyncio.Semaphore(max(1, settings.news_scheduler_concurrency))
    completed = 0
    failures = 0

    async def one(symbol: str) -> None:
        nonlocal completed, failures
        async with semaphore:
            try:
                _, count, provider = await refresh_symbol(symbol, settings)
                logger.info("refreshed %s: %d items via %s", symbol, count, provider)
            except Exception:
                failures += 1
                logger.exception("failed to refresh %s", symbol)
            finally:
                completed += 1
                write_heartbeat(
                    "running",
                    symbols=symbols,
                    completed=completed,
                    failures=failures,
                )

    await asyncio.gather(*(one(symbol) for symbol in symbols))
    write_heartbeat("ok", symbols=symbols, completed=completed, failures=failures)


async def run_forever(settings: Settings) -> None:
    init_db()
    while True:
        started = asyncio.get_running_loop().time()
        await run_cycle(settings)
        elapsed = asyncio.get_running_loop().time() - started
        delay = max(30, settings.news_scheduler_interval_seconds - int(elapsed))
        logger.info("next news refresh in %d seconds", delay)
        await asyncio.sleep(delay)


def main() -> None:
    parser = argparse.ArgumentParser(description="EventLens production news prewarmer")
    parser.add_argument("--healthcheck", action="store_true")
    args = parser.parse_args()
    settings = get_settings()
    if args.healthcheck:
        raise SystemExit(0 if heartbeat_is_fresh(settings) else 1)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    asyncio.run(run_forever(settings))


if __name__ == "__main__":
    main()
