import { ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchQuote } from '../../api/endpoints';
import { useWorkbenchStore } from '../../stores/workbenchStore';

export function priceTick(price: number): number {
  if (price >= 500) return 0.25;
  if (price >= 100) return 0.05;
  if (price >= 20) return 0.01;
  return 0.01;
}

function formatPrice(n: number): string {
  const t = priceTick(n);
  const decimals = t < 0.01 ? 4 : t < 0.1 ? 2 : t <= 0.05 ? 2 : 2;
  return n.toFixed(Math.max(2, decimals));
}

interface PriceInputProps {
  symbol: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}

/** Price field with 当下价格 / 标记价格 shortcuts and ± tick nudge. */
export function PriceInput({ symbol, label, value, onChange, placeholder, hint }: PriceInputProps) {
  const markedPrice = useWorkbenchStore((s) => s.markedPrice);
  const quoteQuery = useQuery({
    queryKey: ['quote', symbol],
    queryFn: () => fetchQuote(symbol),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
  const live = quoteQuery.data?.quote.price;

  const apply = (n: number) => onChange(formatPrice(n));

  const nudge = (dir: 1 | -1) => {
    const base = value ? Number(value) : live ?? markedPrice ?? 0;
    if (!Number.isFinite(base) || base <= 0) {
      if (live != null) apply(live);
      return;
    }
    const tick = priceTick(base);
    const next = Math.max(tick, Math.round((base + dir * tick) / tick) * tick);
    apply(next);
  };

  return (
    <div className="block">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm text-muted">{label}</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={live == null}
            onClick={() => live != null && apply(live)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-gray-200 hover:border-primary/40 hover:text-primary disabled:opacity-40"
            title={live != null ? `填入 ${formatPrice(live)}` : '暂无行情'}
          >
            当下价格
          </button>
          <button
            type="button"
            disabled={markedPrice == null}
            onClick={() => markedPrice != null && apply(markedPrice)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-gray-200 hover:border-amber-400/50 hover:text-amber-300 disabled:opacity-40"
            title={markedPrice != null ? `填入标记 ${formatPrice(markedPrice)}` : '请先在 K 线上标记价格'}
          >
            标记价格
          </button>
        </div>
      </div>
      <div className="flex items-stretch gap-1.5">
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input no-spinner tabular min-w-0 flex-1 py-2.5 text-base"
          placeholder={placeholder ?? '0.00'}
        />
        <div className="flex w-9 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-raised">
          <button
            type="button"
            onClick={() => nudge(1)}
            className="flex flex-1 items-center justify-center text-muted hover:bg-surface-hover hover:text-gray-100"
            aria-label="提高价格"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <div className="h-px bg-border" />
          <button
            type="button"
            onClick={() => nudge(-1)}
            className="flex flex-1 items-center justify-center text-muted hover:bg-surface-hover hover:text-gray-100"
            aria-label="降低价格"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}
