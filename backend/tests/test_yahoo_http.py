from datetime import datetime, timezone

from app.providers.yahoo_http import chart_to_ohlcv


def _timestamp(year: int, month: int, day: int, hour: int = 13, minute: int = 30) -> int:
    return int(datetime(year, month, day, hour, minute, tzinfo=timezone.utc).timestamp())


def test_latest_daily_bar_uses_same_session_market_price_when_close_is_null():
    prior = _timestamp(2026, 7, 31)
    latest = _timestamp(2026, 8, 3)
    result = {
        "meta": {
            "regularMarketPrice": 590.24,
            "regularMarketTime": _timestamp(2026, 8, 3, 20, 0),
            "exchangeTimezoneName": "America/New_York",
        },
        "timestamp": [prior, latest],
        "indicators": {
            "quote": [
                {
                    "open": [543.6, 562.42],
                    "high": [558.0, 597.52],
                    "low": [540.0, 559.36],
                    "close": [556.71, None],
                    "volume": [18_000_000, 24_169_883],
                }
            ]
        },
    }

    rows = chart_to_ohlcv(result)

    assert len(rows) == 2
    assert rows[-1]["timestamp"] == datetime.fromtimestamp(latest, tz=timezone.utc)
    assert rows[-1]["close"] == 590.24
    assert rows[-1]["open"] == 562.42
    assert rows[-1]["volume"] == 24_169_883


def test_null_close_is_not_filled_from_a_different_trading_date():
    historical = _timestamp(2026, 7, 31)
    result = {
        "meta": {
            "regularMarketPrice": 590.24,
            "regularMarketTime": _timestamp(2026, 8, 3, 20, 0),
            "exchangeTimezoneName": "America/New_York",
        },
        "timestamp": [historical],
        "indicators": {
            "quote": [
                {
                    "open": [543.6],
                    "high": [558.0],
                    "low": [540.0],
                    "close": [None],
                    "volume": [18_000_000],
                }
            ]
        },
    }

    assert chart_to_ohlcv(result) == []


def test_earlier_null_close_remains_a_gap():
    earlier = _timestamp(2026, 7, 31)
    latest = _timestamp(2026, 8, 3)
    result = {
        "meta": {
            "regularMarketPrice": 590.24,
            "regularMarketTime": _timestamp(2026, 8, 3, 20, 0),
            "exchangeTimezoneName": "America/New_York",
        },
        "timestamp": [earlier, latest],
        "indicators": {
            "quote": [
                {
                    "open": [543.6, 562.42],
                    "high": [558.0, 597.52],
                    "low": [540.0, 559.36],
                    "close": [None, None],
                    "volume": [18_000_000, 24_169_883],
                }
            ]
        },
    }

    rows = chart_to_ohlcv(result)

    assert len(rows) == 1
    assert rows[0]["timestamp"] == datetime.fromtimestamp(latest, tz=timezone.utc)
    assert rows[0]["close"] == 590.24
