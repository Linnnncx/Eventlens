import { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar } from '../../types/api';
import { SUB_INDICATORS, type SubIndicatorId } from '../../features/chart/indicatorConfig';
import {
  adx,
  atr,
  cci,
  cmf,
  macd,
  mfi,
  obv,
  roc,
  rsi,
  stochastic,
  williamsR,
} from '../../utils/indicators';

type SeriesSpec =
  | { kind: 'line'; color: string; label: string; values: number[] }
  | { kind: 'hist'; label: string; values: number[] };

interface PaneSpec {
  series: SeriesSpec[];
  guides?: number[];
}

const PANE_HEIGHT = 108;
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;

/** Pad indicator values onto the full bar timeline (same logical indices as main chart). */
function alignPoints(bars: Bar[], values: number[]) {
  const offset = bars.length - values.length;
  return bars.map((b, i) => {
    const local = i - offset;
    const t = sec(b.timestamp);
    if (local < 0 || local >= values.length) return { time: t } as { time: UTCTimestamp; value?: number };
    const v = values[local];
    if (v == null || Number.isNaN(v)) return { time: t } as { time: UTCTimestamp; value?: number };
    return { time: t, value: v };
  });
}

function buildPane(id: SubIndicatorId, bars: Bar[]): PaneSpec {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  switch (id) {
    case 'macd': {
      const points = macd(closes);
      return {
        series: [
          { kind: 'hist', label: 'HIST', values: points.map((p) => p.histogram) },
          { kind: 'line', color: '#3b82f6', label: 'DIF', values: points.map((p) => p.macd) },
          { kind: 'line', color: '#f59e0b', label: 'DEA', values: points.map((p) => p.signal) },
        ],
        guides: [0],
      };
    }
    case 'rsi':
      return {
        series: [{ kind: 'line', color: '#a78bfa', label: 'RSI 14', values: rsi(closes, 14) }],
        guides: [30, 70],
      };
    case 'stoch': {
      const points = stochastic(highs, lows, closes);
      return {
        series: [
          { kind: 'line', color: '#3b82f6', label: '%K', values: points.map((p) => p.k) },
          { kind: 'line', color: '#f59e0b', label: '%D', values: points.map((p) => p.d) },
        ],
        guides: [20, 80],
      };
    }
    case 'cci':
      return {
        series: [{ kind: 'line', color: '#22d3ee', label: 'CCI 20', values: cci(highs, lows, closes) }],
        guides: [-100, 100],
      };
    case 'willr':
      return {
        series: [{ kind: 'line', color: '#f472b6', label: '%R 14', values: williamsR(highs, lows, closes) }],
        guides: [-80, -20],
      };
    case 'atr':
      return { series: [{ kind: 'line', color: '#fb923c', label: 'ATR 14', values: atr(highs, lows, closes) }] };
    case 'obv':
      return { series: [{ kind: 'line', color: '#38bdf8', label: 'OBV', values: obv(closes, volumes) }] };
    case 'adx':
      return {
        series: [{ kind: 'line', color: '#facc15', label: 'ADX 14', values: adx(highs, lows, closes) }],
        guides: [25],
      };
    case 'mfi':
      return {
        series: [{ kind: 'line', color: '#34d399', label: 'MFI 14', values: mfi(highs, lows, closes, volumes) }],
        guides: [20, 80],
      };
    case 'cmf':
      return {
        series: [{ kind: 'line', color: '#c084fc', label: 'CMF 20', values: cmf(highs, lows, closes, volumes) }],
        guides: [0],
      };
    case 'roc':
      return {
        series: [{ kind: 'line', color: '#60a5fa', label: 'ROC 12', values: roc(closes) }],
        guides: [0],
      };
    default:
      return { series: [] };
  }
}

interface MobileIndicatorPaneProps {
  bars: Bar[];
  active: SubIndicatorId;
  enabled: SubIndicatorId[];
  onChange: (id: SubIndicatorId) => void;
  onOpenSettings: () => void;
  /** Keep time window locked to the main K-line chart. */
  visibleRange?: LogicalRange | null;
  /** Unix seconds under the main-chart crosshair. */
  crosshairTime?: number | null;
}

export function MobileIndicatorPane({
  bars,
  active,
  enabled,
  onChange,
  onOpenSettings,
  visibleRange = null,
  crosshairTime = null,
}: MobileIndicatorPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line' | 'Histogram'>[]>([]);
  const primarySeriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | null>(null);
  const valueByTimeRef = useRef<Map<number, number>>(new Map());
  const syncingRef = useRef(false);
  const visibleRangeRef = useRef(visibleRange);
  visibleRangeRef.current = visibleRange;

  const spec = useMemo(() => buildPane(active, bars), [active, bars]);
  const label = SUB_INDICATORS.find((s) => s.id === active)?.label ?? active;
  const position = enabled.indexOf(active);

  const step = (dir: number) => {
    if (enabled.length === 0) return;
    const next = (position + dir + enabled.length) % enabled.length;
    onChange(enabled[next]!);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      height: PANE_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: '#0f131a' },
        textColor: '#8b93a5',
        fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
        fontSize: 9,
      },
      grid: {
        vertLines: { color: 'rgba(30,35,45,0.5)' },
        horzLines: { color: 'rgba(30,35,45,0.5)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true,
          labelVisible: false,
          color: 'rgba(245, 158, 11, 0.7)',
          width: 1,
          style: LineStyle.Dashed,
        },
        horzLine: {
          visible: true,
          labelVisible: true,
          color: 'rgba(245, 158, 11, 0.45)',
          width: 1,
          style: LineStyle.Dashed,
        },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
        visible: false,
        rightOffset: 2,
      },
      // Follow the main chart — no independent horizontal pan.
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const unlockTime = () => {
      const range = visibleRangeRef.current;
      if (!range || syncingRef.current) return;
      syncingRef.current = true;
      try {
        chart.timeScale().setVisibleLogicalRange(range);
      } catch {
        /* ignore */
      } finally {
        syncingRef.current = false;
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(unlockTime);

    const resize = () => chart.applyOptions({ width: host.clientWidth });
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(unlockTime);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = [];
      primarySeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const series of seriesRef.current) chart.removeSeries(series);
    seriesRef.current = [];
    primarySeriesRef.current = null;
    valueByTimeRef.current = new Map();
    if (bars.length === 0) return;

    // Invisible base series so logical indices match the candle chart.
    const base = chart.addLineSeries({
      color: 'transparent',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    base.setData(bars.map((b) => ({ time: sec(b.timestamp) })) as { time: UTCTimestamp }[]);
    base.applyOptions({ visible: false });
    seriesRef.current.push(base);
    primarySeriesRef.current = base;

    let first = true;
    for (const item of spec.series) {
      const points = alignPoints(bars, item.values);
      for (const p of points) {
        if (typeof p.value === 'number' && Number.isFinite(p.value)) {
          valueByTimeRef.current.set(p.time as number, p.value);
        }
      }

      if (item.kind === 'hist') {
        const series = chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        series.setData(
          points.map((p) =>
            typeof p.value === 'number'
              ? {
                  time: p.time,
                  value: p.value,
                  color: p.value >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)',
                }
              : ({ time: p.time } as { time: UTCTimestamp }),
          ),
        );
        seriesRef.current.push(series);
        if (first) {
          primarySeriesRef.current = series;
          first = false;
        }
      } else {
        const series = chart.addLineSeries({
          color: item.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
        });
        series.setData(points as { time: UTCTimestamp; value?: number }[]);
        if (first) {
          for (const guide of spec.guides ?? []) {
            series.createPriceLine({
              price: guide,
              color: 'rgba(154,163,181,0.35)',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: false,
              title: '',
            });
          }
          primarySeriesRef.current = series;
          first = false;
        }
        seriesRef.current.push(series);
      }
    }

    const range = visibleRangeRef.current;
    if (range) {
      syncingRef.current = true;
      try {
        chart.timeScale().setVisibleLogicalRange(range);
      } catch {
        chart.timeScale().fitContent();
      } finally {
        syncingRef.current = false;
      }
    } else {
      chart.timeScale().fitContent();
    }
  }, [spec, bars]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !visibleRange || syncingRef.current) return;
    syncingRef.current = true;
    try {
      chart.timeScale().setVisibleLogicalRange(visibleRange);
    } catch {
      /* ignore */
    } finally {
      syncingRef.current = false;
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
    let price = valueByTimeRef.current.get(crosshairTime);
    if (price == null || !Number.isFinite(price)) {
      const middlePrice = series.coordinateToPrice((hostRef.current?.clientHeight ?? PANE_HEIGHT) / 2);
      price = middlePrice == null ? 0 : Number(middlePrice);
    }
    try {
      chart.setCrosshairPosition(price, crosshairTime as Time, series);
    } catch {
      chart.clearCrosshairPosition();
    }
  }, [crosshairTime, visibleRange, bars.length, active]);

  return (
    <div className="border-t border-border/60 bg-[#0f131a]">
      <div className="flex items-center gap-1 px-2 pt-1.5">
        <button
          type="button"
          onClick={() => step(-1)}
          className="m-tap flex h-7 w-7 items-center justify-center rounded-md text-muted"
          aria-label="上一个指标"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center text-[12px] font-medium text-gray-200">{label}</div>
        <button
          type="button"
          onClick={() => step(1)}
          className="m-tap flex h-7 w-7 items-center justify-center rounded-md text-muted"
          aria-label="下一个指标"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="m-tap flex h-7 w-7 items-center justify-center rounded-md text-muted"
          aria-label="指标设置"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>
      <div ref={hostRef} className="touch-pan-lock w-full" style={{ height: PANE_HEIGHT }} />
      {enabled.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pb-1.5">
          {enabled.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-label={id}
              className={`h-1.5 rounded-full transition-all ${
                id === active ? 'w-4 bg-primary' : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
