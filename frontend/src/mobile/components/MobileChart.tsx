import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type LogicalRange,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar, NewsItem, Timeframe } from '../../types/api';
import { MA_PERIOD_COLORS, type MainIndicatorId } from '../../features/chart/indicatorConfig';
import { indexNewsByBar } from '../../features/chart/newsAnchors';
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
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { shouldSelectMobileBarTap } from './mobileChartHitTest';

export type MobileDrawTool = 'cursor' | 'hline' | 'trend';

export interface HoveredBar {
  bar: Bar;
  index: number;
  /** Price at finger/cursor Y — matches the horizontal crosshair row. */
  crosshairPrice: number | null;
}

type UndoEntry =
  | { type: 'hline'; line: IPriceLine }
  | { type: 'mark'; line: IPriceLine }
  | { type: 'trend'; series: ISeriesApi<'Line'> };

interface OverlayLine {
  key: string;
  color: string;
  width: 1 | 2;
  dashed?: boolean;
  values: (number | undefined)[];
}

interface MobileChartProps {
  bars: Bar[];
  symbol: string;
  timeframe: Timeframe | string;
  height: number;
  maPeriods: number[];
  enabledMain: MainIndicatorId[];
  news?: NewsItem[];
  avgCost?: number | null;
  /** Unix seconds of the currently selected candle (highlight). */
  selectedBarTime?: number | null;
  /** When false, news circle markers are hidden. */
  showNewsAnchors?: boolean;
  drawTool?: MobileDrawTool;
  clearToken?: number;
  /** Increment to undo the last drawing. */
  undoToken?: number;
  onHover?: (hovered: HoveredBar | null) => void;
  /** Fired when the candle chart pan/zoom range changes — keep indicator panes locked. */
  onVisibleRangeChange?: (range: LogicalRange | null) => void;
  /** Unix seconds under the crosshair / finger. */
  onCrosshairTimeChange?: (time: number | null) => void;
  /**
   * Fired when the user taps the candle *body* (open↔close), not empty chart space.
   * Pass `null` when the tap missed a body so the parent can clear selection.
   */
  onBarSelect?: (barTime: number | null) => void;
}

const LONG_PRESS_MS = 2000;
const LONG_PRESS_MOVE_PX = 12;

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;

function asUnix(time: Time): number | null {
  if (typeof time === 'number' && Number.isFinite(time)) return time;
  if (typeof time === 'string') {
    const n = Math.floor(new Date(time).getTime() / 1000);
    return Number.isFinite(n) ? n : null;
  }
  if (time && typeof time === 'object' && 'year' in time) {
    const bd = time as { year: number; month: number; day: number };
    return Math.floor(Date.UTC(bd.year, bd.month - 1, bd.day) / 1000);
  }
  return null;
}

/** Proper timeframe-aware snap — same logic as the desktop workbench. */
export function newsByBarMap(
  bars: Bar[],
  news: NewsItem[],
  timeframe: Timeframe | string,
): Map<number, NewsItem[]> {
  return indexNewsByBar(bars, news, timeframe as Timeframe);
}

/** One representative headline per bar (highest importance) for markers. */
export function anchorNewsToBars(
  bars: Bar[],
  news: NewsItem[],
  timeframe: Timeframe | string = '1Day',
): Map<number, NewsItem> {
  const grouped = newsByBarMap(bars, news, timeframe);
  const out = new Map<number, NewsItem>();
  const rank = (item: NewsItem) =>
    item.importance === 'high' ? 3 : item.importance === 'medium' ? 2 : 1;
  for (const [time, items] of grouped) {
    let best = items[0]!;
    for (const item of items) {
      if (rank(item) > rank(best)) best = item;
    }
    out.set(time, best);
  }
  return out;
}

function padLeft(total: number, series: number[]): (number | undefined)[] {
  const pad = total - series.length;
  return pad <= 0 ? series.slice(-total) : [...Array<undefined>(pad), ...series];
}

function buildOverlays(
  bars: Bar[],
  enabled: MainIndicatorId[],
  maPeriods: number[],
): OverlayLine[] {
  if (bars.length === 0) return [];
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);
  const n = bars.length;
  const out: OverlayLine[] = [];

  if (enabled.includes('ma')) {
    maPeriods.forEach((period, i) => {
      out.push({
        key: `ma${period}`,
        color: MA_PERIOD_COLORS[i % MA_PERIOD_COLORS.length]!,
        width: 1,
        values: padLeft(n, sma(closes, period)),
      });
    });
  }
  if (enabled.includes('ema')) {
    out.push({ key: 'ema12', color: '#38bdf8', width: 1, values: padLeft(n, ema(closes, 12)) });
    out.push({ key: 'ema26', color: '#fb923c', width: 1, values: padLeft(n, ema(closes, 26)) });
  }
  if (enabled.includes('boll')) {
    const bands = bollinger(closes, 20, 2);
    out.push({
      key: 'bollU',
      color: '#a78bfa',
      width: 1,
      values: padLeft(n, bands.map((b) => b.upper)),
    });
    out.push({
      key: 'bollM',
      color: '#a78bfa',
      width: 1,
      dashed: true,
      values: padLeft(n, bands.map((b) => b.middle)),
    });
    out.push({
      key: 'bollL',
      color: '#a78bfa',
      width: 1,
      values: padLeft(n, bands.map((b) => b.lower)),
    });
  }
  if (enabled.includes('vwap')) {
    out.push({
      key: 'vwap',
      color: '#facc15',
      width: 2,
      values: padLeft(n, vwap(highs, lows, closes, volumes)),
    });
  }
  if (enabled.includes('sar')) {
    out.push({
      key: 'sar',
      color: '#f472b6',
      width: 1,
      dashed: true,
      values: padLeft(n, parabolicSar(highs, lows)),
    });
  }
  if (enabled.includes('support')) {
    const sr = supportResistance(highs, lows, 20);
    out.push({
      key: 'sup',
      color: '#22c55e',
      width: 1,
      dashed: true,
      values: padLeft(n, sr.map((s) => s.support)),
    });
    out.push({
      key: 'res',
      color: '#ef4444',
      width: 1,
      dashed: true,
      values: padLeft(n, sr.map((s) => s.resistance)),
    });
  }
  if (enabled.includes('donchian')) {
    const dc = donchian(highs, lows, 20);
    out.push({
      key: 'dcU',
      color: '#2dd4bf',
      width: 1,
      values: padLeft(n, dc.map((d) => d.upper)),
    });
    out.push({
      key: 'dcL',
      color: '#2dd4bf',
      width: 1,
      values: padLeft(n, dc.map((d) => d.lower)),
    });
  }
  return out;
}

export function MobileChart({
  bars,
  symbol,
  timeframe,
  height,
  maPeriods,
  enabledMain,
  news,
  avgCost,
  selectedBarTime = null,
  showNewsAnchors = true,
  drawTool = 'cursor',
  clearToken = 0,
  undoToken = 0,
  onHover,
  onVisibleRangeChange,
  onCrosshairTimeChange,
  onBarSelect,
}: MobileChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const highlightRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlayRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const costLineRef = useRef<IPriceLine | null>(null);
  const markLineRef = useRef<IPriceLine | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const trendSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const trendDraftRef = useRef<{ time: Time; price: number } | null>(null);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const drawToolRef = useRef(drawTool);
  const fitKeyRef = useRef('');
  const longPressRef = useRef<{
    timer: number | null;
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const newsAnchorsRef = useRef<Map<number, NewsItem>>(new Map());
  const setMarkedPrice = useWorkbenchStore((s) => s.setMarkedPrice);

  const [fingerHud, setFingerHud] = useState<{ y: number; price: number } | null>(null);

  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onBarSelectRef = useRef(onBarSelect);
  onBarSelectRef.current = onBarSelect;
  const onVisibleRangeRef = useRef(onVisibleRangeChange);
  onVisibleRangeRef.current = onVisibleRangeChange;
  const onCrosshairTimeRef = useRef(onCrosshairTimeChange);
  onCrosshairTimeRef.current = onCrosshairTimeChange;
  const barsRef = useRef(bars);
  barsRef.current = bars;
  drawToolRef.current = drawTool;

  const emitHoverAt = (clientX: number, clientY: number) => {
    const host = hostRef.current;
    const chart = chartRef.current;
    const series = candleRef.current;
    const cb = onHoverRef.current;
    if (!host || !chart || !series || !cb) return;
    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (y < 0 || y > rect.height || x < 0 || x > rect.width) {
      setFingerHud(null);
      chart.clearCrosshairPosition();
      onCrosshairTimeRef.current?.(null);
      cb(null);
      return;
    }
    const rawPrice = series.coordinateToPrice(y);
    const crosshairPrice =
      rawPrice != null && Number.isFinite(rawPrice) ? Math.round(rawPrice * 100) / 100 : null;
    if (crosshairPrice != null) setFingerHud({ y, price: crosshairPrice });
    else setFingerHud(null);

    const time = chart.timeScale().coordinateToTime(x);
    const t = time != null ? asUnix(time) : null;
    const list = barsRef.current;
    if (t == null) {
      chart.clearCrosshairPosition();
      onCrosshairTimeRef.current?.(null);
      cb(null);
      return;
    }
    // Nearest bar by time (touch often lands between candles).
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(sec(list[i]!.timestamp) - t);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      chart.clearCrosshairPosition();
      onCrosshairTimeRef.current?.(null);
      cb(null);
      return;
    }
    const hoveredBar = list[bestIdx]!;
    if (crosshairPrice != null) {
      chart.setCrosshairPosition(crosshairPrice, sec(hoveredBar.timestamp), series);
    }
    onCrosshairTimeRef.current?.(sec(hoveredBar.timestamp));
    cb({ bar: hoveredBar, index: bestIdx, crosshairPrice });
  };

  const placePriceMark = (price: number) => {
    const series = candleRef.current;
    if (!series) return;
    const rounded = Math.round(price * 100) / 100;
    if (markLineRef.current) {
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
      color: '#f59e0b',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '标记',
    });
    markLineRef.current = pl;
    undoStackRef.current.push({ type: 'mark', line: pl });
    setMarkedPrice(rounded);
  };

  const overlays = useMemo(
    () => buildOverlays(bars, enabledMain, maPeriods),
    [bars, enabledMain, maPeriods],
  );

  const newsAnchors = useMemo(
    () => anchorNewsToBars(bars, news ?? [], timeframe),
    [bars, news, timeframe],
  );
  newsAnchorsRef.current = newsAnchors;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0f131a' },
        textColor: '#8b93a5',
        fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
        fontSize: 10,
      },
      localization: { locale: 'en-US', timeFormatter: marketChartTimeFormatter },
      grid: {
        vertLines: { color: 'rgba(30,35,45,0.6)' },
        horzLines: { color: 'rgba(30,35,45,0.6)' },
      },
      crosshair: {
        // Normal: horizontal line follows finger Y (Magnet snaps to OHLC and looks "wrong").
        mode: CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: '#f59e0b',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1c212b',
        },
        horzLine: {
          width: 1,
          color: '#f59e0b',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1c212b',
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.24 },
        entireTextOnly: true,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        tickMarkFormatter: marketTickMarkFormatter,
      },
      handleScroll: {
        horzTouchDrag: true,
        vertTouchDrag: false,
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        pinch: true,
        axisPressedMouseMove: false,
        mouseWheel: true,
        axisDoubleClickReset: true,
      },
    });

    candleRef.current = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceLineVisible: true,
      lastValueVisible: true,
    });

    // Transparent body + yellow border/wick → selected candle outline only.
    highlightRef.current = chart.addCandlestickSeries({
      upColor: 'rgba(250,204,21,0.22)',
      downColor: 'rgba(250,204,21,0.22)',
      borderUpColor: '#facc15',
      borderDownColor: '#facc15',
      wickUpColor: '#facc15',
      wickDownColor: '#facc15',
      borderVisible: true,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;

    const resize = () => chart.applyOptions({ width: host.clientWidth });
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    chart.subscribeCrosshairMove((param) => {
      const cb = onHoverRef.current;
      if (!param.time || param.point === undefined) {
        // Keep touch-driven HUD if a finger is still down (handled by pointer handlers).
        if (!longPressRef.current) {
          setFingerHud(null);
          onCrosshairTimeRef.current?.(null);
          cb?.(null);
        }
        return;
      }
      const series = candleRef.current;
      let crosshairPrice: number | null = null;
      if (series) {
        const p = series.coordinateToPrice(param.point.y);
        if (p != null && Number.isFinite(p)) {
          crosshairPrice = Math.round(p * 100) / 100;
          setFingerHud({ y: param.point.y, price: crosshairPrice });
        }
      }
      const t = param.time as number;
      const list = barsRef.current;
      const index = list.findIndex((b) => sec(b.timestamp) === t);
      onCrosshairTimeRef.current?.(t);
      cb?.(index >= 0 ? { bar: list[index]!, index, crosshairPrice } : null);
    });

    const emitRange = () => {
      onVisibleRangeRef.current?.(chart.timeScale().getVisibleLogicalRange());
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(emitRange);
    // Initial sync after first layout
    requestAnimationFrame(emitRange);

    chart.subscribeClick((param) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const tool = drawToolRef.current;
      const series = candleRef.current;
      if (!param.point || !series) return;

      const coordinateTime = chart.timeScale().coordinateToTime(param.point.x);
      const clickedTime = param.time != null
        ? asUnix(param.time)
        : coordinateTime != null
          ? asUnix(coordinateTime)
          : null;
      const price = series.coordinateToPrice(param.point.y);

      if (tool === 'cursor') {
        // Only select when the tap lands on the candle body (open↔close).
        if (clickedTime == null || price == null || !Number.isFinite(price)) {
          onBarSelectRef.current?.(null);
          return;
        }
        let bar: Bar | null = null;
        let barTime: number | null = null;
        let bestDistance = Infinity;
        for (const candidate of barsRef.current) {
          const candidateTime = sec(candidate.timestamp);
          const x = chart.timeScale().timeToCoordinate(candidateTime);
          if (x == null) continue;
          const distance = Math.abs(x - param.point.x);
          if (distance < bestDistance) {
            bestDistance = distance;
            bar = candidate;
            barTime = candidateTime;
          }
        }
        const barSpacing = chart.timeScale().options().barSpacing;
        const horizontalTolerance = Math.max(5, Math.min(9, barSpacing * 0.65));
        if (!bar || barTime == null || bestDistance > horizontalTolerance) {
          onBarSelectRef.current?.(null);
          return;
        }
        if (!shouldSelectMobileBarTap({
          pointerY: param.point.y,
          highY: series.priceToCoordinate(bar.high),
          lowY: series.priceToCoordinate(bar.low),
          hasNewsAnchor: newsAnchorsRef.current.has(barTime),
        })) {
          onBarSelectRef.current?.(null);
          return;
        }
        onBarSelectRef.current?.(barTime);
        return;
      }

      if (price == null || !Number.isFinite(price)) return;
      const rounded = Math.round(price * 100) / 100;

      if (tool === 'hline') {
        const pl = series.createPriceLine({
          price: rounded,
          color: '#60a5fa',
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${rounded.toFixed(2)}`,
        });
        priceLinesRef.current.push(pl);
        undoStackRef.current.push({ type: 'hline', line: pl });
        return;
      }

      if (tool === 'trend') {
        if (param.time == null) return;
        const draft = trendDraftRef.current;
        if (!draft) {
          trendDraftRef.current = { time: param.time, price: rounded };
          return;
        }
        let tStart = draft.time;
        let pStart = draft.price;
        let tEnd = param.time;
        let pEnd = rounded;
        const s1 = asUnix(tStart) ?? 0;
        const s2 = asUnix(tEnd) ?? 0;
        if (s2 < s1) {
          tStart = param.time;
          pStart = rounded;
          tEnd = draft.time;
          pEnd = draft.price;
        }
        const line = chart.addLineSeries({
          color: '#60a5fa',
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
        trendDraftRef.current = null;
      }
    });

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      highlightRef.current = null;
      volumeRef.current = null;
      overlayRef.current.clear();
      costLineRef.current = null;
      markLineRef.current = null;
      priceLinesRef.current = [];
      trendSeriesRef.current = [];
      trendDraftRef.current = null;
      undoStackRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const drawing = drawTool !== 'cursor';
    chart.applyOptions({
      handleScroll: {
        horzTouchDrag: !drawing,
        vertTouchDrag: false,
        mouseWheel: true,
        pressedMouseMove: !drawing,
      },
    });
    if (drawTool !== 'trend') trendDraftRef.current = null;
  }, [drawTool]);

  useEffect(() => {
    if (clearToken === 0) return;
    const series = candleRef.current;
    const chart = chartRef.current;
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
    for (const line of trendSeriesRef.current) {
      try {
        chart?.removeSeries(line);
      } catch {
        /* ignore */
      }
    }
    trendSeriesRef.current = [];
    trendDraftRef.current = null;
    undoStackRef.current = [];
    setMarkedPrice(null);
    setFingerHud(null);
  }, [clearToken, setMarkedPrice]);

  useEffect(() => {
    if (undoToken === 0) return;
    if (trendDraftRef.current) {
      trendDraftRef.current = null;
      return;
    }
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    const series = candleRef.current;
    const chart = chartRef.current;
    if (entry.type === 'hline' || entry.type === 'mark') {
      try {
        series?.removePriceLine(entry.line);
      } catch {
        /* ignore */
      }
      if (entry.type === 'hline') {
        priceLinesRef.current = priceLinesRef.current.filter((pl) => pl !== entry.line);
      } else {
        if (markLineRef.current === entry.line) markLineRef.current = null;
        setMarkedPrice(null);
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
    }
  }, [undoToken, setMarkedPrice]);

  useEffect(() => {
    chartRef.current?.applyOptions({ height });
  }, [height]);

  useEffect(() => {
    const candles = candleRef.current;
    const volume = volumeRef.current;
    if (!candles || !volume || bars.length === 0) return;

    candles.setData(
      bars.map((b) => ({
        time: sec(b.timestamp),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );
    volume.setData(
      bars.map((b) => ({
        time: sec(b.timestamp),
        value: b.volume,
        color: b.close >= b.open ? 'rgba(34,197,94,0.32)' : 'rgba(239,68,68,0.32)',
      })),
    );

    const key = `${symbol}:${timeframe}:${bars.length}:${bars[0]?.timestamp ?? ''}`;
    if (key !== fitKeyRef.current) {
      fitKeyRef.current = key;
      candles.priceScale().applyOptions({ autoScale: true });
      chartRef.current?.timeScale().fitContent();
      onVisibleRangeRef.current?.(chartRef.current?.timeScale().getVisibleLogicalRange() ?? null);
    }
  }, [bars, symbol, timeframe]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const live = overlayRef.current;
    const wanted = new Set(overlays.map((o) => o.key));

    for (const [key, series] of live) {
      if (!wanted.has(key)) {
        chart.removeSeries(series);
        live.delete(key);
      }
    }

    for (const overlay of overlays) {
      let series = live.get(overlay.key);
      if (!series) {
        series = chart.addLineSeries({
          color: overlay.color,
          lineWidth: overlay.width,
          lineStyle: overlay.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        live.set(overlay.key, series);
      } else {
        series.applyOptions({ color: overlay.color, lineWidth: overlay.width });
      }
      const points: { time: UTCTimestamp; value: number }[] = [];
      overlay.values.forEach((value, i) => {
        const bar = bars[i];
        if (value != null && Number.isFinite(value) && bar) {
          points.push({ time: sec(bar.timestamp), value });
        }
      });
      series.setData(points);
    }
  }, [overlays, bars]);

  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    if (avgCost != null && Number.isFinite(avgCost) && bars.length > 0) {
      const opts = {
        price: avgCost,
        color: '#a78bfa',
        lineWidth: 1 as const,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '成本',
      };
      if (costLineRef.current) costLineRef.current.applyOptions(opts);
      else costLineRef.current = candles.createPriceLine(opts);
    } else if (costLineRef.current) {
      candles.removePriceLine(costLineRef.current);
      costLineRef.current = null;
    }
  }, [avgCost, bars.length]);

  // News markers only — selection is drawn as a yellow candle outline, not a marker.
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    try {
      if (!showNewsAnchors || newsAnchors.size === 0) {
        candles.setMarkers([]);
        return;
      }
      const markers: SeriesMarker<UTCTimestamp>[] = [...newsAnchors.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, item]) => ({
          time: time as UTCTimestamp,
          position: 'aboveBar' as const,
          shape: 'circle' as const,
          color:
            item.direction === 'positive'
              ? '#22c55e'
              : item.direction === 'negative'
                ? '#ef4444'
                : '#a78bfa',
          text: '',
        }));
      candles.setMarkers(markers);
    } catch {
      try {
        candles.setMarkers([]);
      } catch {
        /* ignore */
      }
    }
  }, [newsAnchors, showNewsAnchors]);

  // Strong selected state: translucent yellow body plus yellow border and wick.
  useEffect(() => {
    const highlight = highlightRef.current;
    if (!highlight) return;
    if (selectedBarTime == null) {
      highlight.setData([]);
      return;
    }
    const bar = bars.find((b) => sec(b.timestamp) === selectedBarTime);
    if (!bar) {
      highlight.setData([]);
      return;
    }
    highlight.setData([
      {
        time: sec(bar.timestamp),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      },
    ]);
  }, [selectedBarTime, bars]);

  const clearLongPress = () => {
    const lp = longPressRef.current;
    if (lp?.timer != null) window.clearTimeout(lp.timer);
    longPressRef.current = null;
  };

  /** Start / restart 2s dwell clock at the current finger position. */
  const armLongPress = (pointerId: number, x: number, y: number) => {
    const prev = longPressRef.current;
    if (prev?.timer != null) window.clearTimeout(prev.timer);
    longPressRef.current = {
      pointerId,
      x,
      y,
      timer: window.setTimeout(() => {
        const cur = longPressRef.current;
        if (!cur || cur.pointerId !== pointerId) return;
        // Keep anchor so a later drag can re-arm without lifting the finger.
        longPressRef.current = { pointerId, x: cur.x, y: cur.y, timer: null };
        const host = hostRef.current;
        const series = candleRef.current;
        if (!host || !series) return;
        const rect = host.getBoundingClientRect();
        const localY = cur.y - rect.top;
        const price = series.coordinateToPrice(localY);
        if (price == null || !Number.isFinite(price)) return;
        placePriceMark(price);
        suppressClickRef.current = true;
        try {
          navigator.vibrate?.(12);
        } catch {
          /* ignore */
        }
      }, LONG_PRESS_MS),
    };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (drawToolRef.current !== 'cursor') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    emitHoverAt(e.clientX, e.clientY);
    armLongPress(e.pointerId, e.clientX, e.clientY);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const lp = longPressRef.current;
    if (lp && lp.pointerId === e.pointerId) {
      const dx = e.clientX - lp.x;
      const dy = e.clientY - lp.y;
      // Moved away from the dwell anchor → restart the 2s clock here.
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
        armLongPress(e.pointerId, e.clientX, e.clientY);
      }
    }
    if (e.pointerType === 'touch' || e.buttons === 1 || lp) {
      emitHoverAt(e.clientX, e.clientY);
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const lp = longPressRef.current;
    if (lp && lp.pointerId === e.pointerId) clearLongPress();
  };

  return (
    <div
      ref={wrapRef}
      className="relative touch-pan-lock w-full"
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        clearLongPress();
        chartRef.current?.clearCrosshairPosition();
        setFingerHud(null);
        onHoverRef.current?.(null);
      }}
    >
      <div ref={hostRef} className="h-full w-full" />
      {fingerHud && (
        <div
          className="pointer-events-none absolute right-1 z-20 -translate-y-1/2 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-black shadow"
          style={{ top: fingerHud.y }}
        >
          {fingerHud.price.toFixed(2)}
        </div>
      )}
    </div>
  );
}
