from datetime import datetime, timezone

from app.providers.market.yfinance_provider import previous_session_close


def _row(day: int, close: float) -> dict:
    return {
        "timestamp": datetime(2026, 8, day, 13, 30, tzinfo=timezone.utc),
        "close": close,
    }


def test_previous_close_uses_prior_daily_row_not_range_baseline():
    rows = [_row(1, 340.08), _row(3, 303.42), _row(4, 306.45)]
    meta = {
        "regularMarketTime": datetime(2026, 8, 4, 15, 0, tzinfo=timezone.utc).timestamp(),
        "exchangeTimezoneName": "America/New_York",
        "chartPreviousClose": 340.08,
        "previousClose": 303.42,
    }

    assert previous_session_close(rows, meta, 306.45) == 303.42


def test_previous_close_uses_last_row_when_current_session_candle_is_missing():
    rows = [_row(1, 300.0), _row(3, 303.42)]
    meta = {
        "regularMarketTime": datetime(2026, 8, 4, 15, 0, tzinfo=timezone.utc).timestamp(),
        "exchangeTimezoneName": "America/New_York",
        "chartPreviousClose": 290.0,
    }

    assert previous_session_close(rows, meta, 306.45) == 303.42
