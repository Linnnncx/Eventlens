import { useEffect } from 'react';
import { X } from 'lucide-react';
import { OrderBook } from './OrderBook';
import { QuickOrderBox } from './QuickOrderBox';

interface TradeSheetProps {
  open: boolean;
  symbol: string;
  price: number;
  newsId?: string | null;
  onClose: () => void;
}

export function TradeSheet({ open, symbol, price, newsId, onClose }: TradeSheetProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col overflow-hidden rounded-t-xl border border-border bg-surface-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium text-gray-200">Trade · {symbol}</span>
          <button type="button" onClick={onClose} className="btn-ghost p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(180px,38%)_1fr] overflow-hidden">
          <div className="min-h-0 overflow-hidden border-b border-border">
            <OrderBook symbol={symbol} levels={8} />
          </div>
          <div className="min-h-0 overflow-hidden">
            <QuickOrderBox inline symbol={symbol} price={price} newsId={newsId} onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
