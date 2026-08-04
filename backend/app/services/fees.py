"""US equity fee schedule modeled after Futu (富途牛牛) fixed package.

Reference (stocks / ETF, whole shares):
- Commission: $0.0049/share, min $0.99/order
- Platform fee: $0.005/share, min $1.00/order
- Commission + platform capped at 0.5% of notional; if that conflicts with
  per-order minimums, the minimums win
- Clearing / settlement: $0.003/share
- FINRA TAF (sell only): $0.000166/share, min $0.01, max $8.30
- SEC Section 31 fee: $0 (cancelled for Futu from 2025-05-14)

Fractional (<1 share):
- Commission / clearing / TAF: $0
- Platform: 0.99% of notional, min $0.01, max $0.99
"""

from __future__ import annotations

from typing import Any


COMMISSION_PER_SHARE = 0.0049
COMMISSION_MIN = 0.99
PLATFORM_PER_SHARE = 0.005
PLATFORM_MIN = 1.0
SERVICE_CAP_RATE = 0.005  # 0.5% of notional
CLEARING_PER_SHARE = 0.003
TAF_PER_SHARE = 0.000166
TAF_MIN = 0.01
TAF_MAX = 8.30
FRACTIONAL_PLATFORM_RATE = 0.0099
FRACTIONAL_PLATFORM_MIN = 0.01
FRACTIONAL_PLATFORM_MAX = 0.99


def _round_fee(value: float) -> float:
    return round(max(0.0, value), 4)


def calc_futu_us_fee(side: str, quantity: float, price: float) -> dict[str, Any]:
    """Return total fee and a breakdown for one fill."""
    qty = abs(float(quantity))
    px = abs(float(price))
    notional = qty * px
    side_l = (side or "buy").lower()

    if qty <= 0 or px <= 0:
        return {
            "total": 0.0,
            "commission": 0.0,
            "platformFee": 0.0,
            "clearingFee": 0.0,
            "taf": 0.0,
            "notional": 0.0,
            "schedule": "futu_us_fixed",
        }

    # Fractional share promo
    if qty < 1:
        platform = min(
            FRACTIONAL_PLATFORM_MAX,
            max(FRACTIONAL_PLATFORM_MIN, notional * FRACTIONAL_PLATFORM_RATE),
        )
        total = _round_fee(platform)
        return {
            "total": total,
            "commission": 0.0,
            "platformFee": total,
            "clearingFee": 0.0,
            "taf": 0.0,
            "notional": _round_fee(notional),
            "schedule": "futu_us_fractional",
        }

    commission = max(COMMISSION_MIN, qty * COMMISSION_PER_SHARE)
    platform = max(PLATFORM_MIN, qty * PLATFORM_PER_SHARE)
    service = commission + platform
    cap = notional * SERVICE_CAP_RATE
    min_service = COMMISSION_MIN + PLATFORM_MIN
    # Cap at 0.5% of notional, but never below the stated per-order minimums.
    if service > cap:
        service = max(min_service, cap)
        # Keep display split proportional when capped
        if commission + platform > 0:
            ratio_c = commission / (commission + platform)
            commission = service * ratio_c
            platform = service - commission
        else:
            commission = COMMISSION_MIN
            platform = max(0.0, service - commission)

    clearing = qty * CLEARING_PER_SHARE
    taf = 0.0
    if side_l == "sell":
        taf = min(TAF_MAX, max(TAF_MIN, qty * TAF_PER_SHARE))

    total = _round_fee(commission + platform + clearing + taf)
    return {
        "total": total,
        "commission": _round_fee(commission),
        "platformFee": _round_fee(platform),
        "clearingFee": _round_fee(clearing),
        "taf": _round_fee(taf),
        "notional": _round_fee(notional),
        "schedule": "futu_us_fixed",
    }
