"""Progressively warm real daily Yahoo bars for the production universe."""

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
from app.providers.yahoo_http import apply_proxy_env, chart_to_ohlcv, fetch_chart
from app.schemas.market import Bar
from app.services.market_store import save_bars

logger = logging.getLogger("eventlens.market_scheduler")
HEARTBEAT_PATH = Path("data/market_scheduler_heartbeat.json")


def resolve_symbols(watchlist: list[str], universe: list[dict], max_symbols: int) -> list[str]:
    core = [row["symbol"] for row in universe if row.get("isCore")]
    equities = [row["symbol"] for row in universe if row.get("assetType") == "equity"]
    ordered: list[str] = []
    seen: set[str] = set()
    for raw in [*watchlist, *core, *equities]:
        symbol = raw.upper().strip()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        ordered.append(symbol)
        if len(ordered) >= max(1, max_symbols):
            break
    return ordered


def configured_symbols(settings: Settings) -> list[str]:
    db = SessionLocal()
    try:
        watchlist = [row.symbol for row in db.query(WatchlistRow).order_by(WatchlistRow.id).all()]
    finally:
        db.close()
    return resolve_symbols(watchlist, load_universe(), settings.market_scheduler_max_symbols)


def write_heartbeat(status: str, **extra: object) -> None:
    HEARTBEAT_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEARTBEAT_PATH.write_text(
        json.dumps(
            {
                "status": status,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **extra,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def heartbeat_is_fresh(settings: Settings) -> bool:
    if not HEARTBEAT_PATH.exists():
        return False
    age = datetime.now(timezone.utc).timestamp() - HEARTBEAT_PATH.stat().st_mtime
    return age <= max(300, settings.market_scheduler_interval_seconds * 2 + 300)


async def warm_symbol(symbol: str) -> int:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=365 * 2)

    def fetch_real_bars() -> list[Bar]:
        result = fetch_chart(symbol, interval="1d", period1=start, period2=end)
        rows = chart_to_ohlcv(result)[-300:]
        return [
            Bar(
                symbol=symbol,
                timestamp=row["timestamp"],
                open=row["open"],
                high=row["high"],
                low=row["low"],
                close=row["close"],
                volume=row["volume"],
            )
            for row in rows
        ]

    bars = await asyncio.to_thread(fetch_real_bars)
    if not bars:
        raise RuntimeError("Yahoo returned no bars")
    await asyncio.to_thread(save_bars, "yfinance", symbol, "1Day", bars)
    return len(bars)


async def run_cycle(settings: Settings) -> None:
    symbols = configured_symbols(settings)
    write_heartbeat("running", total=len(symbols), completed=0, failures=0)
    semaphore = asyncio.Semaphore(max(1, settings.market_scheduler_concurrency))
    completed = 0
    failures = 0

    async def one(symbol: str) -> None:
        nonlocal completed, failures
        async with semaphore:
            try:
                count = await warm_symbol(symbol)
                logger.info("warmed %s: %d daily bars", symbol, count)
            except Exception:
                failures += 1
                logger.warning("daily-bar warm failed for %s", symbol, exc_info=True)
            finally:
                completed += 1
                if completed % 10 == 0 or completed == len(symbols):
                    write_heartbeat(
                        "running",
                        total=len(symbols),
                        completed=completed,
                        failures=failures,
                    )

    await asyncio.gather(*(one(symbol) for symbol in symbols))
    write_heartbeat(
        "ok",
        total=len(symbols),
        completed=completed,
        failures=failures,
    )


async def run_forever(settings: Settings) -> None:
    init_db()
    apply_proxy_env()
    while True:
        started = asyncio.get_running_loop().time()
        await run_cycle(settings)
        elapsed = asyncio.get_running_loop().time() - started
        delay = max(300, settings.market_scheduler_interval_seconds - int(elapsed))
        logger.info("next daily-bar refresh in %d seconds", delay)
        await asyncio.sleep(delay)


def main() -> None:
    parser = argparse.ArgumentParser(description="EventLens production daily-bar prewarmer")
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
