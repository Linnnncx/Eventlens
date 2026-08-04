"""Persist lightweight equity snapshots for the mobile asset trend chart."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

_LOCK = threading.Lock()
_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_PATH = _DATA_DIR / "equity_history.json"
_MIN_INTERVAL_SEC = 60  # don't spam identical points

RangeKey = Literal["1d", "1w", "1m", "6m", "1y"]

_RANGE_DELTA: dict[str, timedelta] = {
    "1d": timedelta(days=1),
    "1w": timedelta(days=7),
    "1m": timedelta(days=31),
    "6m": timedelta(days=186),
    "1y": timedelta(days=366),
}


def _load() -> list[dict[str, Any]]:
    if not _PATH.exists():
        return []
    try:
        raw = json.loads(_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    except Exception:
        return []


def _save(points: list[dict[str, Any]]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Keep ~2 years of minute-ish samples capped
    trimmed = points[-20_000:]
    _PATH.write_text(json.dumps(trimmed, ensure_ascii=False), encoding="utf-8")


def record_equity_snapshot(
    equity: float,
    cash: float,
    market_value: float,
    *,
    force: bool = False,
) -> None:
    now = datetime.now(timezone.utc)
    with _LOCK:
        points = _load()
        if points and not force:
            try:
                last_t = datetime.fromisoformat(str(points[-1]["t"]).replace("Z", "+00:00"))
                if last_t.tzinfo is None:
                    last_t = last_t.replace(tzinfo=timezone.utc)
                if (now - last_t).total_seconds() < _MIN_INTERVAL_SEC:
                    # Still update if equity moved meaningfully
                    last_eq = float(points[-1].get("equity") or 0)
                    if abs(last_eq - equity) < 0.05:
                        return
            except Exception:
                pass
        points.append(
            {
                "t": now.isoformat(),
                "equity": round(float(equity), 4),
                "cash": round(float(cash), 4),
                "marketValue": round(float(market_value), 4),
            }
        )
        _save(points)


def ensure_baseline(initial_cash: float, created_at: datetime | None = None) -> None:
    """Seed history with starting capital if empty."""
    with _LOCK:
        points = _load()
        if points:
            return
        ts = created_at or datetime.now(timezone.utc)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        points.append(
            {
                "t": ts.isoformat(),
                "equity": round(float(initial_cash), 4),
                "cash": round(float(initial_cash), 4),
                "marketValue": 0.0,
            }
        )
        _save(points)


def get_equity_history(
    range_key: str,
    *,
    current_equity: float | None = None,
    current_cash: float | None = None,
    current_mv: float | None = None,
) -> dict[str, Any]:
    key = range_key if range_key in _RANGE_DELTA else "1d"
    delta = _RANGE_DELTA[key]
    now = datetime.now(timezone.utc)
    cutoff = now - delta

    with _LOCK:
        points = _load()

    series: list[dict[str, Any]] = []
    for p in points:
        try:
            t = datetime.fromisoformat(str(p["t"]).replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            if t >= cutoff:
                series.append(
                    {
                        "t": t.isoformat(),
                        "equity": float(p["equity"]),
                        "cash": float(p.get("cash") or 0),
                        "marketValue": float(p.get("marketValue") or 0),
                    }
                )
        except Exception:
            continue

    # Always append live point so the chart reaches "now"
    if current_equity is not None:
        live = {
            "t": now.isoformat(),
            "equity": round(float(current_equity), 4),
            "cash": round(float(current_cash or 0), 4),
            "marketValue": round(float(current_mv or 0), 4),
        }
        if series:
            try:
                last_t = datetime.fromisoformat(series[-1]["t"].replace("Z", "+00:00"))
                if last_t.tzinfo is None:
                    last_t = last_t.replace(tzinfo=timezone.utc)
                if (now - last_t).total_seconds() < 30:
                    series[-1] = live
                else:
                    series.append(live)
            except Exception:
                series.append(live)
        else:
            series.append(live)

    # Downsample for large ranges (keep chart snappy)
    max_points = {"1d": 400, "1w": 500, "1m": 600, "6m": 700, "1y": 800}.get(key, 500)
    if len(series) > max_points:
        step = max(1, len(series) // max_points)
        kept = series[::step]
        if kept[-1] is not series[-1]:
            kept.append(series[-1])
        series = kept

    equities = [p["equity"] for p in series]
    high = max(equities) if equities else None
    low = min(equities) if equities else None
    start_eq = equities[0] if equities else None
    end_eq = equities[-1] if equities else None
    change = (end_eq - start_eq) if start_eq is not None and end_eq is not None else 0.0
    change_pct = (change / start_eq * 100) if start_eq else 0.0

    # Today change: from midnight UTC-ish — use first point of calendar day in America/New_York approx via local UTC day
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_pts = []
    for p in points:
        try:
            t = datetime.fromisoformat(str(p["t"]).replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            if t >= day_start:
                day_pts.append(float(p["equity"]))
        except Exception:
            pass
    if current_equity is not None:
        day_pts.append(float(current_equity))
    today_start = day_pts[0] if day_pts else end_eq
    today_change = (end_eq - today_start) if today_start is not None and end_eq is not None else 0.0
    today_pct = (today_change / today_start * 100) if today_start else 0.0

    return {
        "range": key,
        "points": series,
        "high": high,
        "low": low,
        "change": change,
        "changePercent": change_pct,
        "todayChange": today_change,
        "todayChangePercent": today_pct,
    }


def clear_equity_history() -> None:
    with _LOCK:
        if _PATH.exists():
            _PATH.unlink()
