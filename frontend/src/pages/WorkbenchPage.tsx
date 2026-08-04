import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LogicalRange } from 'lightweight-charts';
import {
  ArrowLeft,
  Newspaper,
  ShoppingCart,
  Star,
  StarOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  addToWatchlist,
  fetchBars,
  fetchEvents,
  fetchOrders,
  fetchPortfolio,
  fetchQuote,
  fetchTrades,
  fetchWatchlist,
  removeFromWatchlist,
} from '../api/endpoints';
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
  loadMaPeriods,
  loadSubIndicators,
  saveMainIndicators,
  saveMaPeriods,
  saveSubIndicators,
  type MainIndicatorId,
  type SubIndicatorId,
} from '../features/chart/indicatorConfig';
import { IndexStrip } from '../features/market/IndexStrip';
import { isIndexSymbol } from '../features/market/indices';
import { StockScreener } from '../features/market/StockScreener';
import { NewsPanel } from '../features/news/NewsPanel';
import { RangeAiAnalysis } from '../features/news/RangeAiAnalysis';
import { OrderBook } from '../features/trading/OrderBook';
import { QuickOrderBox } from '../features/trading/QuickOrderBox';
import {
  OrdersTable,
  PositionsTable,
  TradesTable,
} from '../features/trading/TradingTables';
import { TradeSheet } from '../features/trading/TradeSheet';
import { useMarketSocket } from '../hooks/useMarketSocket';
import { useAccountStore } from '../stores/accountStore';
import { useWorkbenchStore } from '../stores/workbenchStore';
import type { Bar, NewsItem, Timeframe } from '../types/api';
import {
  changeColorClass,
  formatCompact,
  formatPercent,
  formatMarketTime,
  marketSessionOf,
  marketSessionLabel,
  marketSessionClass,
} from '../utils/format';
import { newsWindowForTimeframe, timeframeSeconds } from '../utils/eventAlign';
import {
  computeEventReactionLocal,
  formatReactionPct,
  formatReactionRatio,
} from '../utils/eventReaction';
import { assignRelatedNewsImages } from '../utils/relatedNewsImage';

const TIMEFRAMES: Timeframe[] = ['1Min', '5Min', '15Min', '1Hour', '4Hour', '1Day', '1Month'];
const EMPTY_BARS: Bar[] = [];
const EMPTY_NEWS: NewsItem[] = [];

function barsRefreshInterval(timeframe: Timeframe): number {
  if (timeframe === '1Min') return 30_000;
  if (timeframe === '5Min' || timeframe === '15Min') return 60_000;
  if (timeframe === '1Hour' || timeframe === '4Hour') return 5 * 60_000;
  return 15 * 60_000;
}

type BottomTab = 'news' | 'positions' | 'orders' | 'trades';

export function WorkbenchPage() {
  const { symbol: routeSymbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const symbol = (routeSymbol ?? 'AAPL').toUpperCase();
  const indexMode = isIndexSymbol(symbol);
  const timeframe = useWorkbenchStore((s) => s.timeframe);
  const setTimeframe = useWorkbenchStore((s) => s.setTimeframe);
  const setSymbol = useWorkbenchStore((s) => s.setSymbol);
  const selectedEventId = useWorkbenchStore((s) => s.selectedEventId);
  const selectEvent = useWorkbenchStore((s) => s.selectEvent);
  const rightPanel = useWorkbenchStore((s) => s.rightPanel);
  const setRightPanel = useWorkbenchStore((s) => s.setRightPanel);
  const openTrade = useWorkbenchStore((s) => s.openTrade);
  const quickOrderOpen = useWorkbenchStore((s) => s.quickOrderOpen);
  const setQuickOrderOpen = useWorkbenchStore((s) => s.setQuickOrderOpen);
  const recentSymbols = useWorkbenchStore((s) => s.recentSymbols);
  const setPortfolio = useAccountStore((s) => s.setPortfolio);
  const getPosition = useAccountStore((s) => s.getPosition);

  const [bottomTab, setBottomTab] = useState<BottomTab>('news');
  const [tradeSheetOpen, setTradeSheetOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'news' | 'trade' | null>(null);
  const [hoveredBarTime, setHoveredBarTime] = useState<number | null>(null);
  const [hoveredNews, setHoveredNews] = useState<NewsItem[]>([]);
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
  const [chartVisibleRange, setChartVisibleRange] = useState<LogicalRange | null>(null);
  const [chartCrosshairTime, setChartCrosshairTime] = useState<number | null>(null);
  const [enabledMain, setEnabledMain] = useState<MainIndicatorId[]>(loadMainIndicators);
  const [enabledSub, setEnabledSub] = useState<SubIndicatorId[]>(loadSubIndicators);
  const [maPeriods, setMaPeriods] = useState<number[]>(loadMaPeriods);
  const { layout, nudge, reset, resetAll } = useWorkbenchLayout();

  const handleMaPeriodsChange = useCallback((periods: number[]) => {
    setMaPeriods(periods);
    saveMaPeriods(periods);
  }, []);

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
    setChartCrosshairTime(null);
    selectEvent(null);
    setDetailEventId(null);
  }, [symbol, timeframe, selectEvent]);

  const { data: quoteData, isLoading: quoteLoading, isError: quoteError } = useQuery({
    queryKey: ['quote', symbol],
    queryFn: ({ signal }) => fetchQuote(symbol, signal),
    refetchInterval: 30_000,
  });

  const { data: barsData, isLoading: barsLoading } = useQuery({
    queryKey: ['bars', symbol, timeframe],
    queryFn: ({ signal }) => fetchBars(symbol, timeframe, { limit: 300, signal }),
    refetchInterval: barsRefreshInterval(timeframe),
    // Keep prior bars only when switching timeframe on the same symbol.
    // Crossing symbols with keepPreviousData leaves the old Y-scale (e.g. $700)
    // and the next $100 stock can render off-screen.
    placeholderData: (previousData, previousQuery) => {
      const prevSymbol = previousQuery?.queryKey?.[1];
      if (prevSymbol === symbol) return previousData;
      return undefined;
    },
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
    queryFn: ({ signal }) => fetchEvents(symbol, timeframe, { start: newsWindow.start, limit: newsWindow.limit, signal }),
    refetchInterval: 60_000,
    staleTime: 60_000,
    enabled: !indexMode,
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
    refetchInterval: 60_000,
  });

  const { data: orders } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    refetchInterval: bottomTab === 'orders' ? 45_000 : false,
    enabled: bottomTab === 'orders' || bottomTab === 'trades',
  });

  const { data: trades } = useQuery({
    queryKey: ['trades'],
    queryFn: fetchTrades,
    refetchInterval: bottomTab === 'trades' ? 45_000 : false,
    enabled: bottomTab === 'trades' || bottomTab === 'orders',
  });

  useEffect(() => {
    if (portfolio) setPortfolio(portfolio);
  }, [portfolio, setPortfolio]);

  const watchSymbols = watchlist?.items ?? [];
  const heldSymbols = useMemo(
    () => new Set((portfolio?.positions ?? []).map((item) => item.symbol)),
    [portfolio],
  );
  const socketSymbols = useMemo(() => {
    // Cap subscriptions — each quote used to re-render the whole workbench.
    const all = [...new Set([symbol, ...watchSymbols, ...recentSymbols])];
    return all.slice(0, 12);
  }, [symbol, watchSymbols, recentSymbols]);

  const handleVisibleRangeChange = useCallback((range: LogicalRange | null) => {
    setChartVisibleRange((prev) => {
      if (prev?.from === range?.from && prev?.to === range?.to) return prev;
      return range;
    });
  }, []);

  const handleCrosshairTimeChange = useCallback((time: number | null) => {
    setChartCrosshairTime((prev) => (prev === time ? prev : time));
  }, []);
  const { quotes } = useMarketSocket(socketSymbols);

  const livePrice = quotes[symbol]?.price ?? quoteData?.quote.price ?? 0;
  const changePct = quoteData?.quote.changePercent ?? 0;
  const position = getPosition(symbol);

  const handleBarHover = useCallback(
    (payload: BarHoverPayload) => {
      // Avoid forcing the News tab / full-page churn on every crosshair move.
      setHoveredBarTime((prev) => (prev === payload.barTime ? prev : payload.barTime));
      setHoveredNews((prev) => {
        if (
          prev.length === payload.items.length &&
          prev.every((item, i) => item.id === payload.items[i]?.id)
        ) {
          return prev;
        }
        return payload.items;
      });
      if (payload.items.length === 0) {
        selectEvent(null);
        return;
      }
      const stillThere = payload.items.some((i) => i.id === selectedEventId);
      if (!stillThere) {
        selectEvent(payload.items[0]!.id);
      }
    },
    [selectEvent, selectedEventId],
  );

  const handleSelectNews = useCallback(
    (id: string) => {
      selectEvent(id);
      setDetailEventId(id);
      setRightPanel('news');
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

  const selectedReaction = useMemo(
    () =>
      selectedEvent
        ? computeEventReactionLocal(
            selectedEvent.id,
            symbol,
            selectedEvent.publishedAt,
            barsData?.bars ?? EMPTY_BARS,
          )
        : null,
    [selectedEvent, symbol, barsData?.bars],
  );

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
      queryClient.prefetchQuery({
        queryKey: ['bars', s, timeframe],
        queryFn: ({ signal }) => fetchBars(s, timeframe, { limit: 300, signal }),
        staleTime: 60_000,
      });
    },
    [symbol, timeframe, queryClient],
  );

  const switchSymbol = useCallback(
    (nextSymbol: string) => {
      const next = nextSymbol.toUpperCase();
      setSymbol(next);
      navigate(`/workbench/${next}`);
    },
    [navigate, setSymbol],
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

  const allOrders = orders?.items ?? [];
  const allTrades = trades?.items ?? [];
  const allPositions = portfolio?.positions ?? [];
  const quote = quoteData?.quote;

  const pageScrollRef = useRef<HTMLDivElement>(null);
  const leftAsideRef = useRef<HTMLElement>(null);
  const rightAsideRef = useRef<HTMLElement>(null);

  // Wheel on left/right: drive the page first; once the page can't move further
  // in that direction, scroll the sidebar under the cursor instead.
  useEffect(() => {
    const EPS = 1;
    const overflowMode = new WeakMap<HTMLElement, boolean>();

    const canScrollY = (el: HTMLElement, deltaY: number): boolean => {
      if (el.scrollHeight <= el.clientHeight + EPS) return false;
      if (deltaY > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - EPS;
      if (deltaY < 0) return el.scrollTop > EPS;
      return false;
    };

    const findSidebarScrollables = (root: HTMLElement, from: EventTarget | null): HTMLElement[] => {
      const found: HTMLElement[] = [];
      let node: HTMLElement | null =
        from instanceof HTMLElement ? from : root;
      while (node && root.contains(node)) {
        let allowsOverflow = overflowMode.get(node);
        if (allowsOverflow == null) {
          const { overflowY } = getComputedStyle(node);
          allowsOverflow = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
          overflowMode.set(node, allowsOverflow);
        }
        if (
          allowsOverflow &&
          node.scrollHeight > node.clientHeight + EPS
        ) {
          found.push(node);
        }
        if (node === root) break;
        node = node.parentElement;
      }
      return found;
    };

    const onSidebarWheel = (e: WheelEvent) => {
      const page = pageScrollRef.current;
      const aside = e.currentTarget as HTMLElement;
      if (!page) return;

      const deltaY = e.deltaY;
      if (deltaY === 0) return;

      // Page (center column) still has room → scroll the whole workbench.
      if (canScrollY(page, deltaY)) {
        e.preventDefault();
        page.scrollTop += deltaY;
        return;
      }

      // Page is at top/bottom → scroll the sidebar under the mouse.
      const target = findSidebarScrollables(aside, e.target).find((el) => canScrollY(el, deltaY));
      if (target) {
        e.preventDefault();
        target.scrollTop += deltaY;
      }
    };

    const left = leftAsideRef.current;
    const right = rightAsideRef.current;
    left?.addEventListener('wheel', onSidebarWheel, { passive: false });
    right?.addEventListener('wheel', onSidebarWheel, { passive: false });
    return () => {
      left?.removeEventListener('wheel', onSidebarWheel);
      right?.removeEventListener('wheel', onSidebarWheel);
    };
  }, []);

  return (
    <div className="flex h-[calc(100vh-3.25rem)] flex-col bg-surface">
      <div className="shrink-0 border-b border-border/80 bg-surface-raised/30 px-3 py-2.5 md:px-4">
        <div className="flex items-center gap-2 md:gap-3">
          <Link to="/" className="btn-ghost p-1.5" title="返回市场首页">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{symbol}</h1>
              {quoteLoading ? (
                <span className="text-sm text-muted">加载报价…</span>
              ) : quoteError ? (
                <span className="text-sm text-down">报价加载失败</span>
              ) : (
                <>
                  <PriceFlash value={livePrice} className="text-xl font-semibold tabular md:text-2xl" />
                  <span className={`text-base tabular ${changeColorClass(changePct)}`}>
                    {formatPercent(changePct)}
                  </span>
                </>
              )}
            </div>
            {quote && (
              <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-muted tabular md:text-sm">
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
                className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
                  timeframe === tf ? 'bg-primary/20 text-primary' : 'text-muted hover:text-gray-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          <div className="hidden gap-1.5 lg:flex">
            <button type="button" onClick={() => openTrade('buy')} className="btn-buy px-3.5 py-1.5 text-sm">
              Buy
            </button>
            <button type="button" onClick={() => openTrade('sell')} className="btn-sell px-3.5 py-1.5 text-sm">
              Sell
            </button>
            <button
              type="button"
              onClick={resetAll}
              title="还原左右栏宽度与中间各区高度"
              className="btn-ghost px-2.5 py-1.5 text-xs text-muted"
            >
              重置布局
            </button>
          </div>
        </div>
      </div>

      <IndexStrip current={symbol} onSelect={switchSymbol} />

      {/* Single page scroller: center content can grow tall; sidebars stay sticky. */}
      <div ref={pageScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        <div className="flex min-h-full items-start">
          <aside
            ref={leftAsideRef}
            className="sticky top-0 hidden min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-surface lg:flex"
            style={{
              width: layout.leftWidth,
              height: 'calc(100vh - 7.5rem)',
            }}
          >
            <StockScreener
              current={symbol}
              watchSymbols={watchSymbols}
              heldSymbols={heldSymbols}
              onSelect={switchSymbol}
              onPrefetch={prefetchSymbol}
            />
          </aside>

          <div className="sticky top-0 hidden h-[calc(100vh-7.5rem)] shrink-0 self-start lg:flex">
            <ResizeHandle
              axis="x"
              title="拖拽调整左侧栏宽度 · 双击还原"
              onDrag={(d) => nudge('leftWidth', d)}
              onReset={() => reset('leftWidth')}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
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

            <div className="flex flex-col p-2 md:p-3">
              {barsLoading && (
                <div className="shrink-0 pb-1 text-xs text-muted">
                  正在加载 {symbol} · {timeframe} K线…
                </div>
              )}

              <div className="shrink-0 overflow-hidden" style={{ height: layout.chartHeight }}>
                <ErrorBoundary>
                  <ChartPanel
                    bars={barsData?.bars ?? EMPTY_BARS}
                    newsItems={indexMode ? EMPTY_NEWS : (eventsData?.items ?? EMPTY_NEWS)}
                    timeframe={timeframe}
                    selectedEventId={selectedEventId}
                    position={position}
                    height={Math.max(160, layout.chartHeight - 36)}
                    onBarHover={handleBarHover}
                    onVisibleRangeChange={handleVisibleRangeChange}
                    onCrosshairTimeChange={handleCrosshairTimeChange}
                    enabledMain={enabledMain}
                    maPeriods={maPeriods}
                    newsLoading={!indexMode && newsFetching}
                    newsCached={eventsData?.cached}
                    newsSource={eventsData?.source}
                    newsError={!indexMode && newsError}
                    showNewsAnchors={indexMode ? false : undefined}
                    allowNewsAnchorsToggle={!indexMode}
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
                    bars={barsData?.bars ?? EMPTY_BARS}
                    visibleRange={chartVisibleRange}
                    crosshairTime={chartCrosshairTime}
                    enabledMain={enabledMain}
                    enabledSub={enabledSub}
                    maPeriods={maPeriods}
                    onMaPeriodsChange={handleMaPeriodsChange}
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
                  title="拖拽调整指标区高度 · 双击还原（超出视口可向下滚动查看 News）"
                  onDrag={(d) => nudge('indicatorHeight', d)}
                  onReset={() => reset('indicatorHeight')}
                />
              </div>

              <div
                className="flex min-h-[220px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-card"
                style={{ height: Math.max(220, layout.bottomHeight) }}
              >
                <div className="flex shrink-0 border-b border-border">
                  {(
                    [
                      { id: 'news', label: 'News' },
                      { id: 'positions', label: '持仓' },
                      { id: 'orders', label: '委托' },
                      { id: 'trades', label: '成交' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setBottomTab(tab.id)}
                      className={`flex-1 px-2 py-2 text-sm font-medium ${
                        bottomTab === tab.id
                          ? 'border-b-2 border-primary text-primary'
                          : 'text-muted hover:text-gray-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-1.5">
                  {bottomTab === 'news' && (
                    <NewsTab
                      symbol={symbol}
                      items={indexMode ? EMPTY_NEWS : newsTabItems}
                      bars={barsData?.bars ?? EMPTY_BARS}
                      barTime={hoveredBarTime}
                      timeframe={timeframe}
                      selectedId={selectedEventId}
                      onSelect={handleSelectNews}
                      cached={eventsData?.cached}
                      loading={!indexMode && newsFetching}
                      newsError={!indexMode && newsError}
                      barTimeById={newsBarTimeById}
                      indexMode={indexMode}
                    />
                  )}
                  {bottomTab === 'positions' && (
                    <PositionsTable positions={allPositions} activeSymbol={symbol} />
                  )}
                  {bottomTab === 'orders' && (
                    <OrdersTable orders={allOrders} activeSymbol={symbol} />
                  )}
                  {bottomTab === 'trades' && (
                    <TradesTable trades={allTrades} activeSymbol={symbol} />
                  )}
                </div>
              </div>

            </div>
          </div>

          <div className="sticky top-0 hidden h-[calc(100vh-7.5rem)] shrink-0 self-start lg:flex">
            <ResizeHandle
              axis="x"
              title="拖拽调整右侧栏宽度 · 双击还原"
              onDrag={(d) => nudge('rightWidth', -d)}
              onReset={() => reset('rightWidth')}
            />
          </div>

          <aside
            ref={rightAsideRef}
            className="sticky top-0 hidden min-h-0 shrink-0 flex-col overflow-hidden border-l border-border bg-surface lg:flex"
            style={{
              width: layout.rightWidth,
              height: 'calc(100vh - 7.5rem)',
            }}
          >
            <div className="flex shrink-0 border-b border-border">
              <button
                type="button"
                onClick={() => setRightPanel('news')}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                  rightPanel === 'news' ? 'border-b-2 border-news text-news' : 'text-muted hover:text-gray-200'
                }`}
              >
                <Newspaper className="h-4 w-4" /> News
              </button>
              <button
                type="button"
                onClick={() => openTrade()}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                  rightPanel === 'trade' ? 'border-b-2 border-primary text-primary' : 'text-muted hover:text-gray-200'
                }`}
              >
                <ShoppingCart className="h-4 w-4" /> Trade
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {rightPanel === 'news' ? (
                <NewsPanel
                  symbol={symbol}
                  event={selectedEvent}
                  timeframe={timeframe}
                  localReaction={selectedReaction}
                  autoLoadDetails={detailEventId === selectedEvent?.id}
                />
              ) : (
                <OrderBook symbol={symbol} />
              )}
            </div>
          </aside>
        </div>
      </div>

      {quickOrderOpen && !indexMode && (
        <QuickOrderBox
          symbol={symbol}
          price={livePrice}
          newsId={selectedEventId}
          onClose={() => setQuickOrderOpen(false)}
        />
      )}

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
            <NewsPanel
              symbol={symbol}
              event={selectedEvent}
              timeframe={timeframe}
              localReaction={selectedReaction}
              autoLoadDetails={detailEventId === selectedEvent?.id}
            />
          </div>
        </div>
      )}

      <TradeSheet
        open={tradeSheetOpen}
        symbol={symbol}
        price={livePrice}
        newsId={selectedEventId}
        onClose={() => setTradeSheetOpen(false)}
      />
    </div>
  );
}

function NewsTab({
  symbol,
  items,
  bars,
  barTime,
  timeframe,
  selectedId,
  onSelect,
  cached: _cached,
  loading,
  newsError,
  barTimeById,
  indexMode,
}: {
  symbol: string;
  items: NewsItem[];
  bars: Bar[];
  barTime: number | null;
  timeframe: Timeframe;
  selectedId: string | null;
  onSelect: (id: string) => void;
  cached?: boolean;
  loading?: boolean;
  newsError?: boolean;
  barTimeById?: Map<string, number>;
  indexMode?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(24);

  useEffect(() => {
    setVisibleCount(barTime != null ? 60 : 24);
  }, [symbol, timeframe, barTime]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);

  const bucketLabel = (bt: number): string => {
    if (timeframe === '1Day') return `${formatMarketTime(bt, 'MMM d', false)} 日K`;
    return `${formatMarketTime(bt, 'MMM d, HH:mm', false)}–${formatMarketTime(
      bt + timeframeSeconds(timeframe),
      'HH:mm',
    )}`;
  };
  const alignedLabel = (item: NewsItem): string => {
    const bt = barTimeById?.get(item.id);
    if (bt == null) return formatMarketTime(item.publishedAt, 'MMM d HH:mm');
    return bucketLabel(bt);
  };

  if (indexMode) {
    return (
      <EmptyState
        title={`${symbol} · 指数模式`}
        description="道琼斯 / 标普 / 纳斯达克只展示 K 线与指标，不挂载公司新闻锚点。"
        icon={<Newspaper className="h-8 w-8" />}
      />
    );
  }
  if (newsError && items.length === 0) {
    return (
      <div className="space-y-3">
        <RangeAiAnalysis symbol={symbol} defaultTimeframe={timeframe} />
        <EmptyState
          title={`${symbol} · 新闻加载失败`}
          description="后端未响应或代理断开。确认 uvicorn 在 :8000 运行后刷新。"
          icon={<Newspaper className="h-8 w-8" />}
        />
      </div>
    );
  }
  if (items.length === 0 && loading) {
    return (
      <div className="space-y-3">
        <RangeAiAnalysis symbol={symbol} defaultTimeframe={timeframe} />
        <EmptyState
          title={`${symbol} · 正在抓取新闻…`}
          description="该股票首次访问，需要从上游拉取整段窗口（约 10-20 秒），之后会走本地库秒开。"
          icon={<Newspaper className="h-8 w-8 animate-pulse" />}
        />
      </div>
    );
  }
  if (items.length === 0 && barTime != null) {
    return (
      <div className="space-y-3">
        <RangeAiAnalysis symbol={symbol} defaultTimeframe={timeframe} />
        <EmptyState
          title={`${symbol} · 该时段无新闻`}
          description={`${bucketLabel(barTime)} · 移开光标可查看窗口内全部新闻`}
          icon={<Newspaper className="h-8 w-8" />}
        />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <RangeAiAnalysis symbol={symbol} defaultTimeframe={timeframe} />
        <EmptyState
          title={`${symbol} · 暂无新闻`}
          description="新闻已落本地库；若仍为空，确认后端在跑，或稍后切换周期重试。"
          icon={<Newspaper className="h-8 w-8" />}
        />
      </div>
    );
  }

  const dirLabel = (d: string) => {
    if (d === 'positive') return '利好';
    if (d === 'negative') return '利空';
    if (d === 'neutral') return '中性';
    return '未定';
  };
  const impLabel = (i: string) => {
    if (i === 'high') return '高影响';
    if (i === 'medium') return '中影响';
    return '低影响';
  };

  const imageById = assignRelatedNewsImages(visibleItems, symbol);

  return (
    <div className="space-y-3">
      <RangeAiAnalysis symbol={symbol} defaultTimeframe={timeframe} />
      <div className="px-0.5 text-[11px] text-muted">
        {barTime != null
          ? `${symbol} · ${bucketLabel(barTime)} · ${timeframe} · ${items.length} 条`
          : `${symbol} · ${items.length} 条 · 点击查看详情`}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleItems.map((item) => {
          const selected = selectedId === item.id;
          const session = marketSessionOf(item.publishedAt);
          const dir = item.direction;
          const dirClass =
            dir === 'positive'
              ? 'border-up/35 bg-up/15 text-up'
              : dir === 'negative'
                ? 'border-down/35 bg-down/15 text-down'
                : 'border-border bg-surface-hover text-muted';
          const impClass =
            item.importance === 'high'
              ? 'border-down/35 bg-down/10 text-down'
              : item.importance === 'medium'
                ? 'border-news/35 bg-news/10 text-news'
                : 'border-border bg-surface-hover text-muted';
          const reaction = computeEventReactionLocal(item.id, symbol, item.publishedAt, bars);
          const imageUrl = imageById.get(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`flex flex-col overflow-hidden rounded-xl border text-left transition-colors hover:bg-surface-hover ${
                selected ? 'border-news/55 bg-news/10' : 'border-border/80 bg-surface-card/50'
              }`}
            >
              <div className="relative h-28 w-full shrink-0 bg-surface-hover">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Newspaper className="h-8 w-8 text-muted/40" />
                  </div>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
                <div className="line-clamp-3 text-[14px] font-semibold leading-snug text-gray-100">
                  {item.headline}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${dirClass}`}
                    title="标题与摘要的多信号评分方向"
                  >
                    {dirLabel(dir)}
                  </span>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${impClass}`}
                    title="按事件类型、催化强度与内容属性综合评分"
                  >
                    {impLabel(item.importance)}
                  </span>
                  <span className="rounded-md border border-border/80 bg-surface px-2 py-0.5 text-[11px] text-muted">
                    {item.eventType.replace(/_/g, ' ')}
                  </span>
                  {session !== 'regular' && (
                    <span className={`rounded-md border px-2 py-0.5 text-[11px] ${marketSessionClass(session)}`}>
                      {marketSessionLabel(session)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <ReactionChip label="Post 5m" value={formatReactionPct(reaction?.post5m)} raw={reaction?.post5m} />
                  <ReactionChip label="Post 30m" value={formatReactionPct(reaction?.post30m)} raw={reaction?.post30m} />
                  <ReactionChip label="Post 60m" value={formatReactionPct(reaction?.post60m)} raw={reaction?.post60m} />
                  <ReactionChip label="Max up" value={formatReactionPct(reaction?.maxUp)} raw={reaction?.maxUp} />
                  <ReactionChip
                    label="Max DD"
                    value={formatReactionPct(reaction?.maxDrawdown)}
                    raw={reaction?.maxDrawdown}
                  />
                  <ReactionChip
                    label="Vol"
                    value={formatReactionRatio(reaction?.volumeRatio)}
                    raw={null}
                    muted
                  />
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-x-1.5 pt-0.5 text-[11px] text-muted">
                  <span className="text-gray-300">{alignedLabel(item)}</span>
                  <span>·</span>
                  <span className="truncate">{item.source}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {visibleCount < items.length && (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => Math.min(count + 24, items.length))}
          className="btn-ghost w-full border border-border py-2.5 text-sm"
        >
          加载更多新闻（已显示 {visibleItems.length} / {items.length}）
        </button>
      )}
    </div>
  );
}

function ReactionChip({
  label,
  value,
  raw,
  muted,
}: {
  label: string;
  value: string;
  raw: number | null | undefined;
  muted?: boolean;
}) {
  const color = muted
    ? 'text-gray-200'
    : raw == null
      ? 'text-muted'
      : raw >= 0
        ? 'text-up'
        : 'text-down';
  return (
    <div className="rounded-md border border-border/70 bg-surface/80 px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`tabular text-[12px] font-semibold leading-tight ${color}`}>{value}</div>
    </div>
  );
}
