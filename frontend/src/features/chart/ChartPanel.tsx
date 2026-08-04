import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  type MouseEventParams,
  type LogicalRange,
} from 'lightweight-charts';
import {
  ArrowUpRight,
  CircleDot,
  Eraser,
  Minus,
  MousePointer2,
  Percent,
  Square,
  TrendingUp,
  Undo2,
  UnfoldVertical,
} from 'lucide-react';
import type { Bar, NewsItem, Position, Timeframe } from '../../types/api';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { aggregateDirection, directionColor, indexNewsByBar, toSec } from './newsAnchors';
import {
  bollinger,
  donchian,
  ema,
  parabolicSar,
  sma,
  supportResistance,
  vwap,
} from '../../utils/indicators';
import { marketChartTimeFormatter, marketTickMarkFormatter } from '../../utils/format';
import { DEFAULT_MA_PERIODS, MA_PERIOD_COLORS, type MainIndicatorId } from './indicatorConfig';

type DrawTool = 'cursor' | 'price' | 'hline' | 'trend' | 'ray' | 'vline' | 'rect' | 'fib';

type SvgDrawing =
  | { id: string; kind: 'vline'; time: Time }
  | { id: string; kind: 'rect'; t1: Time; p1: number; t2: Time; p2: number };

/** One completed drawing step — popped by Undo. */
type UndoEntry =
  | { type: 'priceLine'; line: IPriceLine }
  | { type: 'mark'; line: IPriceLine }
  | { type: 'trend'; series: ISeriesApi<'Line'> }
  | { type: 'svg'; id: string }
  | { type: 'fib'; lines: IPriceLine[] };

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

const DRAW_TOOLS: {
  id: DrawTool;
  label: string;
  tip: string;
  icon: typeof MousePointer2;
}[] = [
  { id: 'cursor', label: '选择', tip: '选择 / 浏览', icon: MousePointer2 },
  { id: 'price', label: '标价', tip: '标记价格（填入下单框）', icon: CircleDot },
  { id: 'hline', label: '水平', tip: '水平线', icon: Minus },
  { id: 'trend', label: '趋势', tip: '趋势线（两点）', icon: TrendingUp },
  { id: 'ray', label: '射线', tip: '射线（两点，向右延伸）', icon: ArrowUpRight },
  { id: 'vline', label: '垂直', tip: '垂直线', icon: UnfoldVertical },
  { id: 'rect', label: '矩形', tip: '矩形（两点）', icon: Square },
  { id: 'fib', label: '斐波那契', tip: '斐波那契回撤（两点）', icon: Percent },
];

function asSec(t: Time): number {
  return typeof t === 'number' ? t : new Date(String(t)).getTime() / 1000;
}

function nextDrawId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface BarHoverPayload {
  barTime: number | null;
  items: NewsItem[];
}

interface ChartPanelProps {
  bars: Bar[];
  newsItems?: NewsItem[];
  timeframe: Timeframe;
  selectedEventId?: string | null;
  position?: Position;
  onBarHover?: (payload: BarHoverPayload) => void;
  /** Fired when the user pans/zooms so sibling panes can stay in sync. */
  onVisibleRangeChange?: (range: LogicalRange | null) => void;
  /** Unix seconds under the crosshair (null when cleared) — syncs indicator panes. */
  onCrosshairTimeChange?: (time: number | null) => void;
  enabledMain?: MainIndicatorId[];
  /** Custom MA periods when main MA indicator is on (default 5/10/20). */
  maPeriods?: number[];
  newsLoading?: boolean;
  newsCached?: boolean;
  newsSource?: string;
  newsError?: boolean;
  height?: number;
  /** Hide news stems/bubbles (indices never show them). */
  showNewsAnchors?: boolean;
  /** When false, the in-chart toggle is hidden (forced-off mode). */
  allowNewsAnchorsToggle?: boolean;
}

interface NewsAnchor {
  barTime: number;
  barHigh: number;
  items: NewsItem[];
  direction: string;
  count: number;
}

interface AnchorLayout extends NewsAnchor {
  left: number;
  top: number;
  anchorY: number;
  visible: boolean;
}

/** Vertical gap from candle high → bubble centre. Kept short enough to stay
 * readable without crowding the candlestick body. */
const STEM_PX = 56;
/** Fallback bubble row used when the price scale cannot resolve a coordinate yet. */
const RIBBON_Y = 22;
const ANCHORS_LS_KEY = 'eventlens.chart.showNewsAnchors';

function loadShowAnchors(): boolean {
  try {
    const v = localStorage.getItem(ANCHORS_LS_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch {
    /* ignore */
  }
  return true;
}

const LINE_BASE = {
  lastValueVisible: false,
  priceLineVisible: false,
  crosshairMarkerVisible: false,
} as const;

export function ChartPanel({
  bars,
  newsItems = [],
  timeframe,
  selectedEventId,
  position,
  onBarHover,
  onVisibleRangeChange,
  onCrosshairTimeChange,
  enabledMain = ['ma'],
  maPeriods = [...DEFAULT_MA_PERIODS],
  newsLoading = false,
  newsCached: _newsCached,
  newsSource: _newsSource,
  newsError = false,
  height = 420,
  showNewsAnchors,
  allowNewsAnchorsToggle = true,
}: ChartPanelProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const costPriceLineRef = useRef<IPriceLine | null>(null);
  const overlayRefs = useRef<Record<string, ISeriesApi<'Line'>>>({});
  const fittedKeyRef = useRef<string>('');
  const newsByBarRef = useRef<Map<number, NewsItem[]>>(new Map());
  const onBarHoverRef = useRef(onBarHover);
  const onRangeRef = useRef(onVisibleRangeChange);
  const onCrosshairTimeRef = useRef(onCrosshairTimeChange);
  const lastHoverSecRef = useRef<number | null>(null);
  const repositionRef = useRef<() => boolean>(() => false);
  const rafRef = useRef<number | null>(null);
  const anchorsRef = useRef<NewsAnchor[]>([]);
  const barsRef = useRef<Bar[]>(bars);
  const drawToolRef = useRef<DrawTool>('cursor');
  const markLineRef = useRef<IPriceLine | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const trendSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const trendDraftRef = useRef<{ time: Time; price: number } | null>(null);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const setMarkedPriceRef = useRef<(p: number | null) => void>(() => {});
  const setTrendDraftUiRef = useRef<(p: { time: Time; price: number } | null) => void>(() => {});
  const setSvgDrawingsRef = useRef<(fn: (prev: SvgDrawing[]) => SvgDrawing[]) => void>(() => {});

  const setMarkedPrice = useWorkbenchStore((s) => s.setMarkedPrice);

  const [anchorLayout, setAnchorLayout] = useState<AnchorLayout[]>([]);
  const [crosshairBar, setCrosshairBar] = useState<Bar | null>(null);
  const [anchorsEnabled, setAnchorsEnabled] = useState(loadShowAnchors);
  const [drawTool, setDrawTool] = useState<DrawTool>('cursor');
  const [trendDraftUi, setTrendDraftUi] = useState<{ time: Time; price: number } | null>(null);
  const [draftPx, setDraftPx] = useState<{ left: number; top: number } | null>(null);
  const [svgDrawings, setSvgDrawings] = useState<SvgDrawing[]>([]);

  useEffect(() => {
    drawToolRef.current = drawTool;
  }, [drawTool]);

  useEffect(() => {
    setMarkedPriceRef.current = setMarkedPrice;
  }, [setMarkedPrice]);

  useEffect(() => {
    setTrendDraftUiRef.current = setTrendDraftUi;
  }, []);

  useEffect(() => {
    setSvgDrawingsRef.current = setSvgDrawings;
  }, []);

  // Keep draft circle glued to price/time while panning/zooming
  useEffect(() => {
    if (!trendDraftUi) {
      setDraftPx(null);
      return;
    }
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series) return;
    const x = chart.timeScale().timeToCoordinate(trendDraftUi.time);
    const y = series.priceToCoordinate(trendDraftUi.price);
    if (x == null || y == null) {
      setDraftPx(null);
      return;
    }
    setDraftPx({ left: x, top: y });
  }, [trendDraftUi, anchorLayout]);

  const svgLayout = useMemo(() => {
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series) return [] as Array<
      | { id: string; kind: 'vline'; x: number }
      | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number }
    >;
    const out: Array<
      | { id: string; kind: 'vline'; x: number }
      | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number }
    > = [];
    for (const d of svgDrawings) {
      if (d.kind === 'vline') {
        const x = chart.timeScale().timeToCoordinate(d.time);
        if (x != null) out.push({ id: d.id, kind: 'vline', x });
      } else {
        const x1 = chart.timeScale().timeToCoordinate(d.t1);
        const x2 = chart.timeScale().timeToCoordinate(d.t2);
        const y1 = series.priceToCoordinate(d.p1);
        const y2 = series.priceToCoordinate(d.p2);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        out.push({
          id: d.id,
          kind: 'rect',
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.abs(x2 - x1),
          h: Math.abs(y2 - y1),
        });
      }
    }
    return out;
    // Recompute when range changes (anchorLayout ticks on pan/zoom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgDrawings, anchorLayout]);

  // Parent can force-hide (indices). Otherwise the in-chart toggle decides.
  const displayAnchors = showNewsAnchors === false ? false : anchorsEnabled;
  const showToggle = allowNewsAnchorsToggle && showNewsAnchors !== false;

  const toggleAnchors = useCallback(() => {
    setAnchorsEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ANCHORS_LS_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const clearDraft = useCallback(() => {
    trendDraftRef.current = null;
    setTrendDraftUi(null);
    setDraftPx(null);
  }, []);

  const clearDrawings = useCallback(() => {
    const series = candleRef.current;
    if (series) {
      for (const pl of priceLinesRef.current) {
        try {
          series.removePriceLine(pl);
        } catch {
          /* ignore */
        }
      }
      if (markLineRef.current) {
        try {
          series.removePriceLine(markLineRef.current);
        } catch {
          /* ignore */
        }
      }
    }
    priceLinesRef.current = [];
    markLineRef.current = null;
    const chart = chartRef.current;
    for (const line of trendSeriesRef.current) {
      try {
        chart?.removeSeries(line);
      } catch {
        /* ignore */
      }
    }
    trendSeriesRef.current = [];
    undoStackRef.current = [];
    clearDraft();
    setSvgDrawings([]);
    setMarkedPrice(null);
    setDrawTool('cursor');
    drawToolRef.current = 'cursor';
  }, [setMarkedPrice, clearDraft]);

  const undoLastDrawing = useCallback(() => {
    // Incomplete two-point draft counts as the latest step.
    if (trendDraftRef.current) {
      clearDraft();
      return;
    }
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    const series = candleRef.current;
    const chart = chartRef.current;
    if (entry.type === 'priceLine' || entry.type === 'mark') {
      try {
        series?.removePriceLine(entry.line);
      } catch {
        /* ignore */
      }
      if (entry.type === 'priceLine') {
        priceLinesRef.current = priceLinesRef.current.filter((pl) => pl !== entry.line);
      } else {
        if (markLineRef.current === entry.line) markLineRef.current = null;
        setMarkedPrice(null);
      }
      return;
    }
    if (entry.type === 'fib') {
      for (const pl of entry.lines) {
        try {
          series?.removePriceLine(pl);
        } catch {
          /* ignore */
        }
        priceLinesRef.current = priceLinesRef.current.filter((x) => x !== pl);
      }
      return;
    }
    if (entry.type === 'trend') {
      try {
        chart?.removeSeries(entry.series);
      } catch {
        /* ignore */
      }
      trendSeriesRef.current = trendSeriesRef.current.filter((s) => s !== entry.series);
      return;
    }
    if (entry.type === 'svg') {
      setSvgDrawings((prev) => prev.filter((d) => d.id !== entry.id));
    }
  }, [clearDraft, setMarkedPrice]);

  const selectDrawTool = useCallback(
    (id: DrawTool) => {
      setDrawTool(id);
      drawToolRef.current = id;
      clearDraft();
    },
    [clearDraft],
  );

  const symbol = useWorkbenchStore((s) => s.symbol);
  useEffect(() => {
    clearDrawings();
    fittedKeyRef.current = '';
    candleRef.current?.priceScale().applyOptions({ autoScale: true });
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
  }, [symbol, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  const closes = useMemo(() => bars.map((b) => b.close), [bars]);
  const maSeriesData = useMemo(
    () => maPeriods.map((period) => ({ period, values: sma(closes, period) })),
    [closes, maPeriods],
  );
  const highs = useMemo(() => bars.map((b) => b.high), [bars]);
  const lows = useMemo(() => bars.map((b) => b.low), [bars]);
  const volumes = useMemo(() => bars.map((b) => b.volume), [bars]);
  const overlayData = useMemo(
    () => {
      const has = (id: MainIndicatorId) => enabledMain.includes(id);
      return {
        ema12: has('ema') ? ema(closes, 12) : [],
        ema26: has('ema') ? ema(closes, 26) : [],
        boll: has('boll') ? bollinger(closes, 20, 2) : [],
        vwap: has('vwap') ? vwap(highs, lows, closes, volumes) : [],
        sar: has('sar') ? parabolicSar(highs, lows) : [],
        support: has('support') ? supportResistance(highs, lows, 20) : [],
        donchian: has('donchian') ? donchian(highs, lows, 20) : [],
      };
    },
    [closes, highs, lows, volumes, enabledMain],
  );

  const newsByBar = useMemo(
    () => indexNewsByBar(bars, newsItems, timeframe),
    [bars, newsItems, timeframe],
  );

  const anchors = useMemo((): NewsAnchor[] => {
    const barBySec = new Map(bars.map((b) => [toSec(b.timestamp), b]));
    const out: NewsAnchor[] = [];
    for (const [barTime, items] of newsByBar) {
      const bar = barBySec.get(barTime);
      if (!bar || items.length === 0) continue;
      out.push({
        barTime,
        barHigh: bar.high,
        items,
        direction: aggregateDirection(items),
        count: items.length,
      });
    }
    return out.sort((a, b) => a.barTime - b.barTime);
  }, [bars, newsByBar]);

  useEffect(() => {
    newsByBarRef.current = newsByBar;
  }, [newsByBar]);

  useEffect(() => {
    barsRef.current = bars;
  }, [bars]);

  useEffect(() => {
    anchorsRef.current = anchors;
  }, [anchors]);

  useEffect(() => {
    onBarHoverRef.current = onBarHover;
  }, [onBarHover]);

  useEffect(() => {
    onRangeRef.current = onVisibleRangeChange;
  }, [onVisibleRangeChange]);

  useEffect(() => {
    onCrosshairTimeRef.current = onCrosshairTimeChange;
  }, [onCrosshairTimeChange]);

  // Clicking a bubble pins the news list to that bar. The pin is released only once
  // the pointer leaves the chart and comes back, so the user can read/scroll the list
  // without it changing under them.
  const lockedRef = useRef<number | null>(null);
  const pointerLeftRef = useRef(false);
  const [lockedBarTime, setLockedBarTime] = useState<number | null>(null);

  const emitHover = useCallback((sec: number | null, force = false) => {
    if (lockedRef.current != null && !force) return;
    if (sec === lastHoverSecRef.current && !force) return;
    lastHoverSecRef.current = sec;
    if (sec == null) {
      onBarHoverRef.current?.({ barTime: null, items: [] });
      return;
    }
    onBarHoverRef.current?.({
      barTime: sec,
      items: newsByBarRef.current.get(sec) ?? [],
    });
  }, []);

  const lockToBar = useCallback(
    (sec: number) => {
      lockedRef.current = sec;
      pointerLeftRef.current = false;
      setLockedBarTime(sec);
      emitHover(sec, true);
    },
    [emitHover],
  );

  const releaseLock = useCallback(() => {
    if (lockedRef.current == null) return;
    lockedRef.current = null;
    setLockedBarTime(null);
  }, []);

  // A new symbol/timeframe invalidates the pinned bar
  useEffect(() => {
    lockedRef.current = null;
    pointerLeftRef.current = false;
    setLockedBarTime(null);
  }, [timeframe, bars[0]?.symbol]);

  // Returns true once positions are resolved (or there is nothing to place), so the
  // scheduler can keep retrying on later frames while the chart is still laying out.
  const repositionAnchors = useCallback((): boolean => {
    const chart = chartRef.current;
    const series = candleRef.current;
    const wrap = wrapRef.current;
    if (!chart || !series || !wrap) return false;
    const heightPx = wrap.clientHeight || height;
    const timeScale = chart.timeScale();
    const plotWidth = timeScale.width() || wrap.clientWidth;
    if (plotWidth === 0) return false;
    const anchorsNow = anchorsRef.current;
    if (anchorsNow.length === 0) {
      setAnchorLayout([]);
      return true;
    }
    const barIndex = new Map(barsRef.current.map((b, i) => [toSec(b.timestamp), i]));
    const range = timeScale.getVisibleLogicalRange();
    const span = range ? range.to - range.from : 0;

    let anyResolved = false;
    const next = anchorsNow.map((a) => {
      // timeToCoordinate/priceToCoordinate return null whenever the pane has not
      // finished laying out, which previously hid every anchor. Plain logical-range
      // math always yields a usable x, so the marker layer can never come up empty.
      let x = timeScale.timeToCoordinate(a.barTime as Time) as number | null;
      if (x == null) {
        const idx = barIndex.get(a.barTime);
        if (idx != null && range && span > 0) {
          x = ((idx + 0.5 - range.from) / span) * plotWidth;
        }
      }
      if (x == null) {
        return { ...a, left: 0, top: 0, anchorY: 0, visible: false };
      }

      const priceY = series.priceToCoordinate(a.barHigh) as number | null;
      const y = priceY ?? RIBBON_Y;
      const top = Math.min(Math.max(8, y - STEM_PX), heightPx - 12);
      const anchorY =
        priceY == null
          ? Math.max(top + 24, heightPx * 0.55)
          : Math.min(Math.max(y, top + 8), heightPx - 4);

      anyResolved = true;
      return {
        ...a,
        left: x,
        top,
        anchorY,
        visible: x >= -8 && x <= plotWidth + 8,
      };
    });
    setAnchorLayout(next);
    return anyResolved;
  }, [height]);

  useEffect(() => {
    repositionRef.current = repositionAnchors;
  }, [repositionAnchors]);

  // Pan/zoom fires many range events per gesture; collapse them into one per frame.
  // Right after setData/fitContent the time scale can briefly return null coords, so
  // keep retrying for a handful of frames until at least one anchor lands.
  const scheduleReposition = useCallback(() => {
    if (rafRef.current != null) return;
    let tries = 0;
    const run = () => {
      rafRef.current = null;
      const resolved = repositionRef.current();
      if (!resolved && tries < 30) {
        tries += 1;
        rafRef.current = requestAnimationFrame(run);
      }
    };
    rafRef.current = requestAnimationFrame(run);
  }, []);

  // Must clear the id, not just cancel it. StrictMode mounts → unmounts → remounts,
  // and a leftover non-null id made every later scheduleReposition() return early,
  // which left the news overlay permanently empty.
  useEffect(
    () => () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [],
  );

  const handleCrosshair = useCallback(
    (param: MouseEventParams) => {
      if (!param.time || param.point === undefined) {
        setCrosshairBar(null);
        emitHover(null);
        onCrosshairTimeRef.current?.(null);
        return;
      }
      const sec =
        typeof param.time === 'number'
          ? param.time
          : Math.floor(new Date(String(param.time)).getTime() / 1000);
      setCrosshairBar(barsRef.current.find((bar) => toSec(bar.timestamp) === sec) ?? null);
      emitHover(sec);
      onCrosshairTimeRef.current?.(sec);
    },
    [emitHover],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#161a22' },
        textColor: '#9aa3b5',
        fontFamily: 'IBM Plex Sans, Segoe UI, system-ui, sans-serif',
        fontSize: 12,
      },
      localization: {
        locale: 'en-US',
        timeFormatter: marketChartTimeFormatter,
      },
      grid: {
        vertLines: { color: '#1e232d' },
        horzLines: { color: '#1e232d' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#252a35' },
      timeScale: {
        borderColor: '#252a35',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        tickMarkFormatter: marketTickMarkFormatter,
      },
    });

    const candles = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      lastValueVisible: true,
      priceLineVisible: true,
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.28, bottom: 0.18 },
    });

    const maLines = MA_PERIOD_COLORS.map((color) =>
      chart.addLineSeries({
        color,
        lineWidth: 1,
        ...LINE_BASE,
      }),
    );
    const overlays: Record<string, ISeriesApi<'Line'>> = {
      ema12: chart.addLineSeries({ color: '#38bdf8', lineWidth: 1, ...LINE_BASE }),
      ema26: chart.addLineSeries({ color: '#f472b6', lineWidth: 1, ...LINE_BASE }),
      bollUpper: chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, ...LINE_BASE }),
      bollMiddle: chart.addLineSeries({ color: '#a78bfa', lineWidth: 1, ...LINE_BASE }),
      bollLower: chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, ...LINE_BASE }),
      vwap: chart.addLineSeries({ color: '#22d3ee', lineWidth: 2, ...LINE_BASE }),
      sar: chart.addLineSeries({ color: '#fbbf24', lineWidth: 1, lineStyle: 0, ...LINE_BASE }),
      support: chart.addLineSeries({ color: '#22c55e', lineWidth: 1, lineStyle: 0, ...LINE_BASE }),
      resistance: chart.addLineSeries({ color: '#ef4444', lineWidth: 1, lineStyle: 0, ...LINE_BASE }),
      donchianUpper: chart.addLineSeries({ color: '#fb923c', lineWidth: 1, ...LINE_BASE }),
      donchianMiddle: chart.addLineSeries({ color: '#fdba74', lineWidth: 1, ...LINE_BASE }),
      donchianLower: chart.addLineSeries({ color: '#fb923c', lineWidth: 1, ...LINE_BASE }),
    };

    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;
    maSeriesRefs.current = maLines;
    costPriceLineRef.current = null;
    overlayRefs.current = overlays;

    chart.subscribeCrosshairMove(handleCrosshair);

    const finishTwoPoint = () => {
      trendDraftRef.current = null;
      setTrendDraftUiRef.current(null);
      setDrawTool('cursor');
      drawToolRef.current = 'cursor';
    };

    const handleClick = (param: MouseEventParams) => {
      const tool = drawToolRef.current;
      if (tool === 'cursor') return;
      const series = candleRef.current;
      if (!series || !param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null || !Number.isFinite(price)) return;
      const rounded = Math.round(price * 100) / 100;

      if (tool === 'price' || tool === 'hline') {
        const isMark = tool === 'price';
        if (isMark && markLineRef.current) {
          try {
            series.removePriceLine(markLineRef.current);
          } catch {
            /* ignore */
          }
          markLineRef.current = null;
          undoStackRef.current = undoStackRef.current.filter((e) => e.type !== 'mark');
        }
        const pl = series.createPriceLine({
          price: rounded,
          color: isMark ? '#f59e0b' : '#94a3b8',
          lineWidth: isMark ? 2 : 1,
          lineStyle: isMark ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: isMark ? '标记' : '',
        });
        if (isMark) {
          markLineRef.current = pl;
          setMarkedPriceRef.current(rounded);
          undoStackRef.current.push({ type: 'mark', line: pl });
        } else {
          priceLinesRef.current.push(pl);
          undoStackRef.current.push({ type: 'priceLine', line: pl });
        }
        setDrawTool('cursor');
        drawToolRef.current = 'cursor';
        return;
      }

      if (tool === 'vline') {
        if (!param.time) return;
        const id = nextDrawId();
        setSvgDrawingsRef.current((prev) => [
          ...prev,
          { id, kind: 'vline', time: param.time as Time },
        ]);
        undoStackRef.current.push({ type: 'svg', id });
        setDrawTool('cursor');
        drawToolRef.current = 'cursor';
        return;
      }

      if (tool === 'trend' || tool === 'ray' || tool === 'rect' || tool === 'fib') {
        if (!param.time) return;
        const time = param.time as Time;
        const draft = trendDraftRef.current;
        if (!draft) {
          const point = { time, price: rounded };
          trendDraftRef.current = point;
          setTrendDraftUiRef.current(point);
          return;
        }

        if (tool === 'rect') {
          const id = nextDrawId();
          setSvgDrawingsRef.current((prev) => [
            ...prev,
            {
              id,
              kind: 'rect',
              t1: draft.time,
              p1: draft.price,
              t2: time,
              p2: rounded,
            },
          ]);
          undoStackRef.current.push({ type: 'svg', id });
          finishTwoPoint();
          return;
        }

        if (tool === 'fib') {
          const hi = Math.max(draft.price, rounded);
          const lo = Math.min(draft.price, rounded);
          const span = hi - lo || 1;
          const fibLines: IPriceLine[] = [];
          for (const r of FIB_RATIOS) {
            const level = hi - span * r;
            const pl = series.createPriceLine({
              price: Math.round(level * 100) / 100,
              color: r === 0.5 || r === 0.618 ? '#f59e0b' : '#64748b',
              lineWidth: r === 0.618 ? 2 : 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: `${(r * 100).toFixed(1)}%`,
            });
            priceLinesRef.current.push(pl);
            fibLines.push(pl);
          }
          undoStackRef.current.push({ type: 'fib', lines: fibLines });
          finishTwoPoint();
          return;
        }

        // trend / ray
        const a = draft;
        const b = { time, price: rounded };
        const s1 = asSec(a.time);
        const s2 = asSec(b.time);
        let tStart = a.time;
        let pStart = a.price;
        let tEnd = b.time;
        let pEnd = b.price;
        if (s2 < s1) {
          tStart = b.time;
          pStart = b.price;
          tEnd = a.time;
          pEnd = a.price;
        }
        if (tool === 'ray') {
          const dt = Math.max(asSec(tEnd) - asSec(tStart), 60);
          const dp = pEnd - pStart;
          tEnd = (asSec(tEnd) + dt * 24) as Time;
          pEnd = pEnd + dp * 24;
        }
        const line = chart.addLineSeries({
          color: tool === 'ray' ? '#34d399' : '#60a5fa',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        line.setData([
          { time: tStart, value: pStart },
          { time: tEnd, value: pEnd },
        ]);
        trendSeriesRef.current.push(line);
        undoStackRef.current.push({ type: 'trend', series: line });
        finishTwoPoint();
      }
    };
    chart.subscribeClick(handleClick);

    const onRange = () => {
      scheduleReposition();
      onRangeRef.current?.(chart.timeScale().getVisibleLogicalRange());
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chart.timeScale().subscribeVisibleTimeRangeChange(() => scheduleReposition());

    const ro = new ResizeObserver(() => {
      const host = wrapRef.current ?? containerRef.current;
      if (!host || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: host.clientWidth,
        height: host.clientHeight || height,
      });
      scheduleReposition();
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    else if (containerRef.current) ro.observe(containerRef.current);

    scheduleReposition();

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.unsubscribeClick(handleClick);
      markLineRef.current = null;
      priceLinesRef.current = [];
      trendSeriesRef.current = [];
      trendDraftRef.current = null;
      undoStackRef.current = [];
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      overlayRefs.current = {};
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // Intentionally omit `height` — resizing must not tear down the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleCrosshair, scheduleReposition]);

  // Live-resize without recreating series / wiping markers
  useEffect(() => {
    const chart = chartRef.current;
    const wrap = wrapRef.current;
    if (!chart) return;
    const h = wrap?.clientHeight || height;
    chart.applyOptions({ height: h });
    scheduleReposition();
  }, [height, scheduleReposition]);

  // The HTML marker layer owns the complete visual (fixed-size circle + count).
  // Lightweight Charts markers vary their diameter with `size` and cannot center
  // count text, which caused visually inconsistent, unlabeled anchors.
  const applyNewsMarkers = useCallback(() => {
    // The HTML overlay owns the visual; clear any legacy series markers. Scheduling
    // must happen unconditionally — an early return here left the overlay empty.
    candleRef.current?.setMarkers([]);
    scheduleReposition();
  }, [scheduleReposition]);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current) return;

    const candleData: CandlestickData[] = bars.map((b) => ({
      time: toSec(b.timestamp) as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    const volumeData: HistogramData[] = bars.map((b) => ({
      time: toSec(b.timestamp) as Time,
      value: b.volume,
      color: b.close >= b.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
    }));

    candleRef.current.setData(candleData);
    volumeRef.current.setData(volumeData);

    const showMa = enabledMain.includes('ma');
    maSeriesRefs.current.forEach((series, idx) => {
      const row = maSeriesData[idx];
      if (!showMa || !row || row.values.length === 0) {
        series.setData([]);
        return;
      }
      const offset = bars.length - row.values.length;
      series.setData(
        row.values.map((v, i) => ({
          time: toSec(bars[offset + i]?.timestamp ?? bars[bars.length - 1]!.timestamp) as Time,
          value: v,
        })),
      );
    });

    const setAligned = (key: string, values: number[], enabled: boolean) => {
      const series = overlayRefs.current[key];
      if (!series) return;
      if (!enabled || values.length === 0) {
        series.setData([]);
        return;
      }
      const offset = bars.length - values.length;
      series.setData(
        values.map((value, i) => ({
          time: toSec(bars[offset + i]?.timestamp ?? bars[bars.length - 1]!.timestamp) as Time,
          value,
        })),
      );
    };
    const setObjectLines = <T extends Record<string, number>>(
      values: T[],
      mapping: Record<string, keyof T>,
      enabled: boolean,
    ) => {
      for (const [seriesKey, field] of Object.entries(mapping)) {
        setAligned(
          seriesKey,
          values.map((row) => row[field] as number),
          enabled,
        );
      }
    };

    const has = (id: MainIndicatorId) => enabledMain.includes(id);
    setAligned('ema12', overlayData.ema12, has('ema'));
    setAligned('ema26', overlayData.ema26, has('ema'));
    setObjectLines(
      overlayData.boll,
      { bollUpper: 'upper', bollMiddle: 'middle', bollLower: 'lower' },
      has('boll'),
    );
    setAligned('vwap', overlayData.vwap, has('vwap'));
    setAligned('sar', overlayData.sar, has('sar'));
    setObjectLines(
      overlayData.support,
      { support: 'support', resistance: 'resistance' },
      has('support'),
    );
    setObjectLines(
      overlayData.donchian,
      { donchianUpper: 'upper', donchianMiddle: 'middle', donchianLower: 'lower' },
      has('donchian'),
    );

    const barSymbol = bars[0]?.symbol ?? symbol;
    const fitKey = `${barSymbol}:${timeframe}:${bars.length}:${bars[0]?.timestamp ?? ''}`;
    // Only autoscale when bars actually belong to the active symbol (avoid
    // keepPreviousData flashes locking the Y axis on the previous ticker).
    if (
      fitKey !== fittedKeyRef.current &&
      bars.length > 0 &&
      (!bars[0]?.symbol || bars[0].symbol === symbol)
    ) {
      fittedKeyRef.current = fitKey;
      // Re-enable Y autoscale after symbol/timeframe switches — manual scroll
      // leaves autoScale=false and the next (cheaper) stock can render off-screen.
      candleRef.current?.priceScale().applyOptions({ autoScale: true });
      chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
      chartRef.current?.timeScale().fitContent();
      onRangeRef.current?.(chartRef.current?.timeScale().getVisibleLogicalRange() ?? null);
    }

    applyNewsMarkers();
  }, [
    bars,
    maSeriesData,
    timeframe,
    applyNewsMarkers,
    enabledMain,
    overlayData,
    symbol,
  ]);

  // Cost line updates independently so portfolio polls don't rewrite all series.
  const avgCost = position?.avgCost;
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    if (avgCost != null && Number.isFinite(avgCost) && bars.length > 0) {
      const opts = {
        price: avgCost,
        color: '#a78bfa',
        lineWidth: 1 as const,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: '成本',
      };
      if (costPriceLineRef.current) {
        costPriceLineRef.current.applyOptions(opts);
      } else {
        costPriceLineRef.current = candles.createPriceLine(opts);
      }
    } else if (costPriceLineRef.current) {
      candles.removePriceLine(costPriceLineRef.current);
      costPriceLineRef.current = null;
    }
  }, [avgCost, bars.length, symbol]);

  useEffect(() => {
    applyNewsMarkers();
  }, [anchors, selectedEventId, applyNewsMarkers]);

  useEffect(() => {
    const sec = lastHoverSecRef.current;
    if (sec == null) return;
    onBarHoverRef.current?.({
      barTime: sec,
      items: newsByBar.get(sec) ?? [],
    });
  }, [newsByBar]);

  const showRecentBars = useCallback((count: number | null) => {
    const chart = chartRef.current;
    if (!chart || barsRef.current.length === 0) return;
    if (count == null || count >= barsRef.current.length) {
      chart.timeScale().fitContent();
      return;
    }
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, barsRef.current.length - count),
      to: barsRef.current.length + 3,
    });
  }, []);

  const hudBar = crosshairBar ?? bars[bars.length - 1] ?? null;
  const hudIndex = hudBar ? bars.findIndex((b) => b.timestamp === hudBar.timestamp) : -1;

  const valueAt = (series: number[], index: number): number | null => {
    if (index < 0) return null;
    const offset = bars.length - series.length;
    const local = index - offset;
    if (local < 0 || local >= series.length) return null;
    const v = series[local];
    return v == null || Number.isNaN(v) ? null : v;
  };

  const hudRows = useMemo(() => {
    if (!hudBar || hudIndex < 0) return [] as { label: string; value: string; color: string }[];
    const rows: { label: string; value: string; color: string }[] = [
      { label: 'O', value: hudBar.open.toFixed(2), color: '#94a3b8' },
      { label: 'H', value: hudBar.high.toFixed(2), color: '#22c55e' },
      { label: 'L', value: hudBar.low.toFixed(2), color: '#ef4444' },
      { label: 'C', value: hudBar.close.toFixed(2), color: '#e2e8f0' },
      { label: 'V', value: hudBar.volume.toLocaleString(), color: '#94a3b8' },
    ];
    const push = (label: string, value: number | null, color: string) => {
      if (value == null) return;
      rows.push({ label, value: value.toFixed(2), color });
    };
    if (enabledMain.includes('ma')) {
      maSeriesData.forEach((row, idx) => {
        push(`MA${row.period}`, valueAt(row.values, hudIndex), MA_PERIOD_COLORS[idx] ?? '#94a3b8');
      });
    }
    if (enabledMain.includes('ema')) {
      push('EMA12', valueAt(overlayData.ema12, hudIndex), '#38bdf8');
      push('EMA26', valueAt(overlayData.ema26, hudIndex), '#f472b6');
    }
    if (enabledMain.includes('boll')) {
      const offset = bars.length - overlayData.boll.length;
      const local = hudIndex - offset;
      const point = local >= 0 ? overlayData.boll[local] : undefined;
      if (point) {
        push('BOLL.U', point.upper, '#8b5cf6');
        push('BOLL.M', point.middle, '#a78bfa');
        push('BOLL.L', point.lower, '#8b5cf6');
      }
    }
    if (enabledMain.includes('vwap')) push('VWAP', valueAt(overlayData.vwap, hudIndex), '#22d3ee');
    if (enabledMain.includes('sar')) push('SAR', valueAt(overlayData.sar, hudIndex), '#fbbf24');
    if (enabledMain.includes('support')) {
      const offset = bars.length - overlayData.support.length;
      const local = hudIndex - offset;
      const point = local >= 0 ? overlayData.support[local] : undefined;
      if (point) {
        push('支撑', point.support, '#22c55e');
        push('压力', point.resistance, '#ef4444');
      }
    }
    if (enabledMain.includes('donchian')) {
      const offset = bars.length - overlayData.donchian.length;
      const local = hudIndex - offset;
      const point = local >= 0 ? overlayData.donchian[local] : undefined;
      if (point) {
        push('DC.U', point.upper, '#fb923c');
        push('DC.M', point.middle, '#fdba74');
        push('DC.L', point.lower, '#fb923c');
      }
    }
    if (position) {
      rows.push({ label: '成本', value: position.avgCost.toFixed(2), color: '#a78bfa' });
    }
    return rows;
  }, [hudBar, hudIndex, bars.length, enabledMain, maSeriesData, overlayData, position]);

  return (
    <div className="card overflow-hidden">
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/80 px-3 py-1.5 text-xs text-muted">
        <span className="font-medium text-gray-300">K线 · {timeframe}</span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-up" /> 利好
          <i className="h-2 w-2 rounded-full bg-down" /> 利空
          <i className="h-2 w-2 rounded-full bg-news" /> 中性
        </span>
        {newsLoading && <span className="text-primary">同步新闻…</span>}
        {newsError && <span className="text-down">新闻接口失败</span>}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {showToggle && (
            <button
              type="button"
              onClick={toggleAnchors}
              title={displayAnchors ? '隐藏 K 线上的新闻锚点' : '显示 K 线上的新闻锚点'}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                displayAnchors
                  ? 'border-news/40 bg-news/15 text-news'
                  : 'border-border bg-surface text-muted hover:border-border hover:text-gray-200'
              }`}
            >
              <span
                className={`relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors ${
                  displayAnchors ? 'bg-news' : 'bg-border'
                }`}
                aria-hidden
              >
                <span
                  className={`absolute h-2.5 w-2.5 rounded-full bg-white shadow transition-transform ${
                    displayAnchors ? 'translate-x-3' : 'translate-x-0.5'
                  }`}
                />
              </span>
              K线新闻显示
            </button>
          )}
          {[50, 100, 200].map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => showRecentBars(count)}
              className="rounded-md px-2 py-1 hover:bg-surface-hover hover:text-gray-200"
            >
              {count}根
            </button>
          ))}
          <button
            type="button"
            onClick={() => showRecentBars(null)}
            className="rounded-md px-2 py-1 hover:bg-surface-hover hover:text-gray-200"
          >
            全部
          </button>
        </div>
      </div>

      <div className="flex" style={{ height }}>
        <aside className="flex w-[3.25rem] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/80 bg-gradient-to-b from-surface-raised to-surface py-1.5">
          {DRAW_TOOLS.map((t) => {
            const Icon = t.icon;
            const active = drawTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                title={t.tip}
                onClick={() => selectDrawTool(t.id)}
                className={`flex w-11 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 text-[10px] font-medium leading-tight ${
                  active
                    ? 'bg-primary/20 text-primary shadow-sm ring-1 ring-primary/30'
                    : 'text-muted hover:bg-surface-hover hover:text-gray-200'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
                <span className="max-w-full truncate">{t.label}</span>
              </button>
            );
          })}
          <div className="my-0.5 h-px w-8 bg-border" />
          <button
            type="button"
            title="撤销上一笔画线"
            onClick={undoLastDrawing}
            className="flex w-11 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 text-[10px] font-medium text-muted hover:bg-surface-hover hover:text-gray-200"
          >
            <Undo2 className="h-4 w-4" />
            <span>撤销</span>
          </button>
          <button
            type="button"
            title="清除全部画线"
            onClick={clearDrawings}
            className="flex w-11 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 text-[10px] font-medium text-muted hover:bg-surface-hover hover:text-down"
          >
            <Eraser className="h-4 w-4" />
            <span>清除</span>
          </button>
        </aside>

        <div
          ref={wrapRef}
          className="relative min-w-0 flex-1"
          style={{
            height,
            cursor: drawTool === 'cursor' ? undefined : 'crosshair',
          }}
          onMouseEnter={() => {
            if (pointerLeftRef.current) {
              pointerLeftRef.current = false;
              releaseLock();
            }
          }}
          onMouseLeave={() => {
            pointerLeftRef.current = true;
          }}
        >
        <div ref={containerRef} className="absolute inset-0" />

        {draftPx && (
          <div
            className="pointer-events-none absolute z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-400 bg-sky-400/45 shadow-[0_0_0_3px_rgba(96,165,250,0.25)]"
            style={{ left: draftPx.left, top: draftPx.top }}
          />
        )}

        {svgLayout.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 z-[12] h-full w-full overflow-visible">
            {svgLayout.map((d) =>
              d.kind === 'vline' ? (
                <line
                  key={d.id}
                  x1={d.x}
                  y1={0}
                  x2={d.x}
                  y2="100%"
                  stroke="#a78bfa"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              ) : (
                <rect
                  key={d.id}
                  x={d.x}
                  y={d.y}
                  width={Math.max(d.w, 1)}
                  height={Math.max(d.h, 1)}
                  fill="rgba(59,130,246,0.12)"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                />
              ),
            )}
          </svg>
        )}

        {hudRows.length > 0 && (
          <div className="pointer-events-none absolute right-2 top-2 z-20 max-w-[46%] rounded border border-border/80 bg-surface-card/90 px-2 py-1.5 text-[10px] shadow-lg backdrop-blur-sm">
            <div className="mb-1 text-[9px] uppercase tracking-wide text-muted">
              {crosshairBar ? '十字光标' : '最新'}
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 tabular">
              {hudRows.map((row) => (
                <span key={row.label} style={{ color: row.color }}>
                  {row.label} {row.value}
                </span>
              ))}
            </div>
          </div>
        )}

        {displayAnchors && (
        <svg className="pointer-events-none absolute inset-0 z-[15] h-full w-full overflow-visible">
          {anchorLayout.map((a) => {
            if (!a.visible) return null;
            const color = directionColor(a.direction);
            const active = a.items.some((i) => i.id === selectedEventId);
            return (
              <g key={`stem-${a.barTime}`}>
                <line
                  x1={a.left}
                  y1={a.top}
                  x2={a.left}
                  y2={a.anchorY}
                  stroke={color}
                  strokeWidth={active ? 2 : 1.4}
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                  strokeOpacity={active ? 1 : 0.9}
                />
              </g>
            );
          })}
        </svg>
        )}

        {displayAnchors && (
        <div className="pointer-events-none absolute inset-0 z-20">
          {anchorLayout.map((a) => {
            if (!a.visible) return null;
            const color = directionColor(a.direction);
            const active = a.items.some((i) => i.id === selectedEventId);
            const pinned = lockedBarTime === a.barTime;
            return (
              <button
                key={`dot-${a.barTime}`}
                type="button"
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: a.left, top: a.top }}
                title={`${a.count} 条新闻 · ${a.direction}${pinned ? ' · 已锁定' : ' · 点击锁定'}`}
                onMouseEnter={() => emitHover(a.barTime)}
                onClick={(e) => {
                  e.stopPropagation();
                  lockToBar(a.barTime);
                }}
              >
                <span
                  className="relative inline-flex h-5 w-5 items-center justify-center rounded-full border-2 text-[8px] font-bold leading-none text-white shadow"
                  style={{
                    backgroundColor: color,
                    borderColor: pinned ? '#ffffff' : '#161a22',
                    boxShadow: pinned || active ? `0 0 0 2px ${color}` : undefined,
                  }}
                >
                  {a.count}
                </span>
              </button>
            );
          })}
        </div>
        )}

        {bars.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-card/80 text-sm text-muted">
            暂无 K 线数据，请稍后重试或切换周期
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
