from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ProviderMeta(BaseModel):
    provider: str
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    cached: bool = False
    delayed: bool = False
    stale: bool = False
    error_message: Optional[str] = None
    fixture: bool = False


class SymbolProfile(BaseModel):
    symbol: str
    name: str
    exchange: str = "NASDAQ"
    asset_type: str = Field(default="equity", alias="assetType")
    sector: str = "Unknown"
    industry: str = "Unknown"
    currency: str = "USD"
    timezone: str = "America/New_York"
    logo_url: Optional[str] = Field(default=None, alias="logoUrl")

    model_config = {"populate_by_name": True}


class Bar(BaseModel):
    symbol: str
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    vwap: Optional[float] = None


class Quote(BaseModel):
    symbol: str
    price: float
    previous_close: float = Field(alias="previousClose")
    change: float
    change_percent: float = Field(alias="changePercent")
    day_high: float = Field(alias="dayHigh")
    day_low: float = Field(alias="dayLow")
    volume: float
    market_state: str = Field(default="regular", alias="marketState")
    timestamp: datetime
    delayed: bool = False
    provider: str = "yfinance"

    model_config = {"populate_by_name": True}


class Snapshot(BaseModel):
    symbol: str
    name: str = ""
    price: float
    previous_close: float = Field(alias="previousClose")
    change: float
    change_percent: float = Field(alias="changePercent")
    day_high: float = Field(default=0, alias="dayHigh")
    day_low: float = Field(default=0, alias="dayLow")
    volume: float = 0
    sector: str = "Unknown"
    provider: str = "yfinance"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = {"populate_by_name": True}


EventType = Literal[
    "earnings",
    "guidance",
    "product",
    "regulation",
    "analyst",
    "management",
    "macro",
    "legal",
    "company_update",
    "other",
]
Importance = Literal["low", "medium", "high"]
Direction = Literal["positive", "negative", "neutral", "uncertain"]
TimeHorizon = Literal["immediate", "short_term", "medium_term", "long_term"]


class NewsItem(BaseModel):
    id: str
    headline: str
    summary_original: Optional[str] = Field(default=None, alias="summaryOriginal")
    summary_ai: Optional[str] = Field(default=None, alias="summaryAi")
    source: str = "Yahoo Finance"
    url: Optional[str] = None
    image_url: Optional[str] = Field(default=None, alias="imageUrl")
    published_at: datetime = Field(alias="publishedAt")
    symbols: list[str] = Field(default_factory=list)
    event_type: EventType = Field(default="other", alias="eventType")
    importance: Importance = "medium"
    direction: Direction = "uncertain"
    time_horizon: TimeHorizon = Field(default="short_term", alias="timeHorizon")
    provider: str = "yfinance"
    key_points: list[str] = Field(default_factory=list, alias="keyPoints")
    uncertainties: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class NewsAnalysis(BaseModel):
    summary_zh: str = Field(alias="summaryZh")
    event_type: EventType = Field(alias="eventType")
    importance: Importance
    direction: Direction
    time_horizon: TimeHorizon = Field(alias="timeHorizon")
    key_points: list[str] = Field(default_factory=list, alias="keyPoints")
    uncertainties: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class RiskSummary(BaseModel):
    summary: str
    risk_level: Literal["low", "medium", "high"] = Field(alias="riskLevel")
    attention_points: list[str] = Field(default_factory=list, alias="attentionPoints")
    disclaimer: str = "以上为基于规则事实的风险说明，不构成投资建议或买卖指令。"

    model_config = {"populate_by_name": True}


class BarsResponse(BaseModel):
    symbol: str
    timeframe: str
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    bars: list[Bar]
    meta: ProviderMeta


class QuoteResponse(BaseModel):
    quote: Quote
    meta: ProviderMeta


class SnapshotsResponse(BaseModel):
    snapshots: list[Snapshot]
    meta: ProviderMeta


class NewsResponse(BaseModel):
    items: list[NewsItem]
    meta: ProviderMeta


class MarketStatus(BaseModel):
    market: str = "US"
    is_open: bool = Field(alias="isOpen")
    session: str = "closed"
    timezone: str = "America/New_York"
    server_time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="serverTime")

    model_config = {"populate_by_name": True}


class EventReaction(BaseModel):
    event_id: str = Field(alias="eventId")
    symbol: str
    published_at: datetime = Field(alias="publishedAt")
    pre_5m: Optional[float] = Field(default=None, alias="pre5m")
    pre_30m: Optional[float] = Field(default=None, alias="pre30m")
    post_5m: Optional[float] = Field(default=None, alias="post5m")
    post_30m: Optional[float] = Field(default=None, alias="post30m")
    post_60m: Optional[float] = Field(default=None, alias="post60m")
    volume_ratio: Optional[float] = Field(default=None, alias="volumeRatio")
    max_up: Optional[float] = Field(default=None, alias="maxUp")
    max_drawdown: Optional[float] = Field(default=None, alias="maxDrawdown")
    day_high: Optional[float] = Field(default=None, alias="dayHigh")
    day_low: Optional[float] = Field(default=None, alias="dayLow")
    disclaimer: str = "事件与价格变化在时间上相关，不代表该事件是价格变化的唯一原因。"

    model_config = {"populate_by_name": True}


class OrderPreviewRequest(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    order_type: Literal["market", "limit"] = Field(alias="orderType")
    quantity: Optional[float] = None
    notional: Optional[float] = None
    limit_price: Optional[float] = Field(default=None, alias="limitPrice")
    stop_loss: Optional[float] = Field(default=None, alias="stopLoss")
    take_profit: Optional[float] = Field(default=None, alias="takeProfit")
    extended_hours: bool = Field(default=False, alias="extendedHours")
    news_id: Optional[str] = Field(default=None, alias="newsId")

    model_config = {"populate_by_name": True}


class OrderPreviewResponse(BaseModel):
    estimated_value: float = Field(alias="estimatedValue")
    estimated_fee: float = Field(alias="estimatedFee")
    cash_before: float = Field(alias="cashBefore")
    cash_after: float = Field(alias="cashAfter")
    position_weight_before: float = Field(alias="positionWeightBefore")
    position_weight_after: float = Field(alias="positionWeightAfter")
    sector_weight_after: float = Field(alias="sectorWeightAfter")
    cash_ratio_after: float = Field(alias="cashRatioAfter")
    order_pct_of_equity: float = Field(alias="orderPctOfEquity")
    price: float
    quantity: float
    rule_warnings: list[str] = Field(default_factory=list, alias="ruleWarnings")
    risk: RiskSummary
    can_submit: bool = Field(alias="canSubmit")
    reject_reason: Optional[str] = Field(default=None, alias="rejectReason")

    model_config = {"populate_by_name": True}


class PortfolioState(BaseModel):
    cash: float
    equity: float
    market_value: float = Field(alias="marketValue")
    initial_cash: float = Field(alias="initialCash")
    pnl: float
    pnl_percent: float = Field(alias="pnlPercent")
    positions: list[dict[str, Any]]
    sector_weights: dict[str, float] = Field(default_factory=dict, alias="sectorWeights")

    model_config = {"populate_by_name": True}
