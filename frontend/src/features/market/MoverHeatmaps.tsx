import { Link } from 'react-router-dom';
import { formatPercent } from '../../utils/format';

export interface HeatmapCell {
  symbol: string;
  name?: string;
  changePercent: number;
  price?: number;
}

interface MoverHeatmapsProps {
  gainers: HeatmapCell[];
  losers: HeatmapCell[];
}

function intensity(changePercent: number, maxAbs: number): number {
  if (maxAbs <= 0) return 0.35;
  return Math.min(0.92, 0.28 + (Math.abs(changePercent) / maxAbs) * 0.64);
}

function HeatGrid({
  title,
  items,
  tone,
}: {
  title: string;
  items: HeatmapCell[];
  tone: 'up' | 'down';
}) {
  const maxAbs = Math.max(0.5, ...items.map((i) => Math.abs(i.changePercent)));

  return (
    <div className="card overflow-hidden p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-sm font-medium tracking-wide text-muted">{title}</h3>
        <span className={`text-xs ${tone === 'up' ? 'text-up' : 'text-down'}`}>
          {tone === 'up' ? '涨幅榜' : '跌幅榜'}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">暂无数据</div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const a = intensity(item.changePercent, maxAbs);
            const bg =
              tone === 'up'
                ? `rgba(34, 197, 94, ${a})`
                : `rgba(239, 68, 68, ${a})`;
            return (
              <Link
                key={item.symbol}
                to={`/workbench/${item.symbol}`}
                className="flex min-h-[4.5rem] flex-col justify-between rounded-lg px-2.5 py-2 transition-transform hover:scale-[1.02]"
                style={{ backgroundColor: bg }}
              >
                <div>
                  <div className="text-[13px] font-semibold text-white drop-shadow-sm">
                    {item.symbol}
                  </div>
                  {item.name && (
                    <div className="truncate text-[10px] text-white/75">{item.name}</div>
                  )}
                </div>
                <div className="tabular text-[13px] font-semibold text-white">
                  {formatPercent(item.changePercent)}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MoverHeatmaps({ gainers, losers }: MoverHeatmapsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <HeatGrid title="今日热点 · 涨" items={gainers} tone="up" />
      <HeatGrid title="今日热点 · 跌" items={losers} tone="down" />
    </div>
  );
}
