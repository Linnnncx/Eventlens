import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchOrderBook } from '../../api/endpoints';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { formatCurrency } from '../../utils/format';

interface OrderBookProps {
  symbol: string;
  levels?: number;
}

export function OrderBook({ symbol, levels = 14 }: OrderBookProps) {
  const setBookPrice = useWorkbenchStore((s) => s.setBookPrice);
  const setTradeSide = useWorkbenchStore((s) => s.setTradeSide);

  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ['orderbook', symbol, levels],
    queryFn: ({ signal }) => fetchOrderBook(symbol, levels, signal),
    refetchInterval: 8_000,
    staleTime: 1_000,
  });

  const book = data?.book;
  const maxSize = useMemo(() => {
    if (!book) return 1;
    return Math.max(1, ...book.bids.map((l) => l.size), ...book.asks.map((l) => l.size));
  }, [book]);

  const asksDesc = useMemo(() => (book ? [...book.asks].reverse() : []), [book]);
  const askCumulative = useMemo(() => {
    let total = 0;
    const values = new Array(asksDesc.length);
    for (let i = asksDesc.length - 1; i >= 0; i -= 1) {
      total += asksDesc[i]!.size;
      values[i] = total;
    }
    return values as number[];
  }, [asksDesc]);
  const bidCumulative = useMemo(() => {
    let total = 0;
    return (book?.bids ?? []).map((level) => (total += level.size));
  }, [book]);

  const onPick = (price: number, side: 'buy' | 'sell') => {
    setBookPrice(price);
    setTradeSide(side);
  };

  if (isLoading && !book) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">加载订单簿…</div>
    );
  }

  if (isError || !book) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-down">
        {(error as Error)?.message || '订单簿不可用'}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-gray-100">订单簿 · {book.symbol}</h2>
          <p className="mt-0.5 text-[11px] text-muted">
            {book.synthetic ? '合成深度 · ' : ''}
            {book.provider}
            {dataUpdatedAt ? ` · ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <div className="text-right text-[11px] text-muted">
          <div>
            Mid <span className="tabular text-sm text-gray-100">{formatCurrency(book.mid)}</span>
          </div>
          <div>
            Spread <span className="tabular text-gray-200">{book.spread.toFixed(4)}</span>
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-[1fr_1fr_1fr] gap-1 border-b border-border px-4 py-1.5 text-[11px] uppercase tracking-wide text-muted">
        <span>价格</span>
        <span className="text-right">数量</span>
        <span className="text-right">累计</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-1.5 py-1">
          {asksDesc.map((lvl, i) => {
            const cum = askCumulative[i] ?? lvl.size;
            return (
              <BookRow
                key={`a-${lvl.price}`}
                price={lvl.price}
                size={lvl.size}
                cum={cum}
                maxSize={maxSize}
                tone="ask"
                onClick={() => onPick(lvl.price, 'sell')}
              />
            );
          })}
        </div>

        <div className="mx-2.5 my-1.5 flex items-center justify-between rounded-md border border-border bg-surface-raised px-3 py-2">
          <span className="text-[11px] text-muted">最新</span>
          <span className="tabular text-base font-semibold text-gray-100">{formatCurrency(book.mid)}</span>
          <button
            type="button"
            className="text-[11px] text-primary hover:underline"
            onClick={() => onPick(book.mid, 'buy')}
          >
            填入
          </button>
        </div>

        <div className="px-1.5 py-1">
          {book.bids.map((lvl, i) => {
            const cum = bidCumulative[i] ?? lvl.size;
            return (
              <BookRow
                key={`b-${lvl.price}`}
                price={lvl.price}
                size={lvl.size}
                cum={cum}
                maxSize={maxSize}
                tone="bid"
                onClick={() => onPick(lvl.price, 'buy')}
              />
            );
          })}
        </div>
      </div>

      <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted">
        点击档位填入快捷下单限价 · 演示深度非真实交易所盘口
      </p>
    </div>
  );
}

function BookRow({
  price,
  size,
  cum,
  maxSize,
  tone,
  onClick,
}: {
  price: number;
  size: number;
  cum: number;
  maxSize: number;
  tone: 'bid' | 'ask';
  onClick: () => void;
}) {
  const pct = Math.min(100, (size / maxSize) * 100);
  const bar = tone === 'ask' ? 'bg-down/15' : 'bg-up/15';
  const priceCls = tone === 'ask' ? 'text-down' : 'text-up';

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative grid w-full grid-cols-[1fr_1fr_1fr] gap-1 rounded px-2.5 py-1 text-left text-[13px] hover:bg-surface-hover"
    >
      <span
        className={`pointer-events-none absolute inset-y-0 right-0 ${bar}`}
        style={{ width: `${pct}%` }}
      />
      <span className={`relative tabular font-medium ${priceCls}`}>{price.toFixed(2)}</span>
      <span className="relative tabular text-right text-gray-300">{formatSize(size)}</span>
      <span className="relative tabular text-right text-muted">{formatSize(cum)}</span>
    </button>
  );
}

function formatSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}
