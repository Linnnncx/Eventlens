import pytest

from app.core.config import Settings
from scripts import news_scheduler
from scripts.news_scheduler import resolve_symbols


def test_resolve_symbols_prioritizes_explicit_and_watchlist():
    assert resolve_symbols(
        explicit=["nvda", "AAPL"],
        watchlist=["AAPL", "MSFT"],
        core=["TSLA", "META"],
        max_symbols=4,
    ) == ["NVDA", "AAPL", "MSFT", "TSLA"]


def test_resolve_symbols_enforces_positive_cap():
    assert resolve_symbols([], [], ["AAPL", "MSFT"], 0) == ["AAPL"]


@pytest.mark.asyncio
async def test_run_cycle_limits_concurrency_and_survives_symbol_failure(monkeypatch):
    settings = Settings(news_scheduler_concurrency=1)
    events: list[tuple[str, object]] = []
    active = 0
    max_active = 0

    monkeypatch.setattr(news_scheduler, "configured_symbols", lambda _settings: ["AAPL", "FAIL", "MSFT"])
    monkeypatch.setattr(
        news_scheduler,
        "write_heartbeat",
        lambda status, **extra: events.append((status, extra)),
    )

    async def fake_refresh(symbol, _settings):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        try:
            if symbol == "FAIL":
                raise RuntimeError("upstream unavailable")
            return symbol, 2, "fixture"
        finally:
            active -= 1

    monkeypatch.setattr(news_scheduler, "refresh_symbol", fake_refresh)
    await news_scheduler.run_cycle(settings)

    assert max_active == 1
    assert events[-1][0] == "ok"
    assert events[-1][1]["completed"] == 3
    assert events[-1][1]["failures"] == 1
