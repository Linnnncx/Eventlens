import { useEffect } from 'react';
import { X } from 'lucide-react';
import { TradePanel } from './TradePanel';
import type { OrderSide } from '../../types/api';

interface TradeSheetProps {
  open: boolean;
  symbol: string;
  side: OrderSide;
  newsId?: string | null;
  onClose: () => void;
}

export function TradeSheet({ open, symbol, side, newsId, onClose }: TradeSheetProps) {
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
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-xl border border-border bg-surface-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium text-gray-200">Trade</span>
          <button type="button" onClick={onClose} className="btn-ghost p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(85vh-44px)] overflow-y-auto">
          <TradePanel symbol={symbol} side={side} newsId={newsId} onSuccess={onClose} />
        </div>
      </div>
    </div>
  );
}
