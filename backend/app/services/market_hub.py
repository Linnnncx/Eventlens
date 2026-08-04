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

_quotes: dict[str, tuple[float, Quote, str]] = {}
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(symbol: str) -> asyncio.Lock:
    lock = _locks.get(symbol)
    if lock is None:
        lock = asyncio.Lock()
        _locks[symbol] = lock
    return lock


async def get_shared_quote(symbol: str, max_age: float = 5.0) -> tuple[Quote, str, bool]:
    """Return ``(quote, provider_name, cached)`` with per-symbol request collapse."""
    symbol = symbol.upper().strip()
    now = time.monotonic()
    cached = _quotes.get(symbol)
    if cached is not None and cached[0] > now:
        return cached[1], cached[2], True

    async with _lock_for(symbol):
        now = time.monotonic()
        cached = _quotes.get(symbol)
        if cached is not None and cached[0] > now:
            return cached[1], cached[2], True

        market = provider_factory.create_market_provider()
        quote = await market.get_quote(symbol)
        provider = getattr(market, "name", getattr(quote, "provider", "unknown"))
        _quotes[symbol] = (now + max(0.25, max_age), quote, provider)
        return quote, provider, False


def clear_shared_quotes() -> None:
    _quotes.clear()
