import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { previewOrder, simulateOrder } from '../../api/endpoints';
import type { OrderPreviewRequest, OrderSide, OrderType, Position } from '../../types/api';
import { changeColorClass, formatPercent, formatPrice } from '../../utils/format';
import { Stepper } from './ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

const QUICK_RATIOS = [
  { label: '1/4', ratio: 0.25 },
  { label: '1/3', ratio: 1 / 3 },
  { label: '1/2', ratio: 0.5 },
  { label: '全部', ratio: 1 },
];

interface MobileInlineOrderProps {
  symbol: string;
  price: number;
  changePercent?: number;
  cash: number;
  position?: Position;
}

/**
 * Inline quick-order panel for the trade tab — form fields stay on the page
 * (no buy/sell sheet). Stock page still uses MobileOrderSheet.
 */
export function MobileInlineOrder({
  symbol,
  price,
  changePercent = 0,
  cash,
  position,
}: MobileInlineOrderProps) {
  const queryClient = useQueryClient();
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState(price);
  const [advanced, setAdvanced] = useState(false);
  const [takeProfit, setTakeProfit] = useState(0);
  const [stopLoss, setStopLoss] = useState(0);
  const [extendedHours, setExtendedHours] = useState(false);
  const [step, setStep] = useState<'form' | 'done'>('form');

  useEffect(() => {
    setStep('form');
    setQuantity(1);
    setLimitPrice(Number(price.toFixed(2)) || 0);
    setTakeProfit(0);
    setStopLoss(0);
    setAdvanced(false);
  }, [symbol]);

  useEffect(() => {
    if (price > 0) setLimitPrice((prev) => (prev > 0 ? prev : Number(price.toFixed(2))));
  }, [price]);

  const refPrice = orderType === 'limit' && limitPrice > 0 ? limitPrice : price;
  const maxBuy = refPrice > 0 ? Math.floor(cash / refPrice) : 0;
  const maxSell = Math.floor(position?.availableQuantity ?? position?.quantity ?? 0);
  const maxQty = side === 'buy' ? maxBuy : maxSell;

  const request = useMemo<OrderPreviewRequest>(
    () => ({
      symbol,
      side,
      orderType,
      quantity,
      limitPrice: orderType === 'limit' ? limitPrice : null,
      referencePrice: price > 0 ? price : null,
      takeProfit: advanced && takeProfit > 0 ? takeProfit : null,
      stopLoss: advanced && stopLoss > 0 ? stopLoss : null,
      extendedHours,
    }),
    [symbol, side, orderType, quantity, limitPrice, advanced, takeProfit, stopLoss, extendedHours],
  );
  const previewRequest = useDebouncedValue(request, 250);

  const { data: preview, isFetching: previewing } = useQuery({
    queryKey: ['mobile-inline-order-preview', previewRequest],
    queryFn: ({ signal }) => previewOrder(previewRequest, signal),
    enabled: Boolean(symbol) && quantity > 0 && price > 0,
    staleTime: 10_000,
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () => simulateOrder(request),
    onSuccess: () => {
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });

  useEffect(() => {
    if (step !== 'done') return;
    const timer = window.setTimeout(() => {
      setStep('form');
      setQuantity(1);
      submit.reset();
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [step]);

  const estValue = preview?.estimatedValue ?? refPrice * quantity;
  const estFee = preview?.estimatedFee ?? 0;

  if (step === 'done') {
    return (
      <div className="mt-3 flex flex-col items-center gap-3 py-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-up/15">
          <Check className="h-6 w-6 text-up" />
        </div>
        <div className="text-[15px] font-semibold text-gray-100">
          成功下单
        </div>
        <div className="tabular text-[13px] text-muted">
          {side === 'buy' ? '买入' : '卖出'} {symbol} {quantity} 股 @ $
          {formatPrice(submit.data?.preview.price ?? refPrice)}
        </div>
        <button
          type="button"
          onClick={() => {
            setStep('form');
            setQuantity(1);
            submit.reset();
          }}
          className="btn-primary w-full py-3"
        >
          继续下单
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[16px] font-semibold text-gray-50">{symbol}</div>
          <div className="text-[11px] text-muted">
            {position
              ? `持仓 ${position.quantity} 股 · 成本 $${formatPrice(position.avgCost)}`
              : '当前无持仓'}
          </div>
        </div>
        <div className="text-right">
          <div className={`tabular text-[20px] font-bold ${changeColorClass(changePercent)}`}>
            {price ? formatPrice(price) : '—'}
          </div>
          {price > 0 && (
            <div className={`tabular text-[11px] ${changeColorClass(changePercent)}`}>
              {formatPercent(changePercent)}
            </div>
          )}
        </div>
      </div>

      <div className="seg-control">
        {(['buy', 'sell'] as OrderSide[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`seg-btn m-tap ${
              side === s
                ? s === 'buy'
                  ? 'bg-up/20 text-up'
                  : 'bg-down/20 text-down'
                : 'seg-btn-idle'
            }`}
          >
            {s === 'buy' ? '买入' : '卖出'}
          </button>
        ))}
      </div>

      <div className="seg-control">
        {(['market', 'limit'] as OrderType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setOrderType(t)}
            className={`seg-btn m-tap ${orderType === t ? 'seg-btn-active' : 'seg-btn-idle'}`}
          >
            {t === 'market' ? '市价单' : '限价单'}
          </button>
        ))}
      </div>

      {orderType === 'limit' && (
        <div>
          <div className="mb-1.5 text-[12px] text-muted">委托价</div>
          <Stepper value={limitPrice} onChange={setLimitPrice} step={0.01} decimals={2} />
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[12px] text-muted">
          <span>数量（股）</span>
          <span className="tabular">
            最多可{side === 'buy' ? '买' : '卖'} {maxQty}
          </span>
        </div>
        <Stepper value={quantity} onChange={(v) => setQuantity(Math.round(v))} min={0} />
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {QUICK_RATIOS.map(({ label, ratio }) => (
            <button
              key={label}
              type="button"
              onClick={() => setQuantity(Math.max(1, Math.floor(maxQty * ratio)))}
              className="m-tap rounded-lg border border-border bg-surface-raised py-1.5 text-[12px] text-muted"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="m-tap flex w-full items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-[13px] text-muted"
      >
        高级设置（止盈 / 止损 / 盘前盘后）
        <ChevronDown className={`h-4 w-4 transition-transform ${advanced ? 'rotate-180' : ''}`} />
      </button>

      {advanced && (
        <div className="space-y-2.5 rounded-xl border border-border/70 bg-surface-raised px-3 py-3">
          <div>
            <div className="mb-1 text-[12px] text-muted">止盈价（0 表示不设）</div>
            <Stepper value={takeProfit} onChange={setTakeProfit} step={0.01} decimals={2} />
          </div>
          <div>
            <div className="mb-1 text-[12px] text-muted">止损价（0 表示不设）</div>
            <Stepper value={stopLoss} onChange={setStopLoss} step={0.01} decimals={2} />
          </div>
          <label className="flex items-center justify-between text-[13px] text-gray-200">
            允许盘前盘后成交
            <input
              type="checkbox"
              checked={extendedHours}
              onChange={(e) => setExtendedHours(e.target.checked)}
              className="h-5 w-5 accent-blue-500"
            />
          </label>
        </div>
      )}

      <dl className="space-y-1.5 text-[12px]">
        <Row label="预计金额" value={`$${formatPrice(estValue)}`} />
        <Row label="预计手续费" value={previewing ? '计算中…' : `$${formatPrice(estFee, 2)}`} />
        <Row label="下单后现金" value={preview ? `$${formatPrice(preview.cashAfter)}` : '—'} />
      </dl>

      {(preview?.ruleWarnings.length ?? 0) > 0 && (
        <div className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          {preview!.ruleWarnings.map((w, i) => (
            <div key={i} className="flex gap-2 text-[12px] leading-snug text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={quantity <= 0 || !price || submit.isPending || preview?.canSubmit === false}
        onClick={() => submit.mutate()}
        className={`m-tap w-full rounded-xl py-3.5 text-[16px] font-semibold text-white disabled:opacity-40 ${
          side === 'buy' ? 'bg-up-dim' : 'bg-down-dim'
        }`}
      >
        {submit.isPending ? '提交中…' : '确认下单'}
      </button>
      {submit.isError && (
        <div className="text-center text-[12px] text-down">下单失败，请重试</div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-medium text-gray-100">{value}</dd>
    </div>
  );
}
