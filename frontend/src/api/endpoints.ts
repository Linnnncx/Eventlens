import { apiDelete, apiGet, apiPost, apiPut } from './client';
import type {
  BarsResponse,
  EventsResponse,
  EventReaction,
  MarketStatus,
  NewsAnalysis,
  NewsContent,
  NewsResponse,
  Order,
  OrderBookResponse,
  OrderPreviewRequest,
  OrderPreviewResponse,
  RangeAnalysisReport,
  SimulateOrderResponse,
  PortfolioState,
  ProvidersStatus,
  PublicConfig,
  QuoteResponse,
  SnapshotsResponse,
  SymbolProfile,
  Trade,
  UniverseSymbol,
} from '../types/api';

export function fetchHealth() {
  return apiGet<{ status: string; time: string }>('/health');
}

export function fetchPublicConfig() {
  return apiGet<PublicConfig>('/config/public');
}

export type LlmProviderId = 'rules' | 'openai' | 'deepseek' | 'qwen';

export interface LlmConfigView {
  llmProvider: LlmProviderId;
  effectiveProvider: LlmProviderId;
  deepseekConfigured: boolean;
  deepseekApiKeyMasked: string;
  deepseekHasKey: boolean;
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekTimeoutSeconds: number;
  providerDefaults?: Record<
    Exclude<LlmProviderId, 'rules'>,
    { baseUrl: string; model: string }
  >;
  source: string;
}

export function fetchLlmConfig() {
  return apiGet<LlmConfigView>('/config/llm');
}

export function saveLlmConfig(body: {
  llmProvider?: LlmProviderId;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  deepseekTimeoutSeconds?: number;
  clearKey?: boolean;
}) {
  return apiPut<LlmConfigView>('/config/llm', body);
}

export function fetchProvidersStatus() {
  return apiGet<ProvidersStatus>('/providers/status');
}

export function fetchSymbols(coreOnly = false) {
  return apiGet<{ items: UniverseSymbol[] }>('/symbols', { core_only: coreOnly });
}

export function searchSymbols(q: string, limit = 20, signal?: AbortSignal) {
  return apiGet<{ items: SymbolProfile[] }>('/symbols/search', { q, limit }, signal);
}

export function fetchSymbolProfile(symbol: string) {
  return apiGet<SymbolProfile>(`/symbols/${encodeURIComponent(symbol)}`);
}

export function fetchSnapshots(symbols: string[], signal?: AbortSignal) {
  return apiGet<SnapshotsResponse>('/market/snapshots', { symbols: symbols.join(',') }, signal);
}

export function fetchScreener(equitiesOnly = true, signal?: AbortSignal) {
  return apiGet<SnapshotsResponse>('/market/screener', { equities_only: equitiesOnly }, signal);
}

export function fetchQuote(symbol: string, signal?: AbortSignal) {
  return apiGet<QuoteResponse>(`/market/quote/${encodeURIComponent(symbol)}`, undefined, signal);
}

export function fetchOrderBook(symbol: string, levels = 12, signal?: AbortSignal) {
  return apiGet<OrderBookResponse>(`/market/orderbook/${encodeURIComponent(symbol)}`, { levels }, signal);
}

export function fetchBars(
  symbol: string,
  timeframe: string,
  opts?: { start?: string; end?: string; limit?: number; signal?: AbortSignal },
) {
  return apiGet<BarsResponse>(`/market/bars/${encodeURIComponent(symbol)}`, {
    timeframe,
    start: opts?.start,
    end: opts?.end,
    limit: opts?.limit ?? 300,
  }, opts?.signal);
}

export function fetchMarketStatus() {
  return apiGet<MarketStatus>('/market/status');
}

export function fetchNews(symbol: string, limit = 30, signal?: AbortSignal) {
  return apiGet<NewsResponse>(`/news/${encodeURIComponent(symbol)}`, { limit }, signal);
}

export function fetchNewsContent(newsId: string, signal?: AbortSignal) {
  return apiGet<NewsContent>(`/news/${encodeURIComponent(newsId)}/content`, undefined, signal);
}

export function analyzeNews(newsId: string) {
  return apiPost<NewsAnalysis>(`/news/${encodeURIComponent(newsId)}/analyze`);
}

export function analyzeRange(body: {
  symbol: string;
  timeframe: string;
  start: string;
  end: string;
}) {
  return apiPost<RangeAnalysisReport>('/ai/range-analysis', body);
}

export function fetchEvents(
  symbol: string,
  timeframe: string,
  opts?: { start?: string; end?: string; limit?: number; signal?: AbortSignal },
) {
  return apiGet<EventsResponse>(`/events/${encodeURIComponent(symbol)}`, {
    timeframe,
    start: opts?.start,
    end: opts?.end,
    limit: opts?.limit ?? 300,
  }, opts?.signal);
}

export function fetchEventReaction(symbol: string, eventId: string, timeframe: string, signal?: AbortSignal) {
  return apiGet<EventReaction>(
    `/events/${encodeURIComponent(symbol)}/${encodeURIComponent(eventId)}/reaction`,
    { timeframe },
    signal,
  );
}

export function fetchWatchlist() {
  return apiGet<{ items: string[] }>('/watchlist');
}

export function addToWatchlist(symbol: string) {
  return apiPost<{ ok: boolean; symbol: string }>(`/watchlist/${encodeURIComponent(symbol)}`);
}

export function removeFromWatchlist(symbol: string) {
  return apiDelete<{ ok: boolean }>(`/watchlist/${encodeURIComponent(symbol)}`);
}

export function fetchPortfolio() {
  return apiGet<PortfolioState>('/portfolio');
}

export type EquityHistoryRange = '1d' | '1w' | '1m' | '6m' | '1y';

export interface EquityHistoryPoint {
  t: string;
  equity: number;
  cash: number;
  marketValue: number;
}

export interface EquityHistoryResponse {
  range: EquityHistoryRange;
  points: EquityHistoryPoint[];
  high: number | null;
  low: number | null;
  change: number;
  changePercent: number;
  todayChange: number;
  todayChangePercent: number;
}

export function fetchEquityHistory(range: EquityHistoryRange = '1d') {
  return apiGet<EquityHistoryResponse>('/portfolio/equity-history', { range });
}

export interface ClosedRankingItem {
  symbol: string;
  realizedPnl: number;
  closed: boolean;
}

export function fetchClosedRankings(limit = 20) {
  return apiGet<{ items: ClosedRankingItem[] }>('/portfolio/closed-rankings', { limit });
}

export function fetchPositions() {
  return apiGet<{ items: PortfolioState['positions'] }>('/positions');
}

export function fetchOrders() {
  return apiGet<{ items: Order[] }>('/orders');
}

export function fetchTrades() {
  return apiGet<{ items: Trade[] }>('/trades');
}

export function previewOrder(req: OrderPreviewRequest) {
  return apiPost<OrderPreviewResponse>('/orders/preview', req);
}

export function simulateOrder(req: OrderPreviewRequest) {
  return apiPost<SimulateOrderResponse>('/orders/simulate', req);
}

export function cancelOrder(orderId: string) {
  return apiDelete<{ ok: boolean }>(`/orders/${encodeURIComponent(orderId)}`);
}

export function resetDemo() {
  return apiPost<{ ok: boolean }>('/demo/reset');
}

export interface DanmakuItem {
  id: string;
  symbol: string;
  text: string;
  nickname: string;
  self: boolean;
  tone: string;
  createdAt: number;
}

export function fetchDanmaku(symbol: string, after?: number) {
  return apiGet<{ symbol: string; items: DanmakuItem[] }>(
    `/danmaku/${encodeURIComponent(symbol)}`,
    after != null ? { after } : undefined,
  );
}

export function postDanmaku(symbol: string, text: string, nickname?: string) {
  return apiPost<{ item: DanmakuItem }>(`/danmaku/${encodeURIComponent(symbol)}`, {
    text,
    nickname,
  });
}
