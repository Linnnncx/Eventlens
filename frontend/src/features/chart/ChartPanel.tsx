import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  type MouseEventParams,
  type LogicalRange,
} from 'lightweight-charts';
import type { Bar, NewsItem, Position, Timeframe } from '../../types/api';
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
import type { MainIndicatorId } from './indicatorConfig';

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
  enabledMain?: MainIndicatorId[];
  newsLoading?: boolean;
  newsCached?: boolean;
  newsSource?: string;
  newsError?: boolean;
  height?: number;
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

const STEM_PX = 42;
/** Fallback bubble row used when the price scale cannot resolve a coordinate yet. */
const RIBBON_Y = 30;

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
  enabledMain = ['ma'],
  newsLoading = false,
  newsCached,
  newsSource,
  newsError = false,
  height = 420,
}: ChartPanelProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ma50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const costLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const overlayRefs = useRef<Record<string, ISeriesApi<'Line'>>>({});
  const fittedKeyRef = useRef<string>('');
  const newsByBarRef = useRef<Map<number, NewsItem[]>>(new Map());
  const onBarHoverRef = useRef(onBarHover);
  const onRangeRef = useRef(onVisibleRangeChange);
  const lastHoverSecRef = useRef<number | null>(null);
  const repositionRef = useRef<() => boolean>(() => false);
  const rafRef = useRef<number | null>(null);
  const anchorsRef = useRef<NewsAnchor[]>([]);
  const barsRef = useRef<Bar[]>(bars);

  const [anchorLayout, setAnchorLayout] = useState<AnchorLayout[]>([]);
  const [crosshairBar, setCrosshairBar] = useState<Bar | null>(null);

  const closes = useMemo(() => bars.map((b) => b.close), [bars]);
  const ma20 = useMemo(() => sma(closes, 20), [closes]);
  const ma50 = useMemo(() => sma(closes, 50), [closes]);
  const highs = useMemo(() => bars.map((b) => b.high), [bars]);
  const lows = useMemo(() => bars.map((b) => b.low), [bars]);
  const volumes = useMemo(() => bars.map((b) => b.volume), [bars]);
  const overlayData = useMemo(
    () => ({
      ema12: ema(closes, 12),
      ema26: ema(closes, 26),
      boll: bollinger(closes, 20, 2),
      vwap: vwap(highs, lows, closes, volumes),
      sar: parabolicSar(highs, lows),
      support: supportResistance(highs, lows, 20),
      donchian: donchian(highs, lows, 20),
    }),
    [closes, highs, lows, volumes],
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
        return;
      }
      const sec =
        typeof param.time === 'number'
          ? param.time
          : Math.floor(new Date(String(param.time)).getTime() / 1000);
      setCrosshairBar(barsRef.current.find((bar) => toSec(bar.timestamp) === sec) ?? null);
      emitHover(sec);
    },
    [emitHover],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#161a22' },
        textColor: '#8b95a8',
        fontFamily: 'Inter, system-ui, sans-serif',
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
      scaleMargins: { top: 0.22, bottom: 0.22 },
    });

    const ma20Line = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 1,
      ...LINE_BASE,
    });
    const ma50Line = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 1,
      ...LINE_BASE,
    });
    const costLine = chart.addLineSeries({
      color: '#a78bfa',
      lineWidth: 1,
      lineStyle: 0,
      ...LINE_BASE,
      priceLineVisible: true,
      lastValueVisible: true,
    });
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
    ma20Ref.current = ma20Line;
    ma50Ref.current = ma50Line;
    costLineRef.current = costLine;
    overlayRefs.current = overlays;

    chart.subscribeCrosshairMove(handleCrosshair);
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

    if (ma20Ref.current && ma20.length > 0 && enabledMain.includes('ma')) {
      const offset = bars.length - ma20.length;
      const lineData: LineData[] = ma20.map((v, i) => ({
        time: toSec(bars[offset + i]?.timestamp ?? bars[bars.length - 1]!.timestamp) as Time,
        value: v,
      }));
      ma20Ref.current.setData(lineData);
    } else {
      ma20Ref.current?.setData([]);
    }

    if (ma50Ref.current && ma50.length > 0 && enabledMain.includes('ma')) {
      const offset = bars.length - ma50.length;
      const lineData: LineData[] = ma50.map((v, i) => ({
        time: toSec(bars[offset + i]?.timestamp ?? bars[bars.length - 1]!.timestamp) as Time,
        value: v,
      }));
      ma50Ref.current.setData(lineData);
    } else {
      ma50Ref.current?.setData([]);
    }

    if (costLineRef.current && position && bars.length > 0) {
      const cost = position.avgCost;
      costLineRef.current.setData(
        bars.map((b) => ({
          time: toSec(b.timestamp) as Time,
          value: cost,
        })),
      );
    } else if (costLineRef.current) {
      costLineRef.current.setData([]);
    }

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

    const fitKey = `${bars[0]?.symbol ?? ''}:${timeframe}:${bars.length}:${bars[0]?.timestamp ?? ''}`;
    if (fitKey !== fittedKeyRef.current && bars.length > 0) {
      fittedKeyRef.current = fitKey;
      chartRef.current?.timeScale().fitContent();
      onRangeRef.current?.(chartRef.current?.timeScale().getVisibleLogicalRange() ?? null);
    }

    applyNewsMarkers();
  }, [
    bars,
    ma20,
    ma50,
    position,
    timeframe,
    applyNewsMarkers,
    enabledMain,
    overlayData,
  ]);

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
      push('MA20', valueAt(ma20, hudIndex), '#3b82f6');
      push('MA50', valueAt(ma50, hudIndex), '#f59e0b');
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
  }, [hudBar, hudIndex, bars.length, enabledMain, ma20, ma50, overlayData, position]);

  return (
    <div className="card overflow-hidden">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1 text-[11px] text-muted">
        <span>K线 · {timeframe}</span>
        <span className="flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-up" /> 利好
          <i className="ml-1 h-2 w-2 rounded-full bg-down" /> 利空
          <i className="ml-1 h-2 w-2 rounded-full bg-news" /> 中性
        </span>
        <span>
          {anchors.length} 个锚点 / {newsItems.length} 条新闻
          {newsCached && (
            <span className="ml-1 text-up" title="来自本地 SQLite，不重复抓取上游">
              · 本地库
            </span>
          )}
          {!newsCached && newsSource && !newsLoading && (
            <span className="ml-1 text-muted">· {newsSource}</span>
          )}
          {newsLoading && <span className="ml-1 text-primary">· 同步中…</span>}
          {newsError && <span className="ml-1 text-down">· 新闻接口失败</span>}
          {lockedBarTime != null && (
            <span className="ml-1 text-news">· 已锁定该时段（移出图表后再回来解锁）</span>
          )}
          {!newsLoading && !newsError && anchors.length === 0 && newsItems.length > 0 && (
            <span className="ml-1 text-down">· 锚点未对齐</span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {[50, 100, 200].map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => showRecentBars(count)}
              className="rounded px-1.5 py-0.5 hover:bg-surface-hover hover:text-gray-200"
            >
              {count}根
            </button>
          ))}
          <button
            type="button"
            onClick={() => showRecentBars(null)}
            className="rounded px-1.5 py-0.5 hover:bg-surface-hover hover:text-gray-200"
          >
            全部
          </button>
        </div>
      </div>
      <div
        ref={wrapRef}
        className="relative w-full"
        style={{ height }}
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

        {bars.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-card/80 text-sm text-muted">
            暂无 K 线数据，请稍后重试或切换周期
          </div>
        )}
      </div>
    </div>
  );
}
