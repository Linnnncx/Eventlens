import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { previewOrder, simulateOrder } from '../../api/endpoints';
import type { OrderPreviewRequest, OrderSide, OrderType } from '../../types/api';
import { formatCurrency } from '../../utils/format';

interface TradePanelProps {
  symbol: string;
  side: OrderSide;
  newsId?: string | null;
  onSuccess?: () => void;
}

export function TradePanel({ symbol, side, newsId, onSuccess }: TradePanelProps) {
  const queryClient = useQueryClient();
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [quantity, setQuantity] = useState('');
  const [notional, setNotional] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [inputMode, setInputMode] = useState<'qty' | 'notional'>('qty');

  const buildRequest = (): OrderPreviewRequest => ({
    symbol,
    side,
    orderType,
    quantity: inputMode === 'qty' && quantity ? Number(quantity) : undefined,
    notional: inputMode === 'notional' && notional ? Number(notional) : undefined,
    limitPrice: orderType === 'limit' && limitPrice ? Number(limitPrice) : undefined,
    stopLoss: stopLoss ? Number(stopLoss) : undefined,
    newsId: newsId ?? undefined,
  });

  const previewQuery = useQuery({
    queryKey: ['preview', symbol, side, orderType, quantity, notional, limitPrice, stopLoss, inputMode],
    queryFn: () => previewOrder(buildRequest()),
    enabled: Boolean(
      (inputMode === 'qty' && quantity && Number(quantity) > 0) ||
        (inputMode === 'notional' && notional && Number(notional) > 0),
    ),
    staleTime: 5_000,
  });

  const submitMut = useMutation({
    mutationFn: () => simulateOrder(buildRequest()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      onSuccess?.();
    },
  });

  useEffect(() => {
    setQuantity('');
    setNotional('');
    setLimitPrice('');
    setStopLoss('');
  }, [symbol, side]);

  const preview = previewQuery.data;
  const isBuy = side === 'buy';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={`border-b border-border px-4 py-3 ${isBuy ? 'bg-up/5' : 'bg-down/5'}`}>
        <h2 className={`text-sm font-semibold uppercase tracking-wide ${isBuy ? 'text-up' : 'text-down'}`}>
          {isBuy ? 'Buy' : 'Sell'} {symbol}
        </h2>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex gap-1 rounded-md border border-border bg-surface-raised p-0.5">
          {(['market', 'limit'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOrderType(t)}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium capitalize ${
                orderType === t ? 'bg-surface-card text-gray-100' : 'text-muted hover:text-gray-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex gap-1 rounded-md border border-border bg-surface-raised p-0.5">
          {(['qty', 'notional'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setInputMode(m)}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${
                inputMode === m ? 'bg-surface-card text-gray-100' : 'text-muted hover:text-gray-200'
              }`}
            >
              {m === 'qty' ? 'Shares' : 'Dollars'}
            </button>
          ))}
        </div>

        {inputMode === 'qty' ? (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Quantity</span>
            <input
              type="number"
              min="0"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input tabular"
              placeholder="0"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Notional ($)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={notional}
              onChange={(e) => setNotional(e.target.value)}
              className="input tabular"
              placeholder="0.00"
            />
          </label>
        )}

        {orderType === 'limit' && (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Limit price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="input tabular"
              placeholder="0.00"
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs text-muted">Stop loss (optional)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            className="input tabular"
            placeholder="0.00"
          />
        </label>

        {previewQuery.isFetching && (
          <p className="text-xs text-muted">Calculating preview…</p>
        )}

        {preview && (
          <section className="space-y-2 rounded-md border border-border bg-surface-raised p-3 text-sm">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Preview</h3>
            <Row label="Est. value" value={formatCurrency(preview.estimatedValue)} />
            <Row label="Price" value={formatCurrency(preview.price)} />
            <Row label="Quantity" value={preview.quantity.toFixed(4)} />
            <Row label="Fee" value={formatCurrency(preview.estimatedFee)} />
            <Row label="Cash after" value={formatCurrency(preview.cashAfter)} />
            <Row label="Position weight" value={`${(preview.positionWeightAfter * 100).toFixed(1)}%`} />
            <Row label="Order % equity" value={`${(preview.orderPctOfEquity * 100).toFixed(1)}%`} />

            {preview.ruleWarnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {preview.ruleWarnings.map((w) => (
                  <p key={w} className="flex items-start gap-1 text-xs text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {w}
                  </p>
                ))}
              </div>
            )}

            <div className="mt-2 rounded border border-border bg-surface-card p-2">
              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
                Risk · {preview.risk.riskLevel}
              </div>
              <p className="text-xs text-gray-300">{preview.risk.summary}</p>
              {preview.risk.attentionPoints.map((p) => (
                <p key={p} className="mt-1 text-[10px] text-muted">• {p}</p>
              ))}
            </div>
          </section>
        )}

        {submitMut.isError && (
          <p className="text-xs text-down">
            {(submitMut.error as Error).message || 'Order failed'}
          </p>
        )}

        {submitMut.isSuccess && (
          <p className="flex items-center gap-1 text-xs text-up">
            <CheckCircle2 className="h-3.5 w-3.5" /> Order simulated successfully
          </p>
        )}
      </div>

      <div className="border-t border-border p-4">
        <button
          type="button"
          disabled={!preview?.canSubmit || submitMut.isPending}
          onClick={() => submitMut.mutate()}
          className={`w-full rounded-md py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
            isBuy ? 'bg-up hover:bg-up-dim' : 'bg-down hover:bg-down-dim'
          }`}
        >
          {submitMut.isPending ? 'Submitting…' : `Simulate ${isBuy ? 'Buy' : 'Sell'}`}
        </button>
        {preview && !preview.canSubmit && preview.rejectReason && (
          <p className="mt-1 text-center text-[10px] text-down">{preview.rejectReason}</p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className="tabular font-medium text-gray-200">{value}</span>
    </div>
  );
}
