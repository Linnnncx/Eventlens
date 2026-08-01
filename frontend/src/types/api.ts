export type EventType =
  | 'earnings'
  | 'guidance'
  | 'product'
  | 'regulation'
  | 'analyst'
  | 'management'
  | 'macro'
  | 'legal'
  | 'company_update'
  | 'other';

export type Importance = 'low' | 'medium' | 'high';
export type Direction = 'positive' | 'negative' | 'neutral' | 'uncertain';
export type TimeHorizon = 'immediate' | 'short_term' | 'medium_term' | 'long_term';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type Timeframe = '1Min' | '5Min' | '15Min' | '1Hour' | '1Day';

export interface ProviderMeta {
  provider: string;
  fetchedAt: string;
  cached: boolean;
  delayed: boolean;
  stale: boolean;
  errorMessage: string | null;
  fixture: boolean;
}

export interface SymbolProfile {
  symbol: string;
  name: string;
  exchange: string;
  assetType: string;
  sector: string;
  industry: string;
  currency: string;
  timezone: string;
  logoUrl: string | null;
}

export interface UniverseSymbol {
  symbol: string;
  name: string;
  sector?: string;
  isCore?: boolean;
}

export interface Bar {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number | null;
}

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  marketState: string;
  timestamp: string;
  delayed: boolean;
  provider: string;
}

export interface Snapshot {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  sector: string;
  provider: string;
  timestamp: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  summaryOriginal: string | null;
  summaryAi: string | null;
  source: string;
  url: string | null;
  imageUrl?: string | null;
  publishedAt: string;
  symbols: string[];
  eventType: EventType;
  importance: Importance;
  direction: Direction;
  timeHorizon: TimeHorizon;
  provider: string;
  keyPoints: string[];
  uncertainties: string[];
}

export interface NewsContent {
  newsId: string;
  url: string | null;
  body: string;
  cached: boolean;
}

export interface NewsAnalysis {
  summaryZh: string;
  eventType: EventType;
  importance: Importance;
  direction: Direction;
  timeHorizon: TimeHorizon;
  keyPoints: string[];
  uncertainties: string[];
}

export interface RiskSummary {
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  attentionPoints: string[];
  disclaimer: string;
}

export interface BarsResponse {
  symbol: string;
  timeframe: string;
  start: string | null;
  end: string | null;
  bars: Bar[];
  meta: ProviderMeta;
}

export interface QuoteResponse {
  quote: Quote;
  meta: ProviderMeta;
}

export interface SnapshotsResponse {
  snapshots: Snapshot[];
  meta: ProviderMeta;
}

export interface NewsResponse {
  items: NewsItem[];
  meta: ProviderMeta;
}

export interface MarketStatus {
  market: string;
  isOpen: boolean;
  session: string;
  timezone: string;
  serverTime: string;
}

export interface EventMarker {
  newsId: string;
  timestamp: string;
  eventType: EventType;
  importance: Importance;
  headline: string;
}

export interface DailyEventMarker {
  date: string;
  timestamp: string;
  count: number;
  label: string;
  newsIds: string[];
}

export interface EventsResponse {
  symbol: string;
  timeframe: string;
  markers: EventMarker[] | DailyEventMarker[];
  items: NewsItem[];
  /** Upstream or sqlite — where this payload was served from. */
  source?: string;
  /** True when served from the local news DB (no upstream wait). */
  cached?: boolean;
  count?: number;
}

export interface EventReaction {
  eventId: string;
  symbol: string;
  publishedAt: string;
  pre5m: number | null;
  pre30m: number | null;
  post5m: number | null;
  post30m: number | null;
  post60m: number | null;
  volumeRatio: number | null;
  maxUp: number | null;
  maxDrawdown: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  disclaimer: string;
}

export interface OrderPreviewRequest {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity?: number | null;
  notional?: number | null;
  limitPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  extendedHours?: boolean;
  newsId?: string | null;
}

export interface OrderPreviewResponse {
  estimatedValue: number;
  estimatedFee: number;
  cashBefore: number;
  cashAfter: number;
  positionWeightBefore: number;
  positionWeightAfter: number;
  sectorWeightAfter: number;
  cashRatioAfter: number;
  orderPctOfEquity: number;
  price: number;
  quantity: number;
  ruleWarnings: string[];
  risk: RiskSummary;
  canSubmit: boolean;
  rejectReason: string | null;
}

export interface SimulateOrderResponse {
  orderId: string;
  status: string;
  preview: OrderPreviewResponse;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  price: number;
  marketValue: number;
  pnl: number;
  pnlPercent: number;
  weight: number;
  sector: string;
}

export interface PortfolioState {
  cash: number;
  equity: number;
  marketValue: number;
  initialCash: number;
  pnl: number;
  pnlPercent: number;
  positions: Position[];
  sectorWeights: Record<string, number>;
}

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  status: string;
  filledPrice: number | null;
  filledAt: string | null;
  newsId: string | null;
  createdAt: string;
}

export interface PublicConfig {
  marketDataProvider: string;
  newsProvider: string;
  realtimeProvider: string;
  llmProvider: string;
  fixtureMode: boolean;
  timezone: string;
  initialCash: number;
  alpacaConfigured: boolean;
  deepseekConfigured: boolean;
}

export interface ProvidersStatus {
  market: string;
  news: string;
  realtime: string;
  llm: string;
  yfinance: string;
  alpacaConfigured: boolean;
  deepseekConfigured: boolean;
  fixtureEnabled: boolean;
}

export interface WsQuoteMessage {
  type: 'quote';
  symbol: string;
  price: number;
  timestamp: string;
  provider: string;
}

export interface WsHelloMessage {
  type: 'hello';
  message: string;
}

export interface WsSubscribedMessage {
  type: 'subscribed';
  symbols: string[];
}

export type WsMessage = WsQuoteMessage | WsHelloMessage | WsSubscribedMessage | { type: 'pong' };
