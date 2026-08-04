from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone

from app.schemas.market import OrderBook, OrderBookLevel
from app.services.market_hub import get_shared_quote


def _tick(price: float) -> float:
    if price >= 500:
        return 0.25
    if price >= 100:
        return 0.05
    if price >= 20:
        return 0.01
    return 0.01


def _pseudo(seed: str, i: int) -> float:
    h = hashlib.md5(f"{seed}:{i}".encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


async def build_order_book(symbol: str, levels: int = 12) -> OrderBook:
    """Build a demo L2 ladder from the latest quote (no real depth feed)."""
    symbol = symbol.upper()
    quote, provider, _cached = await get_shared_quote(symbol, max_age=2.0)
    mid = float(quote.price)
    tick = _tick(mid)
    half_spread = max(tick, round(mid * 0.00015, 4))
    # Snap half-spread to tick grid
    half_spread = max(tick, math.ceil(half_spread / tick) * tick)

    best_bid = round(mid - half_spread, 4)
    best_ask = round(mid + half_spread, 4)
    seed = f"{symbol}:{int(quote.timestamp.timestamp()) if hasattr(quote.timestamp, 'timestamp') else quote.timestamp}"

    bids: list[OrderBookLevel] = []
    asks: list[OrderBookLevel] = []
    base_size = max(50.0, (quote.volume or 1_000_000) / 80_000)

    for i in range(levels):
        r_bid = _pseudo(seed, i)
        r_ask = _pseudo(seed, i + 100)
        bid_px = round(best_bid - i * tick, 4)
        ask_px = round(best_ask + i * tick, 4)
        bid_sz = round(base_size * (1.2 - i * 0.04) * (0.55 + r_bid), 0)
        ask_sz = round(base_size * (1.2 - i * 0.04) * (0.55 + r_ask), 0)
        bid_n = max(1, int(2 + r_bid * 8))
        ask_n = max(1, int(2 + r_ask * 8))
        bids.append(OrderBookLevel(price=bid_px, size=max(1, bid_sz), orders=bid_n))
        asks.append(OrderBookLevel(price=ask_px, size=max(1, ask_sz), orders=ask_n))

    spread = round(best_ask - best_bid, 4)
    return OrderBook(
        symbol=symbol,
        bids=bids,
        asks=asks,
        mid=round(mid, 4),
        spread=spread,
        timestamp=datetime.now(timezone.utc),
        synthetic=True,
        provider=provider,
    )
