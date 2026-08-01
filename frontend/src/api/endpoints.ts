import { apiDelete, apiGet, apiPost } from './client';
import type {
  BarsResponse,
  EventsResponse,
  EventReaction,
  MarketStatus,
  NewsAnalysis,
  NewsContent,
  NewsResponse,
  Order,
  OrderPreviewRequest,
  OrderPreviewResponse,
  SimulateOrderResponse,
  PortfolioState,
  ProvidersStatus,
  PublicConfig,
  QuoteResponse,
  SnapshotsResponse,
  SymbolProfile,
  UniverseSymbol,
} from '../types/api';

export function fetchHealth() {
  return apiGet<{ status: string; time: string }>('/health');
}

export function fetchPublicConfig() {
  return apiGet<PublicConfig>('/config/public');
}

export function fetchProvidersStatus() {
  return apiGet<ProvidersStatus>('/providers/status');
}

export function fetchSymbols(coreOnly = false) {
  return apiGet<{ items: UniverseSymbol[] }>('/symbols', { core_only: coreOnly });
}

export function searchSymbols(q: string, limit = 20) {
  return apiGet<{ items: SymbolProfile[] }>('/symbols/search', { q, limit });
}

export function fetchSymbolProfile(symbol: string) {
  return apiGet<SymbolProfile>(`/symbols/${encodeURIComponent(symbol)}`);
}

export function fetchSnapshots(symbols: string[]) {
  return apiGet<SnapshotsResponse>('/market/snapshots', { symbols: symbols.join(',') });
}

export function fetchQuote(symbol: string) {
  return apiGet<QuoteResponse>(`/market/quote/${encodeURIComponent(symbol)}`);
}

export function fetchBars(
  symbol: string,
  timeframe: string,
  opts?: { start?: string; end?: string; limit?: number },
) {
  return apiGet<BarsResponse>(`/market/bars/${encodeURIComponent(symbol)}`, {
    timeframe,
    start: opts?.start,
    end: opts?.end,
    limit: opts?.limit ?? 300,
  });
}

export function fetchMarketStatus() {
  return apiGet<MarketStatus>('/market/status');
}

export function fetchNews(symbol: string, limit = 30) {
  return apiGet<NewsResponse>(`/news/${encodeURIComponent(symbol)}`, { limit });
}

export function fetchNewsContent(newsId: string) {
  return apiGet<NewsContent>(`/news/${encodeURIComponent(newsId)}/content`);
}

export function analyzeNews(newsId: string) {
  return apiPost<NewsAnalysis>(`/news/${encodeURIComponent(newsId)}/analyze`);
}

export function fetchEvents(
  symbol: string,
  timeframe: string,
  opts?: { start?: string; end?: string; limit?: number },
) {
  return apiGet<EventsResponse>(`/events/${encodeURIComponent(symbol)}`, {
    timeframe,
    start: opts?.start,
    end: opts?.end,
    limit: opts?.limit ?? 300,
  });
}

export function fetchEventReaction(symbol: string, eventId: string, timeframe: string) {
  return apiGet<EventReaction>(
    `/events/${encodeURIComponent(symbol)}/${encodeURIComponent(eventId)}/reaction`,
    { timeframe },
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

export function fetchPositions() {
  return apiGet<{ items: PortfolioState['positions'] }>('/positions');
}

export function fetchOrders() {
  return apiGet<{ items: Order[] }>('/orders');
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
