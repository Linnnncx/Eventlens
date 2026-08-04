"""Pre-ingest news into SQLite so symbol switches never pay the cold-fetch cost.

The first visit to a symbol has to pull the whole chart window from upstream, which
takes 10-20s. Running this once per day (or after adding symbols) means the app only
ever reads from the local DB.

    python -m scripts.warm_news                 # core universe, 1Day window
    python -m scripts.warm_news AAPL MSFT NVDA  # explicit symbols
    python -m scripts.warm_news --equities      # all equity symbols (skip ETFs)
    python -m scripts.warm_news --all           # every symbol in the universe
    python -m scripts.warm_news --force         # refetch even if already covered
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.session import NewsSyncRow, SessionLocal  # noqa: E402
from app.providers.market.fixture_provider import load_universe  # noqa: E402
from app.services.news_store import (  # noqa: E402
    COVERAGE_SLACK,
    _fetch_upstream,
    load_from_db,
    save_to_db,
)

# Matches newsWindowForTimeframe('1Day') on the frontend
LOOKBACK_DAYS = 470
LIMIT = 600


def _already_covered(symbol: str, start: datetime, limit: int) -> bool:
    db = SessionLocal()
    try:
        sync = db.query(NewsSyncRow).filter(NewsSyncRow.symbol == symbol).first()
        if sync is None:
            return False
        covered_from = sync.covered_from
        if covered_from is not None and covered_from.tzinfo is None:
            covered_from = covered_from.replace(tzinfo=timezone.utc)
        if covered_from is None or covered_from > start + COVERAGE_SLACK:
            return False
        return bool(load_from_db(db, symbol, start, None, limit))
    finally:
        db.close()


async def warm(symbol: str, start: datetime, limit: int, force: bool) -> str:
    if not force and _already_covered(symbol, start, limit):
        return f"{symbol}: already covered, skipped"

    t0 = time.time()
    try:
        items, provider = await _fetch_upstream(symbol, start, None, limit)
    except Exception as exc:  # noqa: BLE001 - one bad symbol must not abort the run
        return f"{symbol}: FAILED ({exc})"
    if not items:
        return f"{symbol}: no items returned"

    db = SessionLocal()
    try:
        save_to_db(db, symbol, items, start, None)
    finally:
        db.close()
    oldest = min(i.published_at for i in items).date()
    return f"{symbol}: {len(items)} items via {provider}, back to {oldest} ({time.time() - t0:.1f}s)"


async def main() -> None:
    parser = argparse.ArgumentParser(description="Warm the local news cache")
    parser.add_argument("symbols", nargs="*", help="symbols to warm (default: core universe)")
    parser.add_argument("--all", action="store_true", help="warm every symbol in the universe")
    parser.add_argument("--equities", action="store_true", help="warm all equity symbols (skip ETFs)")
    parser.add_argument("--force", action="store_true", help="refetch even when already covered")
    parser.add_argument("--days", type=int, default=LOOKBACK_DAYS, help="lookback window in days")
    parser.add_argument("--limit", type=int, default=LIMIT, help="max items per symbol")
    parser.add_argument("--concurrency", type=int, default=4, help="symbols fetched in parallel")
    args = parser.parse_args()

    universe = load_universe()
    if args.symbols:
        symbols = [s.upper() for s in args.symbols]
    elif args.all:
        symbols = [r["symbol"].upper() for r in universe]
    elif args.equities:
        symbols = [
            r["symbol"].upper()
            for r in universe
            if (r.get("assetType") or "equity") == "equity"
        ]
    else:
        symbols = [r["symbol"].upper() for r in universe if r.get("isCore")]
    if not symbols:
        print("nothing to warm")
        return

    start = datetime.now(timezone.utc) - timedelta(days=args.days)
    sem = asyncio.Semaphore(max(1, args.concurrency))
    done = 0

    async def run(sym: str) -> None:
        nonlocal done
        async with sem:
            msg = await warm(sym, start, args.limit, args.force)
        done += 1
        print(f"[{done}/{len(symbols)}] {msg}", flush=True)

    t0 = time.time()
    await asyncio.gather(*(run(s) for s in symbols))
    print(f"warmed {len(symbols)} symbols in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    asyncio.run(main())
