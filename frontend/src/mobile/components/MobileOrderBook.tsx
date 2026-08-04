import { useQuery } from '@tanstack/react-query';
import { fetchOrderBook } from '../../api/endpoints';
import { formatCompact, formatPrice } from '../../utils/format';
import { EmptyState, Skeleton } from './ui';

const LEVELS = 5;

export function MobileOrderBook({
  symbol,
  onPickPrice,
}: {
  symbol: string;
  onPickPrice?: (price: number) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['orderbook', symbol, LEVELS],
    queryFn: ({ signal }) => fetchOrderBook(symbol, LEVELS, signal),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-1.5 px-3 py-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    );
  }

  const book = data?.book;
  if (!book) return <EmptyState text="暂无盘口数据" />;

  const asks = book.asks.slice(0, LEVELS).reverse();
  const bids = book.bids.slice(0, LEVELS);
  const maxSize = Math.max(
    1,
    ...asks.map((l) => l.size),
    ...bids.map((l) => l.size),
  );

  const renderRow = (
    level: { price: number; size: number },
    side: 'ask' | 'bid',
    index: number,
  ) => (
    <button
      key={`${side}-${index}`}
      type="button"
      onClick={() => onPickPrice?.(level.price)}
      className="m-tap relative flex w-full items-center justify-between px-3 py-1.5 text-[13px]"
    >
      <span
        className={`absolute inset-y-0.5 right-0 rounded-l ${side === 'ask' ? 'bg-down/10' : 'bg-up/10'}`}
        style={{ width: `${(level.size / maxSize) * 62}%` }}
      />
      <span className="relative z-10 w-10 text-left text-[11px] text-muted">
        {side === 'ask' ? `卖${asks.length - index}` : `买${index + 1}`}
      </span>
      <span
        className={`tabular relative z-10 flex-1 text-right font-medium ${
          side === 'ask' ? 'text-down' : 'text-up'
        }`}
      >
        {formatPrice(level.price)}
      </span>
      <span className="tabular relative z-10 w-16 text-right text-muted">
        {formatCompact(level.size)}
      </span>
    </button>
  );

  return (
    <div className="py-2">
      {asks.map((level, i) => renderRow(level, 'ask', i))}
      <div className="my-1 flex items-center justify-between border-y border-border/60 px-3 py-1.5">
        <span className="text-[11px] text-muted">中间价</span>
        <span className="tabular text-[14px] font-semibold text-gray-100">
          {formatPrice(book.mid)}
        </span>
        <span className="tabular text-[11px] text-muted">价差 {formatPrice(book.spread, 3)}</span>
      </div>
      {bids.map((level, i) => renderRow(level, 'bid', i))}
      {book.synthetic && (
        <div className="px-3 pt-2 text-[11px] text-muted">合成盘口（模拟深度，仅供演示）</div>
      )}
    </div>
  );
}
