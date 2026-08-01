import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LogicalRange } from 'lightweight-charts';
import {
  ArrowLeft,
  Newspaper,
  ShoppingCart,
  Star,
  StarOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  addToWatchlist,
  fetchBars,
  fetchEvents,
  fetchOrders,
  fetchPortfolio,
  fetchQuote,
  fetchWatchlist,
  removeFromWatchlist,
} from '../api/endpoints';
import { SearchBox } from '../components/SearchBox';
import { PriceFlash } from '../components/PriceFlash';
import { EmptyState } from '../components/EmptyState';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  ResizeHandle,
  useWorkbenchLayout,
} from '../components/ResizeHandle';
import { ChartPanel, type BarHoverPayload } from '../features/chart/ChartPanel';
import { indexNewsByBar, visibleNewsForBars } from '../features/chart/newsAnchors';
import { IndicatorPane } from '../features/chart/IndicatorPane';
import {
  loadMainIndicators,
  loadSubIndicators,
  saveMainIndicators,
  saveSubIndicators,
  type MainIndicatorId,
  type SubIndicatorId,
} from '../features/chart/indicatorConfig';
import { NewsPanel } from '../features/news/NewsPanel';
import { TradePanel } from '../features/trading/TradePanel';
import { TradeSheet } from '../features/trading/TradeSheet';
import { useMarketSocket } from '../hooks/useMarketSocket';
import { useAccountStore } from '../stores/accountStore';
import { useWorkbenchStore } from '../stores/workbenchStore';
import type { NewsItem, Order, Position, Timeframe } from '../types/api';
import {
  changeColorClass,
  formatCompact,
  formatCurrency,
  formatPercent,
  formatMarketTime,
  marketSessionOf,
  marketSessionLabel,
  marketSessionClass,
} from '../utils/format';
import { newsWindowForTimeframe, timeframeSeconds } from '../utils/eventAlign';

const TIMEFRAMES: Timeframe[] = ['1Min', '5Min', '15Min', '1Hour', '1Day'];

type BottomTab = 'news' | 'positions' | 'orders' | 'trades';

export function WorkbenchPage() {
  const { symbol: routeSymbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const symbol = (routeSymbol ?? 'AAPL').toUpperCase();
  const timeframe = useWorkbenchStore((s) => s.timeframe);
  const setTimeframe = useWorkbenchStore((s) => s.setTimeframe);
  const setSymbol = useWorkbenchStore((s) => s.setSymbol);
  const selectedEventId = useWorkbenchStore((s) => s.selectedEventId);
  const selectEvent = useWorkbenchStore((s) => s.selectEvent);
  const rightPanel = useWorkbenchStore((s) => s.rightPanel);
  const setRightPanel = useWorkbenchStore((s) => s.setRightPanel);
  const tradeSide = useWorkbenchStore((s) => s.tradeSide);
  const openTrade = useWorkbenchStore((s) => s.openTrade);
  const recentSymbols = useWorkbenchStore((s) => s.recentSymbols);
  const setPortfolio = useAccountStore((s) => s.setPortfolio);
  const getPosition = useAccountStore((s) => s.getPosition);

  const [bottomTab, setBottomTab] = useState<BottomTab>('news');
  const [tradeSheetOpen, setTradeSheetOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'news' | 'trade' | null>(null);
  const [hoveredBarTime, setHoveredBarTime] = useState<number | null>(null);
  const [hoveredNews, setHoveredNews] = useState<NewsItem[]>([]);
  const [chartVisibleRange, setChartVisibleRange] = useState<LogicalRange | null>(null);
  const [enabledMain, setEnabledMain] = useState<MainIndicatorId[]>(loadMainIndicators);
  const [enabledSub, setEnabledSub] = useState<SubIndicatorId[]>(loadSubIndicators);
  const { layout, nudge, nudgeMany, reset, resetAll } = useWorkbenchLayout();

  const requestIndicatorHeightDelta = useCallback(
    (delta: number) => {
      nudge('indicatorHeight', delta);
    },
    [nudge],
  );

  const toggleMainIndicator = useCallback((id: MainIndicatorId) => {
    setEnabledMain((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      saveMainIndicators(next);
      return next;
    });
  }, []);

  const toggleSubIndicator = useCallback((id: SubIndicatorId) => {
    setEnabledSub((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      saveSubIndicators(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (routeSymbol) setSymbol(routeSymbol);
  }, [routeSymbol, setSymbol]);

  // Reset hover / zoom context when symbol / timeframe changes
  useEffect(() => {
    setHoveredBarTime(null);
    setHoveredNews([]);
    setChartVisibleRange(null);
    selectEvent(null);
  }, [symbol, timeframe, selectEvent]);

  const { data: quoteData, isLoading: quoteLoading, isError: quoteError } = useQuery({
    queryKey: ['quote', symbol],
    queryFn: () => fetchQuote(symbol),
    refetchInterval: 15_000,
  });

  const { data: barsData, isLoading: barsLoading } = useQuery({
    queryKey: ['bars', symbol, timeframe],
    queryFn: () => fetchBars(symbol, timeframe, { limit: 300 }),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  // Fire the news request in parallel with bars (don't wait for the chart to load).
  // We approximate the window from the timeframe so both calls start at once; the
  // backend buckets its cache by day, so an approximate start stays cache-friendly.
  const newsWindow = useMemo(() => newsWindowForTimeframe(timeframe), [timeframe]);

  const {
    data: eventsData,
    isFetching: newsFetching,
    isError: newsError,
  } = useQuery({
    queryKey: ['events', symbol, timeframe, newsWindow.start, newsWindow.limit],
    queryFn: () => fetchEvents(symbol, timeframe, { start: newsWindow.start, limit: newsWindow.limit }),
    refetchInterval: 120_000,
    staleTime: 60_000,
    // Do NOT keepPreviousData across symbols — a failed/empty prior fetch would
    // blank the news panel and make it look like the DB cache never existed.
    retry: 2,
  });

  // Drop any stale selection that doesn't belong to the current symbol's feed
  useEffect(() => {
    const items = eventsData?.items;
    if (!items || !selectedEventId) return;
    if (!items.some((i) => i.id === selectedEventId)) {
      selectEvent(null);
    }
  }, [eventsData, selectedEventId, selectEvent]);

  const { data: watchlist } = useQuery({
    queryKey: ['watchlist'],
    queryFn: fetchWatchlist,
  });

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    refetchInterval: 30_000,
  });

  const { data: orders } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (portfolio) setPortfolio(portfolio);
  }, [portfolio, setPortfolio]);

  const watchSymbols = watchlist?.items ?? [];
  const socketSymbols = useMemo(
    () => [...new Set([symbol, ...watchSymbols, ...recentSymbols])],
    [symbol, watchSymbols, recentSymbols],
  );
  const { quotes } = useMarketSocket(socketSymbols);

  const livePrice = quotes[symbol]?.price ?? quoteData?.quote.price ?? 0;
  const changePct = quoteData?.quote.changePercent ?? 0;
  const position = getPosition(symbol);

  const handleBarHover = useCallback(
    (payload: BarHoverPayload) => {
      setHoveredBarTime(payload.barTime);
      setHoveredNews(payload.items);
      setBottomTab('news');
      setRightPanel('news');
      if (payload.items.length === 0) {
        selectEvent(null);
        return;
      }
      const stillThere = payload.items.some((i) => i.id === selectedEventId);
      if (!stillThere) {
        selectEvent(payload.items[0]!.id);
      }
    },
    [selectEvent, setRightPanel, selectedEventId],
  );

  const handleSelectNews = useCallback(
    (id: string) => {
      selectEvent(id);
      setRightPanel('news');
      setMobilePanel('news');
    },
    [selectEvent, setRightPanel],
  );

  const selectedEvent: NewsItem | null = useMemo(() => {
    if (selectedEventId) {
      const fromHover = hoveredNews.find((i) => i.id === selectedEventId);
      if (fromHover) return fromHover;
      const fromAll = eventsData?.items?.find((i) => i.id === selectedEventId);
      if (fromAll) return fromAll;
    }
    if (hoveredBarTime != null) {
      return hoveredNews[0] ?? null;
    }
    return null;
  }, [hoveredBarTime, hoveredNews, selectedEventId, eventsData]);

  // While a bar is hovered/pinned the list must show exactly that bar's news, even
  // when it is empty — otherwise the list silently falls back to the newest window
  // items and appears to disagree with the candle under the crosshair.
  const newsTabItems = useMemo(() => {
    if (hoveredBarTime != null) return hoveredNews;
    return visibleNewsForBars(barsData?.bars ?? [], eventsData?.items ?? [], timeframe);
  }, [hoveredBarTime, hoveredNews, barsData?.bars, eventsData?.items, timeframe]);

  // Map each news id to the K-line bucket it is anchored to, so the news list can
  // show the SAME time as the candle/bubble it sits on (not the raw publish time,
  // which for pre/post-market news falls between candles).
  const newsBarTimeById = useMemo(() => {
    const m = new Map<string, number>();
    const byBar = indexNewsByBar(barsData?.bars ?? [], eventsData?.items ?? [], timeframe);
    for (const [barTime, items] of byBar) {
      for (const it of items) m.set(it.id, barTime);
    }
    return m;
  }, [barsData?.bars, eventsData?.items, timeframe]);

  // Warm bars + news the moment the user hovers a symbol, so the click feels instant
  const prefetchSymbol = useCallback(
    (sym: string) => {
      const s = sym.toUpperCase();
      if (s === symbol) return;
      const win = newsWindowForTimeframe(timeframe);
      queryClient.prefetchQuery({
        queryKey: ['bars', s, timeframe],
        queryFn: () => fetchBars(s, timeframe, { limit: 300 }),
        staleTime: 60_000,
      });
      queryClient.prefetchQuery({
        queryKey: ['events', s, timeframe, win.start, win.limit],
        queryFn: () => fetchEvents(s, timeframe, { start: win.start, limit: win.limit }),
        staleTime: 60_000,
      });
    },
    [symbol, timeframe, queryClient],
  );

  const isWatchlisted = watchSymbols.includes(symbol);

  const toggleWatchlist = async () => {
    if (isWatchlisted) {
      await removeFromWatchlist(symbol);
    } else {
      await addToWatchlist(symbol);
    }
    queryClient.invalidateQueries({ queryKey: ['watchlist'] });
  };

  const handleMobileTrade = (side: 'buy' | 'sell') => {
    openTrade(side);
    setTradeSheetOpen(true);
    setMobilePanel(null);
  };

  const symbolOrders = (orders?.items ?? []).filter((o) => o.symbol === symbol);
  const filledTrades = symbolOrders.filter((o) => o.status === 'filled');
  const quote = quoteData?.quote;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col bg-surface">
      <div className="shrink-0 border-b border-border px-3 py-2 md:px-4">
        <div className="flex items-center gap-2 md:gap-3">
          <Link to="/" className="btn-ghost p-1.5" title="返回市场首页">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h1 className="text-lg font-semibold md:text-xl">{symbol}</h1>
              {quoteLoading ? (
                <span className="text-sm text-muted">加载报价…</span>
              ) : quoteError ? (
                <span className="text-sm text-down">报价加载失败</span>
              ) : (
                <>
                  <PriceFlash value={livePrice} className="text-lg font-semibold tabular md:text-xl" />
                  <span className={`text-sm tabular ${changeColorClass(changePct)}`}>
                    {formatPercent(changePct)}
                  </span>
                </>
              )}
            </div>
            {quote && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted tabular">
                <span>昨收 {quote.previousClose.toFixed(2)}</span>
                <span className="text-up">高 {quote.dayHigh.toFixed(2)}</span>
                <span className="text-down">低 {quote.dayLow.toFixed(2)}</span>
                <span>量 {formatCompact(quote.volume)}</span>
                <span>{quote.provider}{quote.delayed ? ' · delayed' : ''}</span>
              </div>
            )}
          </div>
          <button type="button" onClick={toggleWatchlist} className="btn-ghost p-1.5" title="Watchlist">
            {isWatchlisted ? (
              <Star className="h-4 w-4 fill-primary text-primary" />
            ) : (
              <StarOff className="h-4 w-4" />
            )}
          </button>
          <div className="hidden gap-1 md:flex">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  timeframe === tf ? 'bg-primary/20 text-primary' : 'text-muted hover:text-gray-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          <div className="hidden gap-1 lg:flex">
            <button type="button" onClick={() => openTrade('buy')} className="btn-buy px-3 py-1.5 text-xs">
              Buy
            </button>
            <button type="button" onClick={() => openTrade('sell')} className="btn-sell px-3 py-1.5 text-xs">
              Sell
            </button>
            <button
              type="button"
              onClick={resetAll}
              title="还原左右栏宽度与中间各区高度"
              className="btn-ghost px-2 py-1.5 text-[11px] text-muted"
            >
              重置布局
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="hidden shrink-0 flex-col border-r border-border lg:flex"
          style={{ width: layout.leftWidth }}
        >
          <div className="border-b border-border p-2">
            <SearchBox onSelect={(s) => navigate(`/workbench/${s}`)} placeholder="Symbol…" />
          </div>
          <WatchlistSection
            symbols={watchSymbols}
            current={symbol}
            onSelect={(s) => navigate(`/workbench/${s}`)}
            onPrefetch={prefetchSymbol}
          />
          {recentSymbols.length > 0 && (
            <RecentsSection
              symbols={recentSymbols}
              current={symbol}
              onSelect={(s) => navigate(`/workbench/${s}`)}
              onPrefetch={prefetchSymbol}
            />
          )}
        </aside>

        <div className="hidden h-full shrink-0 self-stretch lg:flex">
          <ResizeHandle
            axis="x"
            title="拖拽调整左侧栏宽度 · 双击还原"
            onDrag={(d) => nudge('leftWidth', d)}
            onReset={() => reset('leftWidth')}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1 md:hidden">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`shrink-0 rounded px-2 py-1 text-xs ${
                  timeframe === tf ? 'bg-primary/20 text-primary' : 'text-muted'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-2 md:p-3">
              {barsLoading && (
                <div className="shrink-0 pb-1 text-xs text-muted">
                  正在加载 {symbol} · {timeframe} K线…
                </div>
              )}

              <div className="shrink-0 overflow-hidden" style={{ height: layout.chartHeight }}>
                <ErrorBoundary>
                  <ChartPanel
                    bars={barsData?.bars ?? []}
                    newsItems={eventsData?.items ?? []}
                    timeframe={timeframe}
                    selectedEventId={selectedEventId}
                    position={position}
                    height={Math.max(160, layout.chartHeight - 36)}
                    onBarHover={handleBarHover}
                    onVisibleRangeChange={setChartVisibleRange}
                    enabledMain={enabledMain}
                    newsLoading={newsFetching}
                    newsCached={eventsData?.cached}
                    newsSource={eventsData?.source}
                    newsError={newsError}
                  />
                </ErrorBoundary>
              </div>

              <ResizeHandle
                axis="y"
                title="拖拽调整 K 线高度 · 双击还原"
                onDrag={(d) => nudge('chartHeight', d)}
                onReset={() => reset('chartHeight')}
              />

              <div
                className="hidden shrink-0 overflow-hidden lg:block"
                style={{ height: layout.indicatorHeight }}
              >
                <ErrorBoundary>
                  <IndicatorPane
                    bars={barsData?.bars ?? []}
                    visibleRange={chartVisibleRange}
                    enabledMain={enabledMain}
                    enabledSub={enabledSub}
                    onToggleMain={toggleMainIndicator}
                    onToggleSub={toggleSubIndicator}
                    height={layout.indicatorHeight}
                    onRequestHeightDelta={requestIndicatorHeightDelta}
                  />
                </ErrorBoundary>
              </div>

              <div className="hidden lg:block">
                <ResizeHandle
                  axis="y"
                  title="拖拽调整 指标区 ↔ News 高度 · 双击还原"
                  onDrag={(d) => nudgeMany({ indicatorHeight: d, bottomHeight: -d })}
                  onReset={() => {
                    reset('indicatorHeight');
                    reset('bottomHeight');
                  }}
                />
              </div>

              <div
                className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-card"
                style={{ height: layout.bottomHeight }}
              >
                <div className="flex shrink-0 border-b border-border">
                  {(
                    [
                      { id: 'news', label: 'News' },
                      { id: 'positions', label: 'Positions' },
                      { id: 'orders', label: 'Orders' },
                      { id: 'trades', label: 'Trades' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setBottomTab(tab.id)}
                      className={`flex-1 px-2 py-1.5 text-xs font-medium ${
                        bottomTab === tab.id
                          ? 'border-b-2 border-primary text-primary'
                          : 'text-muted hover:text-gray-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {bottomTab === 'news' && (
                    <NewsTab
                      symbol={symbol}
                      items={newsTabItems}
                      barTime={hoveredBarTime}
                      timeframe={timeframe}
                      selectedId={selectedEventId}
                      onSelect={handleSelectNews}
                      cached={eventsData?.cached}
                      newsError={newsError}
                      barTimeById={newsBarTimeById}
                    />
                  )}
                  {bottomTab === 'positions' && <PositionsTab positions={portfolio?.positions ?? []} />}
                  {bottomTab === 'orders' && <OrdersTab orders={symbolOrders} />}
                  {bottomTab === 'trades' && (
                    <OrdersTab orders={filledTrades} emptyLabel="No filled trades" />
                  )}
                </div>
              </div>

              <ResizeHandle
                axis="y"
                title="拖拽调整底栏高度 · 双击还原"
                onDrag={(d) => nudge('bottomHeight', d)}
                onReset={() => reset('bottomHeight')}
              />
            </div>

            <div className="hidden h-full shrink-0 self-stretch lg:flex">
              <ResizeHandle
                axis="x"
                title="拖拽调整右侧栏宽度 · 双击还原"
                onDrag={(d) => nudge('rightWidth', -d)}
                onReset={() => reset('rightWidth')}
              />
            </div>

            <aside
              className="hidden shrink-0 flex-col border-l border-border lg:flex"
              style={{ width: layout.rightWidth }}
            >
              <div className="flex border-b border-border">
                <button
                  type="button"
                  onClick={() => setRightPanel('news')}
                  className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-medium ${
                    rightPanel === 'news' ? 'border-b-2 border-news text-news' : 'text-muted'
                  }`}
                >
                  <Newspaper className="h-3.5 w-3.5" /> News
                </button>
                <button
                  type="button"
                  onClick={() => setRightPanel('trade')}
                  className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-medium ${
                    rightPanel === 'trade' ? 'border-b-2 border-primary text-primary' : 'text-muted'
                  }`}
                >
                  <ShoppingCart className="h-3.5 w-3.5" /> Trade
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {rightPanel === 'news' ? (
                  <NewsPanel symbol={symbol} event={selectedEvent} timeframe={timeframe} />
                ) : (
                  <TradePanel symbol={symbol} side={tradeSide} newsId={selectedEventId} />
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-t border-border p-2 lg:hidden">
        <button
          type="button"
          onClick={() => setMobilePanel('news')}
          className="btn-ghost flex-1 border border-border py-3"
        >
          <Newspaper className="h-4 w-4" /> News
        </button>
        <button type="button" onClick={() => handleMobileTrade('buy')} className="btn-buy flex-1 py-3">
          Buy
        </button>
        <button type="button" onClick={() => handleMobileTrade('sell')} className="btn-sell flex-1 py-3">
          Sell
        </button>
      </div>

      {mobilePanel === 'news' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">{symbol} · News</h2>
            <button type="button" className="btn-ghost" onClick={() => setMobilePanel(null)}>
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <NewsPanel symbol={symbol} event={selectedEvent} timeframe={timeframe} />
          </div>
        </div>
      )}

      <TradeSheet
        open={tradeSheetOpen}
        symbol={symbol}
        side={tradeSide}
        newsId={selectedEventId}
        onClose={() => setTradeSheetOpen(false)}
      />
    </div>
  );
}

function WatchlistSection({
  symbols,
  current,
  onSelect,
  onPrefetch,
}: {
  symbols: string[];
  current: string;
  onSelect: (s: string) => void;
  onPrefetch?: (s: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted">Watchlist</div>
      {symbols.length === 0 ? (
        <p className="px-3 text-xs text-muted">Empty</p>
      ) : (
        symbols.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            onMouseEnter={() => onPrefetch?.(s)}
            onFocus={() => onPrefetch?.(s)}
            className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-hover ${
              s === current ? 'bg-surface-hover text-primary' : ''
            }`}
          >
            {s}
          </button>
        ))
      )}
    </div>
  );
}

function RecentsSection({
  symbols,
  current,
  onSelect,
  onPrefetch,
}: {
  symbols: string[];
  current: string;
  onSelect: (s: string) => void;
  onPrefetch?: (s: string) => void;
}) {
  return (
    <div className="border-t border-border">
      <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted">Recent</div>
      {symbols.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          onMouseEnter={() => onPrefetch?.(s)}
          onFocus={() => onPrefetch?.(s)}
          className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-hover ${
            s === current ? 'bg-surface-hover text-primary' : 'text-muted'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function NewsTab({
  symbol,
  items,
  barTime,
  timeframe,
  selectedId,
  onSelect,
  cached,
  newsError,
  barTimeById,
}: {
  symbol: string;
  items: NewsItem[];
  barTime: number | null;
  timeframe: Timeframe;
  selectedId: string | null;
  onSelect: (id: string) => void;
  cached?: boolean;
  newsError?: boolean;
  barTimeById?: Map<string, number>;
}) {
  const bucketLabel = (bt: number): string => {
    if (timeframe === '1Day') return `${formatMarketTime(bt, 'MMM d', false)} 日K`;
    return `${formatMarketTime(bt, 'MMM d, HH:mm', false)}–${formatMarketTime(
      bt + timeframeSeconds(timeframe),
      'HH:mm',
    )}`;
  };
  // Show the time of the candle the news is anchored to (matches the on-chart
  // bubble), with the raw publish time kept as a secondary hint.
  const alignedLabel = (item: NewsItem): string => {
    const bt = barTimeById?.get(item.id);
    if (bt == null) return formatMarketTime(item.publishedAt, 'MMM d HH:mm');
    return bucketLabel(bt);
  };
  if (newsError && items.length === 0) {
    return (
      <EmptyState
        title={`${symbol} · 新闻加载失败`}
        description="后端未响应或代理断开。确认 uvicorn 在 :8000 运行后刷新。"
        icon={<Newspaper className="h-8 w-8" />}
      />
    );
  }
  if (items.length === 0 && barTime != null) {
    return (
      <EmptyState
        title={`${symbol} · 该时段无新闻`}
        description={`${bucketLabel(barTime)} · 移开光标可查看窗口内全部新闻`}
        icon={<Newspaper className="h-8 w-8" />}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={`${symbol} · 暂无新闻`}
        description="新闻已落本地库；若仍为空，确认后端在跑，或稍后切换周期重试。"
        icon={<Newspaper className="h-8 w-8" />}
      />
    );
  }
  return (
    <div className="space-y-1">
      <div className="px-1 pb-1 text-[10px] text-muted">
        {barTime != null
          ? `${symbol} · ${bucketLabel(barTime)} · ${timeframe} · ${items.length} 条`
          : `${symbol} · 窗口内新闻 · ${items.length} 条${cached ? ' · 本地库' : ''} · 点击查看详情`}
      </div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover ${
            selectedId === item.id ? 'border border-news/40 bg-news/5' : 'border border-transparent'
          }`}
        >
          <div className="truncate font-medium text-gray-200">{item.headline}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted">
            <span className="text-gray-300">{alignedLabel(item)}</span>
            {(() => {
              const session = marketSessionOf(item.publishedAt);
              if (session === 'regular') return null;
              return (
                <span
                  className={`rounded border px-1 leading-4 ${marketSessionClass(session)}`}
                  title="该新闻发布于非交易时段，已就近挂到相邻的真实 K 线"
                >
                  {marketSessionLabel(session)}
                </span>
              );
            })()}
            <span>发布 {formatMarketTime(item.publishedAt, 'MMM d HH:mm')}</span>
            <span>· {item.source}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function PositionsTab({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return <EmptyState title="No positions" />;
  }
  return (
    <div className="space-y-1">
      {positions.map((p) => (
        <div key={p.symbol} className="flex justify-between rounded px-2 py-1 text-xs">
          <span className="font-medium">{p.symbol}</span>
          <span className="tabular text-muted">
            {p.quantity} · {formatCurrency(p.marketValue)}
          </span>
        </div>
      ))}
    </div>
  );
}

function OrdersTab({ orders, emptyLabel = 'No orders' }: { orders: Order[]; emptyLabel?: string }) {
  if (orders.length === 0) {
    return <EmptyState title={emptyLabel} />;
  }
  return (
    <div className="space-y-1">
      {orders.map((o) => (
        <div key={o.id} className="flex justify-between rounded px-2 py-1 text-xs">
          <span className={o.side === 'buy' ? 'text-up' : 'text-down'}>
            {o.side.toUpperCase()} {o.symbol}
          </span>
          <span className="tabular text-muted">
            {o.quantity} · {o.status}
          </span>
        </div>
      ))}
    </div>
  );
}
