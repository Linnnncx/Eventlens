import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Eraser,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  Newspaper,
  Star,
  SlidersHorizontal,
  TrendingUp,
  Undo2,
  X,
} from 'lucide-react';
import {
  addToWatchlist,
  fetchBars,
  fetchEvents,
  fetchPortfolio,
  fetchQuote,
  fetchSymbolProfile,
  fetchTrades,
  fetchWatchlist,
  removeFromWatchlist,
} from '../../api/endpoints';
import type { Bar, NewsItem, Timeframe } from '../../types/api';
import type { LogicalRange } from 'lightweight-charts';
import {
  MAIN_INDICATORS,
  SUB_INDICATORS,
  formatMaLabel,
  loadMainIndicators,
  loadMaPeriods,
  loadSubIndicators,
  normalizeMaPeriods,
  saveMainIndicators,
  saveMaPeriods,
  saveSubIndicators,
  type MainIndicatorId,
  type SubIndicatorId,
} from '../../features/chart/indicatorConfig';
import {
  changeColorClass,
  formatCompact,
  formatMarketTime,
  formatPercent,
  formatPrice,
} from '../../utils/format';
import { newsWindowForTimeframe } from '../../utils/eventAlign';
import { isIndexSymbol } from '../../features/market/indices';
import { useIsLandscape } from '../../hooks/useIsMobile';
import {
  MobileChart,
  newsByBarMap,
  type HoveredBar,
  type MobileDrawTool,
} from '../components/MobileChart';
import { MobileIndicatorPane } from '../components/MobileIndicatorPane';
import { MobileOrderBook } from '../components/MobileOrderBook';
import { MobileDanmaku } from '../components/MobileDanmaku';
import { MobileOrderSheet } from '../components/MobileOrderSheet';
import { NewsCard, NewsDetailSheet, rankNews } from '../components/MobileNews';
import { Chip, EmptyState, ScrollRow, Segmented, Sheet, Skeleton } from '../components/ui';

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: '1Min', label: '1分' },
  { id: '5Min', label: '5分' },
  { id: '15Min', label: '15分' },
  { id: '1Hour', label: '1时' },
  { id: '4Hour', label: '4时' },
  { id: '1Day', label: '日' },
  { id: '1Month', label: '月' },
];

type StockTab = 'news' | 'book' | 'position' | 'chat';

const TABS: { id: StockTab; label: string }[] = [
  { id: 'news', label: '新闻' },
  { id: 'book', label: '盘口' },
  { id: 'position', label: '持仓' },
  { id: 'chat', label: '讨论' },
];

const EMPTY_BARS: Bar[] = [];
const EMPTY_NEWS: NewsItem[] = [];
const NEWS_ANCHORS_KEY = 'eventlens.mobile.news-anchors';

function loadShowNewsAnchors(): boolean {
  try {
    const v = localStorage.getItem(NEWS_ANCHORS_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch {
    /* ignore */
  }
  return true;
}

function useChartHeight(landscape: boolean) {
  const [height, setHeight] = useState(() =>
    Math.round((typeof window === 'undefined' ? 700 : window.innerHeight) * 0.4),
  );
  useEffect(() => {
    const update = () =>
      setHeight(Math.round(window.innerHeight * (landscape ? 0.72 : 0.4)));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [landscape]);
  return height;
}

export function MobileStockPage() {
  const { symbol = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const landscape = useIsLandscape();

  const [timeframe, setTimeframe] = useState<Timeframe>('1Day');
  const [tab, setTab] = useState<StockTab>('news');
  const [hovered, setHovered] = useState<HoveredBar | null>(null);
  const [chartVisibleRange, setChartVisibleRange] = useState<LogicalRange | null>(null);
  const [chartCrosshairTime, setChartCrosshairTime] = useState<number | null>(null);
  const [openNews, setOpenNews] = useState<NewsItem | null>(null);
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [orderOpen, setOrderOpen] = useState(false);
  const [indicatorSheet, setIndicatorSheet] = useState(false);
  const [chartFull, setChartFull] = useState(false);
  const [drawTool, setDrawTool] = useState<MobileDrawTool>('cursor');
  const [clearToken, setClearToken] = useState(0);
  const [undoToken, setUndoToken] = useState(0);
  const [selectedBarTime, setSelectedBarTime] = useState<number | null>(null);
  const [showNewsAnchors, setShowNewsAnchors] = useState(loadShowNewsAnchors);
  const newsSectionRef = useRef<HTMLDivElement | null>(null);
  const pageScrollRef = useRef<HTMLDivElement | null>(null);

  const [maPeriods, setMaPeriods] = useState<number[]>(loadMaPeriods);
  const [maDraft, setMaDraft] = useState(() => loadMaPeriods().join(','));
  const [enabledMain, setEnabledMain] = useState<MainIndicatorId[]>(loadMainIndicators);
  const [enabledSub, setEnabledSub] = useState<SubIndicatorId[]>(loadSubIndicators);
  const [activeSub, setActiveSub] = useState<SubIndicatorId>(() => loadSubIndicators()[0] ?? 'macd');

  useEffect(() => {
    setTimeframe('1Day');
    setHovered(null);
    setTab('news');
    setDrawTool('cursor');
    setClearToken((n) => n + 1);
    setSelectedBarTime(null);
  }, [symbol]);

  useEffect(() => {
    setSelectedBarTime(null);
  }, [timeframe]);

  const { data: profile } = useQuery({
    queryKey: ['symbol-profile', symbol],
    queryFn: ({ signal }) => fetchSymbolProfile(symbol, signal),
    enabled: Boolean(symbol),
    staleTime: 600_000,
  });

  const { data: quoteData } = useQuery({
    queryKey: ['quote', symbol],
    queryFn: ({ signal }) => fetchQuote(symbol, signal),
    enabled: Boolean(symbol),
    refetchInterval: 30_000,
  });

  const { data: barsData, isLoading: barsLoading } = useQuery({
    queryKey: ['bars', symbol, timeframe],
    queryFn: ({ signal }) => fetchBars(symbol, timeframe, { limit: 300, signal }),
    enabled: Boolean(symbol),
    staleTime: 30_000,
  });

  const indexMode = isIndexSymbol(symbol);
  const newsWindow = useMemo(() => newsWindowForTimeframe(timeframe), [timeframe]);
  // Same events feed as desktop — windowed by timeframe so older candles still get news.
  const { data: eventsData } = useQuery({
    queryKey: ['events', symbol, timeframe, newsWindow.start, newsWindow.limit],
    queryFn: ({ signal }) =>
      fetchEvents(symbol, timeframe, { start: newsWindow.start, limit: newsWindow.limit, signal }),
    // Let quote + chart render first; the large news/anchor payload is secondary.
    enabled: Boolean(symbol) && !indexMode && Boolean(barsData),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 2,
  });

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    refetchInterval: 60_000,
  });

  const { data: tradesData } = useQuery({
    queryKey: ['trades'],
    queryFn: fetchTrades,
    enabled: tab === 'position',
    staleTime: 30_000,
  });

  const { data: watchlist } = useQuery({ queryKey: ['watchlist'], queryFn: fetchWatchlist });
  const inWatchlist = watchlist?.items.includes(symbol) ?? false;

  const toggleWatch = useMutation({
    mutationFn: () => (inWatchlist ? removeFromWatchlist(symbol) : addToWatchlist(symbol)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlist'] }),
  });

  const bars = barsData?.bars ?? EMPTY_BARS;
  const quote = quoteData?.quote;
  const position = portfolio?.positions.find((p) => p.symbol === symbol);
  // Use the timeframe-aligned events payload (not a short recent /news list).
  const allNews = useMemo(
    () => (eventsData?.items?.length ? eventsData.items : EMPTY_NEWS),
    [eventsData],
  );
  const chartNews = useDeferredValue(allNews);
  const newsByBar = useMemo(
    () => newsByBarMap(bars, chartNews, timeframe),
    [bars, chartNews, timeframe],
  );
  const chartHeight = useChartHeight(landscape || chartFull);

  const selectedNews = useMemo(() => {
    if (selectedBarTime == null) return null;
    return newsByBar.get(selectedBarTime) ?? [];
  }, [selectedBarTime, newsByBar]);

  const listNews = useMemo(() => {
    if (selectedNews != null) return selectedNews;
    return rankNews(chartNews).slice(0, 60);
  }, [selectedNews, chartNews]);

  const selectedBar = useMemo(() => {
    if (selectedBarTime == null) return null;
    return bars.find((b) => Math.floor(new Date(b.timestamp).getTime() / 1000) === selectedBarTime) ?? null;
  }, [selectedBarTime, bars]);

  const symbolTrades = useMemo(
    () => (tradesData?.items ?? []).filter((t) => t.symbol === symbol).slice(0, 20),
    [tradesData, symbol],
  );

  const handleBarSelect = useCallback((time: number | null) => {
    if (time == null) {
      setSelectedBarTime(null);
      return;
    }
    setSelectedBarTime((prev) => (prev === time ? null : time));
    setTab('news');
    requestAnimationFrame(() => {
      const page = pageScrollRef.current;
      const target = newsSectionRef.current;
      if (!page || !target) return;
      const pageTop = page.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      page.scrollTo({
        top: page.scrollTop + (targetTop - pageTop) - 8,
        behavior: 'smooth',
      });
    });
  }, []);

  const toggleNewsAnchors = useCallback(() => {
    setShowNewsAnchors((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NEWS_ANCHORS_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const commitMaDraft = () => {
    const periods = normalizeMaPeriods(maDraft.split(/[,，\s]+/).filter(Boolean));
    setMaPeriods(periods);
    saveMaPeriods(periods);
    setMaDraft(periods.join(','));
  };

  const toggleMain = (id: MainIndicatorId) => {
    const next = enabledMain.includes(id)
      ? enabledMain.filter((x) => x !== id)
      : [...enabledMain, id];
    setEnabledMain(next);
    saveMainIndicators(next);
  };

  const toggleSub = (id: SubIndicatorId) => {
    const next = enabledSub.includes(id)
      ? enabledSub.filter((x) => x !== id)
      : [...enabledSub, id];
    setEnabledSub(next);
    saveSubIndicators(next);
    if (!next.includes(activeSub) && next[0]) setActiveSub(next[0]);
  };

  const price = quote?.price ?? bars[bars.length - 1]?.close ?? 0;
  const change = quote?.change ?? 0;
  const changePercent = quote?.changePercent ?? 0;
  const displayBar = hovered?.bar ?? bars[bars.length - 1];
  const immersive = landscape || chartFull;

  const chartBlock = (
    <div className="relative bg-[#0f131a]">
      {!immersive && (
        <ScrollRow className="px-2 py-2">
          {TIMEFRAMES.map((tf) => (
            <Chip key={tf.id} active={timeframe === tf.id} onClick={() => setTimeframe(tf.id)}>
              {tf.label}
            </Chip>
          ))}
        </ScrollRow>
      )}

      {displayBar && (
        <div className="tabular flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-1 text-[10px] text-muted">
          <span>{formatMarketTime(displayBar.timestamp, 'MM-dd HH:mm', false)}</span>
          {hovered?.crosshairPrice != null && (
            <span className="font-semibold text-amber-400">
              价 {formatPrice(hovered.crosshairPrice)}
            </span>
          )}
          <span>开 {formatPrice(displayBar.open)}</span>
          <span>高 {formatPrice(displayBar.high)}</span>
          <span>低 {formatPrice(displayBar.low)}</span>
          <span className={changeColorClass(displayBar.close - displayBar.open)}>
            收 {formatPrice(displayBar.close)}
          </span>
          <span>量 {formatCompact(displayBar.volume)}</span>
          {enabledMain.includes('ma') && <span>{formatMaLabel(maPeriods)}</span>}
        </div>
      )}

      {barsLoading && bars.length === 0 ? (
        <Skeleton className="mx-3 mb-3" />
      ) : (
        <MobileChart
          bars={bars}
          symbol={symbol}
          timeframe={timeframe}
          height={chartHeight}
          maPeriods={maPeriods}
          enabledMain={enabledMain}
          news={chartNews}
          avgCost={position?.avgCost ?? null}
          selectedBarTime={selectedBarTime}
          showNewsAnchors={showNewsAnchors}
          drawTool={immersive ? drawTool : 'cursor'}
          clearToken={clearToken}
          undoToken={undoToken}
          onHover={setHovered}
          onVisibleRangeChange={setChartVisibleRange}
          onCrosshairTimeChange={setChartCrosshairTime}
          onBarSelect={handleBarSelect}
        />
      )}

      {immersive && (
        <div className="flex items-center justify-center gap-1 px-2 py-1.5">
          {(
            [
              { id: 'cursor' as const, label: '选择', icon: MousePointer2 },
              { id: 'hline' as const, label: '水平', icon: Minus },
              { id: 'trend' as const, label: '趋势', icon: TrendingUp },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setDrawTool(id)}
              className={`m-tap flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium ${
                drawTool === id
                  ? 'bg-primary/20 text-primary'
                  : 'bg-surface-raised text-muted'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setUndoToken((n) => n + 1)}
            className="m-tap flex items-center gap-1 rounded-lg bg-surface-raised px-2.5 py-1.5 text-[12px] font-medium text-muted"
            title="撤销上一笔"
          >
            <Undo2 className="h-3.5 w-3.5" />
            撤销
          </button>
          <button
            type="button"
            onClick={() => {
              setClearToken((n) => n + 1);
              setDrawTool('cursor');
            }}
            className="m-tap flex items-center gap-1 rounded-lg bg-surface-raised px-2.5 py-1.5 text-[12px] font-medium text-muted"
          >
            <Eraser className="h-3.5 w-3.5" />
            清除
          </button>
        </div>
      )}

      {!immersive && (
        <p className="px-3 pb-1 text-[10px] text-muted">
          按住拖动查看价格 · 在某一价位停住约 2 秒即可标记
        </p>
      )}
      {immersive && (
        <p className="px-3 pb-1 text-center text-[10px] text-muted">
          拖到目标价位停住约 2 秒即可标记 · 点撤销可去掉上一笔
        </p>
      )}

      <div className="absolute right-2 top-2 z-10 flex gap-1.5">
        <button
          type="button"
          onClick={() => setUndoToken((n) => n + 1)}
          className="m-tap flex h-8 w-8 items-center justify-center rounded-lg bg-surface-raised/80 text-muted backdrop-blur"
          aria-label="撤销画线"
          title="撤销上一笔"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={toggleNewsAnchors}
          className={`m-tap flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur ${
            showNewsAnchors
              ? 'bg-news/20 text-news'
              : 'bg-surface-raised/80 text-muted'
          }`}
          aria-label={showNewsAnchors ? '关闭新闻锚点' : '打开新闻锚点'}
          title={showNewsAnchors ? '关闭新闻锚点' : '打开新闻锚点'}
        >
          <Newspaper className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setChartFull((v) => !v)}
          className="m-tap flex h-8 w-8 items-center justify-center rounded-lg bg-surface-raised/80 text-muted backdrop-blur"
          aria-label="全屏图表"
        >
          {immersive ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      {enabledSub.length > 0 && (
        <MobileIndicatorPane
          bars={bars}
          active={activeSub}
          enabled={enabledSub}
          onChange={setActiveSub}
          onOpenSettings={() => setIndicatorSheet(true)}
          visibleRange={chartVisibleRange}
          crosshairTime={chartCrosshairTime}
        />
      )}
    </div>
  );

  if (immersive) {
    return (
      <div className="flex h-[100dvh] flex-col bg-[#0f131a]">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => (chartFull ? setChartFull(false) : navigate(-1))}
            className="m-tap flex h-8 w-8 items-center justify-center rounded-lg text-muted"
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="font-mono text-[15px] font-semibold text-gray-100">{symbol}</span>
          <span className={`tabular text-[15px] font-semibold ${changeColorClass(change)}`}>
            {formatPrice(price)}
          </span>
          <span className={`tabular text-[12px] ${changeColorClass(change)}`}>
            {formatPercent(changePercent)}
          </span>
          <div className="ml-auto">
            <ScrollRow>
              {TIMEFRAMES.map((tf) => (
                <Chip key={tf.id} active={timeframe === tf.id} onClick={() => setTimeframe(tf.id)}>
                  {tf.label}
                </Chip>
              ))}
            </ScrollRow>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{chartBlock}</div>
      </div>
    );
  }

  return (
    <div
      ref={pageScrollRef}
      className="flex h-full flex-col overflow-y-auto overscroll-y-contain pb-24"
    >
      <header className="safe-top sticky top-0 z-30 flex items-center gap-2 border-b border-border/70 bg-surface-raised/95 px-2 py-2 backdrop-blur-md">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="m-tap flex h-9 w-9 items-center justify-center rounded-lg text-muted"
          aria-label="返回"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[15px] font-semibold leading-tight text-gray-50">
            {symbol}
          </div>
          <div className="truncate text-[11px] leading-tight text-muted">
            {profile?.name ?? '—'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => toggleWatch.mutate()}
          className="m-tap flex h-9 w-9 items-center justify-center rounded-lg"
          aria-label="自选"
        >
          <Star
            className={`h-5 w-5 ${inWatchlist ? 'fill-amber-400 text-amber-400' : 'text-muted'}`}
          />
        </button>
        <button
          type="button"
          onClick={() => setIndicatorSheet(true)}
          className="m-tap flex h-9 w-9 items-center justify-center rounded-lg text-muted"
          aria-label="指标设置"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>
      </header>

      <section className="px-4 pb-3 pt-3">
        <div className="flex items-end gap-2">
          <span className={`tabular text-[32px] font-bold leading-none ${changeColorClass(change)}`}>
            {formatPrice(price)}
          </span>
          <span className={`tabular pb-0.5 text-[14px] font-medium ${changeColorClass(change)}`}>
            {change >= 0 ? '+' : ''}
            {formatPrice(change)} {formatPercent(changePercent)}
          </span>
        </div>
        <div className="tabular mt-2 grid grid-cols-4 gap-y-1 text-[11px] text-muted">
          <span>昨收 {quote ? formatPrice(quote.previousClose) : '—'}</span>
          <span>最高 {quote ? formatPrice(quote.dayHigh) : '—'}</span>
          <span>最低 {quote ? formatPrice(quote.dayLow) : '—'}</span>
          <span>量 {quote ? formatCompact(quote.volume ?? 0) : '—'}</span>
        </div>
      </section>

      {chartBlock}

      <div ref={newsSectionRef} className="scroll-mt-2 px-3 pt-3">
        <Segmented items={TABS} value={tab} onChange={setTab} />
      </div>

      <div className="flex-1 px-3 pb-4 pt-3">
        {tab === 'news' && (
          <div className="space-y-2">
            {selectedBarTime != null && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/8 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="tabular text-[12px] text-amber-100/90">
                    {selectedBar
                      ? formatMarketTime(selectedBar.timestamp, 'MM-dd HH:mm', false)
                      : formatMarketTime(selectedBarTime * 1000, 'MM-dd HH:mm', false)}
                    {' · '}
                    {listNews.length} 条新闻
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedBarTime(null)}
                  className="m-tap flex h-8 items-center gap-1 rounded-lg bg-surface-raised px-2 text-[11px] text-muted"
                >
                  <X className="h-3.5 w-3.5" />
                  清除
                </button>
              </div>
            )}

            {listNews.length === 0 ? (
              <EmptyState
                text={
                  selectedBarTime != null
                    ? '该时段没有新闻，可点其他 K 线或清除选中'
                    : '暂无相关新闻'
                }
              />
            ) : (
              listNews.map((item) => (
                <NewsCard key={item.id} item={item} onOpen={setOpenNews} />
              ))
            )}

            {selectedBarTime == null && allNews.length > listNews.length && (
              <div className="py-1 text-center text-[11px] text-muted">
                点 K 线或锚点可筛选该时段新闻
              </div>
            )}
          </div>
        )}

        {tab === 'book' && (
          <div className="rounded-xl border border-border/70 bg-surface-card">
            <MobileOrderBook symbol={symbol} />
          </div>
        )}

        {tab === 'position' && (
          <div className="space-y-3">
            {position ? (
              <div className="rounded-xl border border-border/70 bg-surface-card px-3 py-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-[13px] text-muted">持仓市值</span>
                  <span className="tabular text-[18px] font-semibold text-gray-50">
                    ${formatPrice(position.marketValue)}
                  </span>
                </div>
                <dl className="tabular grid grid-cols-2 gap-y-1.5 text-[12px]">
                  <Field label="持股" value={`${position.quantity}`} />
                  <Field label="成本价" value={`$${formatPrice(position.avgCost)}`} />
                  <Field
                    label="浮动盈亏"
                    value={`${position.pnl >= 0 ? '+' : ''}${formatPrice(position.pnl)}`}
                    tone={position.pnl}
                  />
                  <Field
                    label="浮盈比例"
                    value={formatPercent(position.pnlPercent)}
                    tone={position.pnlPercent}
                  />
                  {position.todayPnl != null && (
                    <Field
                      label="今日盈亏"
                      value={`${position.todayPnl >= 0 ? '+' : ''}${formatPrice(position.todayPnl)}`}
                      tone={position.todayPnl}
                    />
                  )}
                  <Field label="仓位占比" value={`${position.weight.toFixed(1)}%`} />
                </dl>
              </div>
            ) : (
              <EmptyState text="当前无持仓" />
            )}

            {symbolTrades.length > 0 && (
              <div>
                <div className="mb-1.5 px-1 text-[12px] font-medium text-gray-300">近期成交</div>
                <div className="space-y-1.5">
                  {symbolTrades.map((trade) => (
                    <div
                      key={trade.id}
                      className="flex items-center justify-between rounded-lg border border-border/60 bg-surface-card px-3 py-2 text-[12px]"
                    >
                      <span
                        className={`badge ${trade.side === 'buy' ? 'badge-up' : 'badge-down'}`}
                      >
                        {trade.side === 'buy' ? '买' : '卖'}
                      </span>
                      <span className="tabular text-gray-200">
                        {trade.quantity} @ ${formatPrice(trade.price)}
                      </span>
                      <span className="tabular text-muted">费 ${formatPrice(trade.fee)}</span>
                      <span className="text-muted">
                        {trade.filledAt ? formatMarketTime(trade.filledAt, 'MM-dd HH:mm', false) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'chat' && (
          <div className="rounded-xl border border-border/70 bg-surface-card">
            <MobileDanmaku symbol={symbol} />
          </div>
        )}
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-border/70 bg-surface-raised/95 px-3 pt-2 backdrop-blur-md">
        <button
          type="button"
          onClick={() => {
            setOrderSide('buy');
            setOrderOpen(true);
          }}
          className="m-tap flex-1 rounded-xl bg-up-dim py-3 text-[16px] font-semibold text-white"
        >
          买入
        </button>
        <button
          type="button"
          onClick={() => {
            setOrderSide('sell');
            setOrderOpen(true);
          }}
          className="m-tap flex-1 rounded-xl bg-down-dim py-3 text-[16px] font-semibold text-white"
        >
          卖出
        </button>
      </div>

      <NewsDetailSheet
        item={openNews}
        symbol={symbol}
        timeframe={timeframe}
        onClose={() => setOpenNews(null)}
      />

      <MobileOrderSheet
        open={orderOpen}
        symbol={symbol}
        price={price}
        side={orderSide}
        cash={portfolio?.cash ?? 0}
        position={position}
        onClose={() => setOrderOpen(false)}
      />

      <Sheet open={indicatorSheet} onClose={() => setIndicatorSheet(false)} title="指标设置">
        <div className="pb-4">
          <div className="mb-2 text-[13px] font-medium text-gray-200">主图指标</div>
          <div className="flex flex-wrap gap-2">
            {MAIN_INDICATORS.map((ind) => (
              <Chip
                key={ind.id}
                active={enabledMain.includes(ind.id)}
                onClick={() => toggleMain(ind.id)}
              >
                {ind.id === 'ma' ? formatMaLabel(maPeriods) : ind.label}
              </Chip>
            ))}
          </div>

          {enabledMain.includes('ma') && (
            <div className="mt-3">
              <div className="mb-1.5 text-[12px] text-muted">MA 周期（逗号分隔，最多 5 个）</div>
              <input
                value={maDraft}
                onChange={(e) => setMaDraft(e.target.value)}
                onBlur={commitMaDraft}
                inputMode="numeric"
                className="input text-[14px]"
                placeholder="5,10,20"
              />
            </div>
          )}

          <div className="mb-2 mt-5 text-[13px] font-medium text-gray-200">
            副图指标（左右滑动切换）
          </div>
          <div className="flex flex-wrap gap-2">
            {SUB_INDICATORS.map((ind) => (
              <Chip
                key={ind.id}
                active={enabledSub.includes(ind.id)}
                onClick={() => toggleSub(ind.id)}
              >
                {ind.label}
              </Chip>
            ))}
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-medium ${tone == null ? 'text-gray-100' : changeColorClass(tone)}`}>
        {value}
      </dd>
    </div>
  );
}
