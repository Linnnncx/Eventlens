from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from app.schemas.market import Bar, EventReaction, NewsItem


def align_event_to_bar(timestamp: datetime, timeframe: str, tz_name: str = "America/New_York") -> datetime:
    """Align news timestamp to the bar bucket start in market timezone, return UTC."""
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    local = timestamp.astimezone(ZoneInfo(tz_name))
    if timeframe == "1Day":
        aligned = local.replace(hour=0, minute=0, second=0, microsecond=0)
    elif timeframe == "1Hour":
        aligned = local.replace(minute=0, second=0, microsecond=0)
    elif timeframe == "15Min":
        minute = (local.minute // 15) * 15
        aligned = local.replace(minute=minute, second=0, microsecond=0)
    elif timeframe == "5Min":
        minute = (local.minute // 5) * 5
        aligned = local.replace(minute=minute, second=0, microsecond=0)
    else:  # 1Min
        aligned = local.replace(second=0, microsecond=0)
    return aligned.astimezone(timezone.utc)


def aggregate_daily_markers(news: list[NewsItem], tz_name: str = "America/New_York") -> list[dict]:
    buckets: dict[str, list[NewsItem]] = {}
    for item in news:
        local = item.published_at.astimezone(ZoneInfo(tz_name))
        key = local.strftime("%Y-%m-%d")
        buckets.setdefault(key, []).append(item)
    out = []
    for day, items in sorted(buckets.items()):
        local_midnight = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=ZoneInfo(tz_name))
        out.append(
            {
                "date": day,
                "timestamp": local_midnight.astimezone(timezone.utc).isoformat(),
                "count": len(items),
                "label": f"{datetime.strptime(day, '%Y-%m-%d').strftime('%b %d')} · {len(items)} Events",
                "newsIds": [i.id for i in items],
            }
        )
    return out


def _price_at_or_before(bars: list[Bar], ts: datetime) -> Optional[float]:
    candidates = [b for b in bars if b.timestamp <= ts]
    if not candidates:
        return None
    return candidates[-1].close


def _price_at_or_after(bars: list[Bar], ts: datetime) -> Optional[float]:
    candidates = [b for b in bars if b.timestamp >= ts]
    if not candidates:
        return None
    return candidates[0].close


def compute_event_reaction(event: NewsItem, bars: list[Bar], symbol: str) -> EventReaction:
    t0 = event.published_at if event.published_at.tzinfo else event.published_at.replace(tzinfo=timezone.utc)
    p0 = _price_at_or_before(bars, t0)

    def pct(delta: timedelta, after: bool) -> Optional[float]:
        if p0 is None:
            return None
        target = t0 + delta if after else t0 - delta
        px = _price_at_or_after(bars, target) if after else _price_at_or_before(bars, target)
        if px is None:
            return None
        if after:
            return (px - p0) / p0
        return (p0 - px) / px if px else None

    window = [b for b in bars if t0 <= b.timestamp <= t0 + timedelta(hours=2)]
    prior = [b for b in bars if t0 - timedelta(days=5) <= b.timestamp < t0]
    vol_ratio = None
    if window and prior:
        avg = sum(b.volume for b in prior) / max(len(prior), 1)
        cur = sum(b.volume for b in window) / max(len(window), 1)
        if avg > 0:
            vol_ratio = cur / avg

    max_up = None
    max_dd = None
    if p0 and window:
        highs = [b.high for b in window]
        lows = [b.low for b in window]
        max_up = (max(highs) - p0) / p0
        max_dd = (min(lows) - p0) / p0

    day_bars = [b for b in bars if b.timestamp.date() == t0.date()]
    return EventReaction(
        eventId=event.id,
        symbol=symbol,
        publishedAt=t0,
        pre5m=pct(timedelta(minutes=5), False),
        pre30m=pct(timedelta(minutes=30), False),
        post5m=pct(timedelta(minutes=5), True),
        post30m=pct(timedelta(minutes=30), True),
        post60m=pct(timedelta(minutes=60), True),
        volumeRatio=vol_ratio,
        maxUp=max_up,
        maxDrawdown=max_dd,
        dayHigh=max((b.high for b in day_bars), default=None),
        dayLow=min((b.low for b in day_bars), default=None),
    )
