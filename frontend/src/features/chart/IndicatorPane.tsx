import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type HistogramData,
  type LineData,
  type LogicalRange,
  type Time,
} from 'lightweight-charts';
import { ResizeHandle } from '../../components/ResizeHandle';
import type { Bar } from '../../types/api';
import {
  adx,
  atr,
  cmf,
  cci,
  macd,
  mfi,
  obv,
  roc,
  rsi,
  stochastic,
  williamsR,
} from '../../utils/indicators';
import {
  MAIN_INDICATORS,
  MA_PERIOD_COLORS,
  SUB_INDICATORS,
  DEFAULT_SUB_PANE_HEIGHT,
  MIN_SUB_PANE_HEIGHT,
  clampSubPaneHeight,
  formatMaLabel,
  loadSubPaneHeights,
  normalizeMaPeriods,
  saveSubPaneHeights,
  type MainIndicatorId,
  type SubIndicatorId,
} from './indicatorConfig';

const TOOLBAR_H = 72;
const LABEL_H = 20;
const HANDLE_H = 8;

function toTime(iso: string): Time {
  return Math.floor(new Date(iso).getTime() / 1000) as Time;
}

/** Keep the same time grid as the main chart so logical-range sync lines up. */
function alignLine(bars: Bar[], values: readonly number[]): LineData[] {
  const offset = bars.length - values.length;
  const out: LineData[] = [];
  for (let i = 0; i < bars.length; i++) {
    const t = toTime(bars[i]!.timestamp);
    const local = i - offset;
    if (local < 0 || local >= values.length) {
      out.push({ time: t } as LineData);
      continue;
    }
    const v = values[local];
    if (v == null || Number.isNaN(v)) {
      out.push({ time: t } as LineData);
    } else {
      out.push({ time: t, value: v });
    }
  }
  return out;
}

function alignHistogram(
  bars: Bar[],
  values: readonly number[],
  colorAt: (v: number) => string,
): HistogramData[] {
  const offset = bars.length - values.length;
  const out: HistogramData[] = [];
  for (let i = 0; i < bars.length; i++) {
    const t = toTime(bars[i]!.timestamp);
    const local = i - offset;
    if (local < 0 || local >= values.length) {
      out.push({ time: t } as HistogramData);
      continue;
    }
    const v = values[local];
    if (v == null || Number.isNaN(v)) {
      out.push({ time: t } as HistogramData);
    } else {
      out.push({ time: t, value: v, color: colorAt(v) });
    }
  }
  return out;
}

const CHART_OPTS = {
  layout: {
    background: { type: ColorType.Solid, color: '#161a22' } as const,
    textColor: '#8b95a8',
    fontSize: 10,
  },
  grid: { vertLines: { color: '#1e232d' }, horzLines: { color: '#1e232d' } },
  rightPriceScale: {
    borderColor: '#252a35',
    scaleMargins: { top: 0.1, bottom: 0.12 },
    entireTextOnly: false,
  },
  timeScale: {
    borderColor: '#252a35',
    visible: false,
    // Match the main K-line chart so the right edge lines up
    rightOffset: 4,
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: {
      visible: true,
      labelVisible: false,
      color: 'rgba(154, 163, 181, 0.55)',
      width: 1 as const,
      style: 2 as const,
    },
    horzLine: {
      visible: true,
      labelVisible: true,
      color: 'rgba(154, 163, 181, 0.45)',
      width: 1 as const,
      style: 2 as const,
    },
  },
  // Left-drag enabled; time axis is re-locked to the main chart so Y can move.
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: false,
    vertTouchDrag: true,
  },
  handleScale: {
    axisPressedMouseMove: { time: false, price: true },
    axisDoubleClickReset: { time: false, price: true },
    mouseWheel: true,
    pinch: true,
  },
};

interface Props {
  bars: Bar[];
  /** Logical range from the main K-line chart — keeps panes locked together. */
  visibleRange: LogicalRange | null;
  /** Unix seconds of the main-chart crosshair (null when cleared). */
  crosshairTime?: number | null;
  enabledMain: MainIndicatorId[];
  enabledSub: SubIndicatorId[];
  maPeriods: number[];
  onMaPeriodsChange: (periods: number[]) => void;
  onToggleMain: (id: MainIndicatorId) => void;
  onToggleSub: (id: SubIndicatorId) => void;
  /** Total height of the indicator block (owned by the workbench layout). */
  height: number;
  /** Grow/shrink the indicator block (e.g. when dragging an individual pane). */
  onRequestHeightDelta?: (delta: number) => void;
}

export function IndicatorPane({
  bars,
  visibleRange,
  crosshairTime = null,
  enabledMain,
  enabledSub,
  maPeriods,
  onMaPeriodsChange,
  onToggleMain,
  onToggleSub,
  height,
  onRequestHeightDelta,
}: Props) {
  const [maDraft, setMaDraft] = useState(maPeriods.join(','));
  useEffect(() => {
    setMaDraft(maPeriods.join(','));
  }, [maPeriods]);
  const closes = useMemo(() => bars.map((b) => b.close), [bars]);
  const highs = useMemo(() => bars.map((b) => b.high), [bars]);
  const lows = useMemo(() => bars.map((b) => b.low), [bars]);
  const volumes = useMemo(() => bars.map((b) => b.volume), [bars]);

  const macdData = useMemo(() => macd(closes), [closes]);
  const rsiData = useMemo(() => rsi(closes, 14), [closes]);
  const stochData = useMemo(() => stochastic(highs, lows, closes), [highs, lows, closes]);
  const cciData = useMemo(() => cci(highs, lows, closes), [highs, lows, closes]);
  const willrData = useMemo(() => williamsR(highs, lows, closes), [highs, lows, closes]);
  const atrData = useMemo(() => atr(highs, lows, closes), [highs, lows, closes]);
  const obvData = useMemo(() => obv(closes, volumes), [closes, volumes]);
  const adxData = useMemo(() => adx(highs, lows, closes), [highs, lows, closes]);
  const mfiData = useMemo(() => mfi(highs, lows, closes, volumes), [highs, lows, closes, volumes]);
  const cmfData = useMemo(() => cmf(highs, lows, closes, volumes), [highs, lows, closes, volumes]);
  const rocData = useMemo(() => roc(closes), [closes]);

  const ordered = SUB_INDICATORS.filter((c) => enabledSub.includes(c.id));

  const [paneHeights, setPaneHeights] = useState(() => loadSubPaneHeights());

  const weightOf = useCallback(
    (id: SubIndicatorId) => clampSubPaneHeight(paneHeights[id] ?? DEFAULT_SUB_PANE_HEIGHT),
    [paneHeights],
  );

  const fittedHeights = useMemo(() => {
    const n = ordered.length;
    if (n === 0) return [] as number[];
    const chrome = TOOLBAR_H + n * (LABEL_H + HANDLE_H);
    const available = Math.max(n * MIN_SUB_PANE_HEIGHT, height - chrome);
    const weights = ordered.map((c) => weightOf(c.id));
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;
    const raw = weights.map((w) => Math.max(MIN_SUB_PANE_HEIGHT, Math.round((available * w) / sumW)));
    const used = raw.reduce((a, b) => a + b, 0);
    const drift = available - used;
    if (raw.length > 0) {
      raw[raw.length - 1] = Math.max(MIN_SUB_PANE_HEIGHT, raw[raw.length - 1]! + drift);
    }
    return raw;
  }, [ordered, height, weightOf]);

  const setPaneHeight = useCallback((id: SubIndicatorId, value: number) => {
    setPaneHeights((prev) => {
      const next = { ...prev, [id]: clampSubPaneHeight(value) };
      saveSubPaneHeights(next);
      return next;
    });
  }, []);

  const nudgePane = useCallback(
    (id: SubIndicatorId, delta: number) => {
      setPaneHeights((prev) => {
        const cur = prev[id] ?? DEFAULT_SUB_PANE_HEIGHT;
        const next = { ...prev, [id]: clampSubPaneHeight(cur + delta) };
        saveSubPaneHeights(next);
        return next;
      });
      onRequestHeightDelta?.(delta);
    },
    [onRequestHeightDelta],
  );

  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-2 py-1.5" style={{ height: TOOLBAR_H }}>
        <div className="mb-1 flex items-center gap-2 overflow-x-auto">
          <span className="w-12 shrink-0 text-[10px] font-medium text-muted">主图</span>
          {MAIN_INDICATORS.map((item) => (
            <IndicatorChip
              key={item.id}
              active={enabledMain.includes(item.id)}
              label={item.id === 'ma' ? formatMaLabel(maPeriods) : item.label}
              onClick={() => onToggleMain(item.id)}
            />
          ))}
          {enabledMain.includes('ma') && (
            <form
              className="ml-1 flex shrink-0 items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = normalizeMaPeriods(
                  maDraft
                    .split(/[,/\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map(Number),
                );
                onMaPeriodsChange(parsed);
                setMaDraft(parsed.join(','));
              }}
            >
              <span className="text-[10px] text-muted">周期</span>
              <input
                value={maDraft}
                onChange={(e) => setMaDraft(e.target.value)}
                onBlur={() => {
                  const parsed = normalizeMaPeriods(
                    maDraft
                      .split(/[,/\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map(Number),
                  );
                  onMaPeriodsChange(parsed);
                  setMaDraft(parsed.join(','));
                }}
                placeholder="5,10,20"
                title="自定义 MA 周期，逗号分隔，最多 5 条"
                className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-accent"
              />
              <div className="flex items-center gap-0.5">
                {maPeriods.map((p, i) => (
                  <span
                    key={`${p}-${i}`}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: MA_PERIOD_COLORS[i] ?? '#94a3b8' }}
                    title={`MA${p}`}
                  />
                ))}
              </div>
            </form>
          )}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="w-12 shrink-0 text-[10px] font-medium text-muted">副图</span>
          {SUB_INDICATORS.map((item) => (
            <IndicatorChip
              key={item.id}
              active={enabledSub.includes(item.id)}
              label={item.label}
              onClick={() => onToggleSub(item.id)}
            />
          ))}
        </div>
      </div>

      {ordered.length === 0 && (
        <div className="px-3 py-3 text-xs text-muted">点击上方“副图”指标即可显示。</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {ordered.map((c, idx) => {
          const h = fittedHeights[idx] ?? DEFAULT_SUB_PANE_HEIGHT;
          return (
            <div key={c.id} className="flex shrink-0 flex-col">
              <IndicatorSlot
                id={c.id}
                label={c.label}
                bars={bars}
                height={h}
                visibleRange={visibleRange}
                crosshairTime={crosshairTime}
                macdData={macdData}
                rsiData={rsiData}
                stochData={stochData}
                cciData={cciData}
                willrData={willrData}
                atrData={atrData}
                obvData={obvData}
                adxData={adxData}
                mfiData={mfiData}
                cmfData={cmfData}
                rocData={rocData}
              />
              <ResizeHandle
                axis="y"
                title={`拖拽调整 ${c.label} 高度 · 双击还原`}
                onDrag={(d) => nudgePane(c.id, d)}
                onReset={() => setPaneHeight(c.id, DEFAULT_SUB_PANE_HEIGHT)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IndicatorChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded border px-2 py-0.5 text-[10px] transition-colors ${
        active
          ? 'border-primary/60 bg-primary/15 text-primary'
          : 'border-border text-muted hover:bg-surface-hover hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

interface SlotProps {
  id: SubIndicatorId;
  label: string;
  bars: Bar[];
  height: number;
  visibleRange: LogicalRange | null;
  /** Unix seconds — sync vertical crosshair with the main chart. */
  crosshairTime: number | null;
  macdData: ReturnType<typeof macd>;
  rsiData: number[];
  stochData: ReturnType<typeof stochastic>;
  cciData: number[];
  willrData: number[];
  atrData: number[];
  obvData: number[];
  adxData: number[];
  mfiData: number[];
  cmfData: number[];
  rocData: number[];
}

function IndicatorSlot({
  id,
  label,
  bars,
  height,
  visibleRange,
  crosshairTime,
  macdData,
  rsiData,
  stochData,
  cciData,
  willrData,
  atrData,
  obvData,
  adxData,
  mfiData,
  cmfData,
  rocData,
}: SlotProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const primarySeriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | null>(null);
  const valueByTimeRef = useRef<Map<number, number>>(new Map());
  const syncingRef = useRef(false);
  const visibleRangeRef = useRef(visibleRange);
  visibleRangeRef.current = visibleRange;

  useEffect(() => {
    if (!hostRef.current || bars.length === 0) return;

    const chart = createChart(hostRef.current, { ...CHART_OPTS, height });
    chartRef.current = chart;
    valueByTimeRef.current = new Map();
    primarySeriesRef.current = null;

    const rememberValues = (rows: LineData[] | HistogramData[]) => {
      const map = valueByTimeRef.current;
      for (const row of rows) {
        const t = typeof row.time === 'number' ? row.time : null;
        if (t == null) continue;
        if ('value' in row && typeof row.value === 'number' && Number.isFinite(row.value)) {
          map.set(t, row.value);
        }
      }
    };

    // Invisible whitespace series spanning every bar — guarantees the time scale has
    // the same logical indices as the main K-line chart (MACD/RSI alone start later
    // because of warm-up, which used to leave a blank gap on the right).
    const base = chart.addLineSeries({
      color: 'transparent',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    base.setData(bars.map((b) => ({ time: toTime(b.timestamp) }) as LineData));
    base.applyOptions({ visible: false });
    primarySeriesRef.current = base;

    if (id === 'macd') {
      const hist = chart.addHistogramSeries({
        priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      });
      const macdLine = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1 });
      const signal = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1 });
      const histData = alignHistogram(
        bars,
        macdData.map((r) => r.histogram),
        (v) => (v >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'),
      );
      const macdLineData = alignLine(bars, macdData.map((r) => r.macd));
      const signalData = alignLine(bars, macdData.map((r) => r.signal));
      hist.setData(histData);
      macdLine.setData(macdLineData);
      signal.setData(signalData);
      rememberValues(macdLineData);
      primarySeriesRef.current = macdLine;
    } else if (id === 'rsi') {
      const line = chart.addLineSeries({ color: '#a78bfa', lineWidth: 1 });
      const data = alignLine(bars, rsiData);
      line.setData(data);
      rememberValues(data);
      primarySeriesRef.current = line;
      line.createPriceLine({ price: 70, color: '#ef444480', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      line.createPriceLine({ price: 30, color: '#22c55e80', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    } else if (id === 'stoch') {
      const kLine = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1 });
      const dLine = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1 });
      const kData = alignLine(bars, stochData.map((r) => r.k));
      const dData = alignLine(bars, stochData.map((r) => r.d));
      kLine.setData(kData);
      dLine.setData(dData);
      rememberValues(kData);
      primarySeriesRef.current = kLine;
      kLine.createPriceLine({ price: 80, color: '#ef444480', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      kLine.createPriceLine({ price: 20, color: '#22c55e80', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    } else if (id === 'cci') {
      const line = chart.addLineSeries({ color: '#38bdf8', lineWidth: 1 });
      const data = alignLine(bars, cciData);
      line.setData(data);
      rememberValues(data);
      primarySeriesRef.current = line;
      line.createPriceLine({ price: 100, color: '#ef444480', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      line.createPriceLine({ price: -100, color: '#22c55e80', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    } else if (id === 'willr') {
      const line = chart.addLineSeries({ color: '#f472b6', lineWidth: 1 });
      const data = alignLine(bars, willrData);
      line.setData(data);
      rememberValues(data);
      primarySeriesRef.current = line;
      line.createPriceLine({ price: -20, color: '#ef444480', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      line.createPriceLine({ price: -80, color: '#22c55e80', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    } else if (id === 'atr') {
      const line = chart.addLineSeries({ color: '#94a3b8', lineWidth: 1 });
      const data = alignLine(bars, atrData);
      line.setData(data);
      rememberValues(data);
      primarySeriesRef.current = line;
    } else if (id === 'obv') {
      const line = chart.addLineSeries({ color: '#2dd4bf', lineWidth: 1 });
      const data = alignLine(bars, obvData);
      line.setData(data);
      rememberValues(data);
      primarySeriesRef.current = line;
    } else {
      const values =
        id === 'adx' ? adxData : id === 'mfi' ? mfiData : id === 'cmf' ? cmfData : rocData;
      const color =
        id === 'adx' ? '#fbbf24' : id === 'mfi' ? '#34d399' : id === 'cmf' ? '#22d3ee' : '#fb7185';
      const line = chart.addLineSeries({ color, lineWidth: 1 });
      const data = alignLine(bars, values);
      line.setData(data);
      rememberValues(data);
      primarySeriesRef.current = line;
      if (id === 'adx') {
        line.createPriceLine({ price: 25, color: '#fbbf2480', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      } else if (id === 'mfi') {
        line.createPriceLine({ price: 80, color: '#ef444480', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        line.createPriceLine({ price: 20, color: '#22c55e80', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      } else {
        line.createPriceLine({ price: 0, color: '#64748b80', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      }
    }

    if (visibleRange) {
      syncingRef.current = true;
      try {
        chart.timeScale().setVisibleLogicalRange(visibleRange);
      } catch {
        chart.timeScale().fitContent();
      }
      syncingRef.current = false;
    } else {
      chart.timeScale().fitContent();
    }

    // Re-lock time to the main chart after left-drag / wheel so only the Y scale changes.
    const unlockTime = () => {
      const range = visibleRangeRef.current;
      if (!range || syncingRef.current) return;
      syncingRef.current = true;
      try {
        chart.timeScale().setVisibleLogicalRange(range);
      } catch {
        /* ignore transient range errors */
      } finally {
        syncingRef.current = false;
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(unlockTime);

    const ro = new ResizeObserver(() => {
      if (!hostRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: hostRef.current.clientWidth,
        height: hostRef.current.clientHeight || height,
      });
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(unlockTime);
      chart.remove();
      chartRef.current = null;
    };
    // Recreate only when the bar window identity changes — not on every parent
    // render that happens to pass a new array reference with the same candles.
    // Height is applied live below — recreating on every drag made panes flicker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    id,
    bars[0]?.symbol,
    bars[0]?.timestamp,
    bars[bars.length - 1]?.timestamp,
    bars[bars.length - 1]?.close,
    bars[bars.length - 1]?.volume,
    bars.length,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart) return;
    chart.applyOptions({ height: host?.clientHeight || height });
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !visibleRange || syncingRef.current) return;
    try {
      chart.timeScale().setVisibleLogicalRange(visibleRange);
    } catch {
      /* range may be briefly invalid while bars swap */
    }
  }, [visibleRange]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = primarySeriesRef.current;
    if (!chart || !series) return;
    if (crosshairTime == null) {
      chart.clearCrosshairPosition();
      return;
    }
    const mapped = valueByTimeRef.current.get(crosshairTime);
    let price = mapped;
    if (price == null || !Number.isFinite(price)) {
      const vr = chart.priceScale('right').getVisibleRange();
      price = vr ? (vr.from + vr.to) / 2 : 0;
    }
    try {
      chart.setCrosshairPosition(price, crosshairTime as Time, series);
    } catch {
      chart.clearCrosshairPosition();
    }
  }, [crosshairTime, visibleRange, bars.length]);

  return (
    <div className="relative flex shrink-0 flex-col" style={{ height: LABEL_H + height }}>
      <div
        className="flex shrink-0 items-center px-3 text-[11px] text-muted"
        style={{ height: LABEL_H }}
      >
        {label}
        <span className="ml-2 text-[9px] text-muted/70">按住拖拽调纵轴 · 右侧也可拖</span>
      </div>
      <div
        ref={hostRef}
        className="indicator-chart-host relative w-full overflow-hidden"
        style={{ height }}
      />
    </div>
  );
}
