import { useEffect, useRef } from 'react';
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { EquityHistoryPoint } from '../../api/endpoints';
import { formatPrice } from '../../utils/format';

interface MobileEquityChartProps {
  points: EquityHistoryPoint[];
  height?: number;
  high?: number | null;
  low?: number | null;
}

export function MobileEquityChart({
  points,
  height = 180,
  high,
  low,
}: MobileEquityChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6b7280',
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: {
        visible: false,
        borderVisible: false,
      },
      timeScale: {
        visible: false,
        borderVisible: false,
      },
      crosshair: {
        vertLine: {
          color: 'rgba(52, 211, 153, 0.35)',
          labelVisible: false,
        },
        horzLine: {
          color: 'rgba(52, 211, 153, 0.35)',
          labelBackgroundColor: '#10b981',
        },
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addAreaSeries({
      lineColor: '#34d399',
      topColor: 'rgba(52, 211, 153, 0.35)',
      bottomColor: 'rgba(52, 211, 153, 0.02)',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: '#34d399',
      crosshairMarkerBackgroundColor: '#064e3b',
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (hostRef.current) chart.applyOptions({ width: hostRef.current.clientWidth });
    });
    ro.observe(host);
    chart.applyOptions({ width: host.clientWidth });

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const data = points
      .map((p) => {
        const sec = Math.floor(new Date(p.t).getTime() / 1000);
        if (!Number.isFinite(sec) || !Number.isFinite(p.equity)) return null;
        return { time: sec as UTCTimestamp, value: p.equity };
      })
      .filter(Boolean) as { time: UTCTimestamp; value: number }[];

    // lightweight-charts requires unique ascending times
    const dedup: typeof data = [];
    for (const row of data) {
      if (dedup.length && dedup[dedup.length - 1]!.time >= row.time) {
        dedup[dedup.length - 1] = row;
      } else {
        dedup.push(row);
      }
    }

    series.setData(dedup.length ? dedup : [{ time: Math.floor(Date.now() / 1000) as UTCTimestamp, value: 0 }]);
    chart.timeScale().fitContent();
  }, [points]);

  return (
    <div className="relative">
      {high != null && (
        <div className="pointer-events-none absolute right-1 top-1 z-10 text-[11px] tabular text-gray-200">
          ${formatPrice(high)}
        </div>
      )}
      {low != null && (
        <div className="pointer-events-none absolute bottom-1 right-1 z-10 text-[11px] tabular text-muted">
          ${formatPrice(low)}
        </div>
      )}
      <div ref={hostRef} className="w-full" style={{ height }} />
    </div>
  );
}
