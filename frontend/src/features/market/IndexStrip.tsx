import { useQuery } from '@tanstack/react-query';
import { fetchSnapshots } from '../../api/endpoints';
import { changeColorClass, formatPercent, formatPrice } from '../../utils/format';
import { DanmakuLane } from './DanmakuLane';
import { INDEX_STRIP } from './indices';

export function IndexStrip({
  current,
  onSelect,
}: {
  current: string;
  onSelect: (symbol: string) => void;
}) {
  const symbols = INDEX_STRIP.map((i) => i.symbol);
  const { data } = useQuery({
    queryKey: ['snapshots', 'indices', symbols.join(',')],
    queryFn: () => fetchSnapshots(symbols),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const snapMap = new Map(data?.snapshots.map((s) => [s.symbol, s]) ?? []);

  return (
    <div className="flex shrink-0 items-stretch gap-2 border-b border-border/80 bg-surface-card/50 px-2 py-2 md:px-3">
      <div className="flex shrink-0 items-stretch gap-1.5">
        <div className="flex shrink-0 items-center pr-1 text-xs font-medium tracking-wide text-muted">
          指数
        </div>
        {INDEX_STRIP.map((idx) => {
          const snap = snapMap.get(idx.symbol);
          const active = current === idx.symbol;
          const pct = snap?.changePercent ?? 0;
          return (
            <button
              key={idx.symbol}
              type="button"
              onClick={() => onSelect(idx.symbol)}
              className={`flex min-w-[7.75rem] shrink-0 flex-col rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                active
                  ? 'border-primary/50 bg-primary/15 shadow-sm'
                  : 'border-border/60 bg-surface/80 hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-xs font-semibold ${active ? 'text-primary' : 'text-gray-200'}`}>
                  {idx.short}
                </span>
                <span className="text-[10px] text-muted">{idx.symbol}</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2 tabular">
                <span className="text-sm font-medium">
                  {snap ? formatPrice(snap.price, 2) : '—'}
                </span>
                <span className={`text-xs ${changeColorClass(pct)}`}>
                  {snap ? formatPercent(pct) : '—'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <DanmakuLane symbol={current} />
    </div>
  );
}
