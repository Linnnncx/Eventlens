from datetime import datetime, timezone

from app.providers.factory import ProviderFactory
from app.core.config import Settings
from app.services.events import align_event_to_bar
from app.services.trading import evaluate_risk_rules
from app.schemas.market import NewsItem
from app.providers.llm.providers import RuleBasedLLMProvider
import pytest


def test_align_event_to_bar_5min():
    ts = datetime(2026, 7, 30, 18, 32, tzinfo=timezone.utc)  # 14:32 ET during EDT
    aligned = align_event_to_bar(ts, "5Min", "America/New_York")
    local_minute = aligned.astimezone(__import__("zoneinfo").ZoneInfo("America/New_York")).minute
    assert local_minute == 30


def test_risk_rules_concentration():
    warnings = evaluate_risk_rules(
        {
            "positionWeightAfter": 0.3,
            "sectorWeightAfter": 0.6,
            "cashRatioAfter": 0.05,
            "orderPctOfEquity": 0.25,
            "priceChangeSinceEvent": 0.08,
            "volumeRatio": 4,
            "hasStopLoss": False,
            "minutesSinceEvent": 10,
            "eventImportance": "high",
        }
    )
    assert "single_position_concentration" in warnings
    assert "sector_concentration" in warnings
    assert "missing_stop_loss" in warnings


@pytest.mark.asyncio
async def test_rule_llm_analyze():
    llm = RuleBasedLLMProvider()
    result = await llm.analyze_news({"headline": "Company beats earnings expectations", "summary": "EPS surge"})
    assert result.event_type == "earnings"
    assert result.direction == "positive"


def test_provider_factory_fixture_mode():
    settings = Settings(fixture_mode=True, market_data_provider="yfinance")
    factory = ProviderFactory(settings)
    market = factory.create_market_provider()
    assert market.name == "fixture"


def test_provider_factory_schema_parity_names():
    yf = ProviderFactory(Settings(market_data_provider="yfinance", fixture_mode=False)).create_market_provider()
    alpaca = ProviderFactory(Settings(market_data_provider="alpaca")).create_market_provider()
    assert hasattr(yf, "get_bars") and hasattr(alpaca, "get_bars")
    assert hasattr(yf, "get_quote") and hasattr(alpaca, "get_quote")


@pytest.mark.asyncio
async def test_fixture_quote_and_bars():
    factory = ProviderFactory(Settings(fixture_mode=True))
    market = factory.create_market_provider()
    news = factory.create_news_provider()
    q = await market.get_quote("NVDA")
    bars = await market.get_bars("NVDA", "5Min", None, None, 100)
    items = await news.get_news("NVDA", None, None, 10)
    assert q.price > 0
    assert len(bars) > 10
    assert len(items) >= 1
    assert q.provider == "fixture"
