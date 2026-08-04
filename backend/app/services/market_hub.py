"""Shared, single-flight market quote cache.

REST quotes, synthetic order books and the websocket broadcaster all consume this
hub so one symbol is never fetched from the upstream provider multiple times at
the same moment.
"""

from __future__ import annotations

import asyncio
import time

from app.providers.factory import provider_factory
from app.schemas.market import Quote
from app.services.market_store import load_all_quotes, load_quote, save_quote

_quotes: dict[str, tuple[float, Quote, str]] = {}
_locks: dict[str, asyncio.Lock] = {}
_refresh_tasks: set[asyncio.Task] = set()


def _lock_for(symbol: str) -> asyncio.Lock:
    lock = _locks.get(symbol)
    if lock is None:
        lock = asyncio.Lock()
        _locks[symbol] = lock
    return lock


async def _fetch_and_store(symbol: str, max_age: float, *, force: bool = False) -> tuple[Quote, str]:
    async with _lock_for(symbol):
        now = time.monotonic()
        cached = _quotes.get(symbol)
        if not force and cached is not None and cached[0] > now:
            return cached[1], cached[2]
        market = provider_factory.create_market_provider()
        quote = await market.get_quote(symbol)
        provider = getattr(market, "name", getattr(quote, "provider", "unknown"))
        _quotes[symbol] = (now + max(0.25, max_age), quote, provider)
        await asyncio.to_thread(save_quote, quote)
        return quote, provider


def _refresh_in_background(symbol: str, max_age: float) -> None:
    lock = _lock_for(symbol)
    if lock.locked():
        return

    async def refresh() -> None:
        try:
            await _fetch_and_store(symbol, max_age, force=True)
        except Exception:
            # The persisted quote remains usable; the next refresh can retry.
            pass

    task = asyncio.create_task(refresh())
    _refresh_tasks.add(task)
    task.add_done_callback(_refresh_tasks.discard)


async def get_shared_quote(
    symbol: str,
    max_age: float = 5.0,
    *,
    allow_stale: bool = True,
) -> tuple[Quote, str, bool]:
    """Return ``(quote, provider_name, cached)`` with per-symbol request collapse."""
    symbol = symbol.upper().strip()
    now = time.monotonic()
    cached = _quotes.get(symbol)
    if cached is not None and cached[0] > now:
        return cached[1], cached[2], True

    if allow_stale:
        stored = await asyncio.to_thread(load_quote, symbol)
        if stored is not None:
            provider = stored.provider
            # Keep the persisted value briefly so concurrent page/preview requests
            # collapse while one background refresh updates it.
            _quotes[symbol] = (now + max(0.25, max_age), stored, provider)
            _refresh_in_background(symbol, max_age)
            return stored, provider, True

    quote, provider = await _fetch_and_store(symbol, max_age)
    return quote, provider, False


async def peek_shared_quote(symbol: str) -> Quote | None:
    symbol = symbol.upper().strip()
    cached = _quotes.get(symbol)
    if cached is not None:
        return cached[1]
    return await asyncio.to_thread(load_quote, symbol)


def clear_shared_quotes() -> None:
    _quotes.clear()


def prime_shared_quotes() -> int:
    """Hydrate memory from SQLite so the first request after restart is instant."""
    expires = time.monotonic() + 5.0
    quotes = load_all_quotes()
    for quote in quotes:
        _quotes[quote.symbol] = (expires, quote, quote.provider)
    return len(quotes)
