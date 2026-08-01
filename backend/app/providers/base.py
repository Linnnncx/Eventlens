from __future__ import annotations

from datetime import datetime
from typing import AsyncIterator, Optional, Protocol

from app.schemas.market import (
    Bar,
    MarketStatus,
    NewsAnalysis,
    NewsItem,
    Quote,
    RiskSummary,
    Snapshot,
    SymbolProfile,
)


class ProviderUnavailable(Exception):
    def __init__(self, provider: str, message: str):
        self.provider = provider
        self.message = message
        super().__init__(f"{provider}: {message}")


class MarketDataProvider(Protocol):
    name: str

    async def search_symbols(self, query: str, limit: int = 20) -> list[SymbolProfile]: ...

    async def get_symbol_profile(self, symbol: str) -> SymbolProfile: ...

    async def get_snapshots(self, symbols: list[str]) -> list[Snapshot]: ...

    async def get_quote(self, symbol: str) -> Quote: ...

    async def get_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime | None,
        end: datetime | None,
        limit: int | None,
    ) -> list[Bar]: ...

    async def get_market_status(self) -> MarketStatus: ...


class RealtimeMarketProvider(Protocol):
    name: str

    async def subscribe(self, symbols: list[str]) -> None: ...

    async def unsubscribe(self, symbols: list[str]) -> None: ...

    def stream(self) -> AsyncIterator[dict]: ...

    async def close(self) -> None: ...


class NewsProvider(Protocol):
    name: str

    async def get_news(
        self,
        symbol: str,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> list[NewsItem]: ...


class LLMProvider(Protocol):
    name: str

    async def analyze_news(self, payload: dict) -> NewsAnalysis: ...

    async def generate_risk_summary(self, payload: dict) -> RiskSummary: ...
