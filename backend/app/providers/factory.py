from __future__ import annotations

from app.core.config import Settings, get_settings
from app.providers.llm.providers import DeepSeekLLMProvider, RuleBasedLLMProvider
from app.providers.market.alpaca_provider import AlpacaMarketDataProvider, AlpacaRealtimeProvider
from app.providers.market.fixture_provider import (
    FixtureMarketDataProvider,
    FixtureNewsProvider,
    FixtureRealtimeProvider,
)
from app.providers.market.yfinance_provider import YFinanceMarketDataProvider, YFinanceRealtimeProvider
from app.providers.news.providers import (
    AlpacaNewsProvider,
    FinnhubNewsProvider,
    MergedNewsProvider,
    YFinanceNewsProvider,
)


class ProviderFactory:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def create_market_provider(self):
        if self.settings.fixture_mode or self.settings.market_data_provider == "fixture":
            return FixtureMarketDataProvider()
        if self.settings.market_data_provider == "alpaca":
            return AlpacaMarketDataProvider()
        return YFinanceMarketDataProvider()

    def create_news_provider(self):
        if self.settings.fixture_mode or self.settings.news_provider == "fixture":
            return FixtureNewsProvider()
        if self.settings.news_provider == "alpaca":
            return AlpacaNewsProvider()
        if self.settings.news_provider == "finnhub":
            return FinnhubNewsProvider()
        if self.settings.news_provider == "merged":
            return MergedNewsProvider()
        return YFinanceNewsProvider()

    def create_realtime_provider(self):
        if self.settings.fixture_mode or self.settings.realtime_provider == "fixture":
            return FixtureRealtimeProvider()
        if self.settings.realtime_provider == "alpaca":
            return AlpacaRealtimeProvider()
        return YFinanceRealtimeProvider()

    def create_llm_provider(self):
        if self.settings.llm_provider == "deepseek" and self.settings.deepseek_configured:
            return DeepSeekLLMProvider()
        return RuleBasedLLMProvider()


provider_factory = ProviderFactory()
