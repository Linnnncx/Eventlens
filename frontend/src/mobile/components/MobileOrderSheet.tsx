import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown, X } from 'lucide-react';
import { previewOrder, simulateOrder } from '../../api/endpoints';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import type { OrderPreviewRequest, OrderSide, OrderType, Position } from '../../types/api';
import { formatPrice } from '../../utils/format';
import { Stepper } from './ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

interface MobileOrderSheetProps {
  open: boolean;
  symbol: string;
  price: number;
  side: OrderSide;
  cash: number;
  position?: Position;
  onClose: () => void;
}

const QUICK_RATIOS = [
  { label: '1/4', ratio: 0.25 },
  { label: '1/3', ratio: 1 / 3 },
  { label: '1/2', ratio: 0.5 },
  { label: '全部', ratio: 1 },
];

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 1.1;

/**
 * Bottom order sheet (not a free-floating card).
 * Pull the top handle down to shrink / reveal the chart; far enough or a flick closes it.
 */
export function MobileOrderSheet({
  open,
  symbol,
  price,
  side: initialSide,
  cash,
  position,
  onClose,
}: MobileOrderSheetProps) {
  const queryClient = useQueryClient();
  const markedPrice = useWorkbenchStore((s) => s.markedPrice);
  const [side, setSide] = useState<OrderSide>(initialSide);
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState(price);
  const [advanced, setAdvanced] = useState(false);
  const [takeProfit, setTakeProfit] = useState(0);
  const [stopLoss, setStopLoss] = useState(0);
  const [extendedHours, setExtendedHours] = useState(false);
  const [step, setStep] = useState<'form' | 'done'>('form');
  const [pullY, setPullY] = useState(0);

  const dragRef = useRef<{
    pointerId: number;
    oy: number;
    lastY: number;
    lastT: number;
    vy: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSide(initialSide);
    setStep('form');
    setQuantity(1);
    setLimitPrice(Number(price.toFixed(2)));
    setTakeProfit(0);
    setStopLoss(0);
    setAdvanced(false);
    setPullY(0);
  }, [open, initialSide, price, symbol]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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
    queryKey: ['mobile-order-preview', previewRequest],
    queryFn: ({ signal }) => previewOrder(previewRequest, signal),
    enabled: open && quantity > 0,
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

  const estValue = preview?.estimatedValue ?? refPrice * quantity;
  const estFee = preview?.estimatedFee ?? 0;
  const reveal = Math.min(1, pullY / DISMISS_DISTANCE);

  const onHandlePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      oy: e.clientY,
      lastY: e.clientY,
      lastT: performance.now(),
      vy: 0,
    };
  };

  const onHandlePointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.vy = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = now;
    setPullY(Math.max(0, e.clientY - d.oy));
  };

  const onHandlePointerUp = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (pullY >= DISMISS_DISTANCE || d.vy > DISMISS_VELOCITY) {
      setPullY(0);
      onClose();
    } else {
      setPullY(0);
    }
  };

  if (!open) return null;

  const title =
    step === 'done' ? '下单结果' : `${side === 'buy' ? '买入' : '卖出'} ${symbol}`;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] transition-opacity"
        style={{ opacity: Math.max(0, 1 - reveal) }}
        onClick={onClose}
        aria-hidden
      />

      <div
        className="safe-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-2xl border-t border-border bg-surface-card shadow-float"
        style={{
          transform: `translateY(${pullY}px)`,
          opacity: 1 - reveal * 0.25,
          willChange: 'transform, opacity',
        }}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="flex touch-none flex-col items-center pt-2"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <div className="h-1 w-10 rounded-full bg-border" />
          <div className="pb-1 pt-1 text-[10px] text-muted">下滑缩小 / 关闭</div>
        </div>

        <div className="flex items-center justify-between px-4 pb-2">
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold text-gray-100">{title}</div>
            <div className="tabular text-[12px] text-muted">现价 ${formatPrice(price)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="m-tap -mr-1 flex h-9 w-9 items-center justify-center rounded-full text-muted"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {step === 'done' ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-up/15">
                <Check className="h-7 w-7 text-up" />
              </div>
              <div className="text-[15px] font-semibold text-gray-100">
                {submit.data?.status === 'filled' ? '已成交' : '委托已提交'}
              </div>
              <div className="tabular text-[13px] text-muted">
                {side === 'buy' ? '买入' : '卖出'} {symbol} {quantity} 股 @ $
                {formatPrice(submit.data?.preview.price ?? refPrice)}
              </div>
              <button type="button" onClick={onClose} className="btn-primary mt-2 w-full py-3">
                完成
              </button>
            </div>
          ) : (
            <div className="pb-2">
              <div className="seg-control mb-3">
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

              <div className="seg-control mb-3">
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
                <PriceField
                  label="委托价"
                  value={limitPrice}
                  onChange={setLimitPrice}
                  markedPrice={markedPrice}
                />
              )}

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

              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                className="m-tap mt-3 flex w-full items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-[13px] text-muted"
              >
                高级设置（止盈 / 止损 / 盘前盘后）
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${advanced ? 'rotate-180' : ''}`}
                />
              </button>

              {advanced && (
                <div className="mt-2 space-y-2.5 rounded-xl border border-border/70 bg-surface-raised px-3 py-3">
                  <PriceField
                    label="止盈价（0 表示不设）"
                    value={takeProfit}
                    onChange={setTakeProfit}
                    markedPrice={markedPrice}
                  />
                  <PriceField
                    label="止损价（0 表示不设）"
                    value={stopLoss}
                    onChange={setStopLoss}
                    markedPrice={markedPrice}
                  />
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

              <dl className="mt-3 space-y-1.5 text-[12px]">
                <Row label="预计金额" value={`$${formatPrice(estValue)}`} />
                <Row
                  label="预计手续费"
                  value={previewing ? '计算中…' : `$${formatPrice(estFee, 2)}`}
                />
                <Row
                  label="下单后现金"
                  value={preview ? `$${formatPrice(preview.cashAfter)}` : '—'}
                />
              </dl>

              {(preview?.ruleWarnings.length ?? 0) > 0 && (
                <div className="mt-3 space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
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
                disabled={quantity <= 0 || submit.isPending || preview?.canSubmit === false}
                onClick={() => submit.mutate()}
                className={`m-tap mt-3 w-full rounded-xl py-3.5 text-[16px] font-semibold text-white disabled:opacity-40 ${
                  side === 'buy' ? 'bg-up-dim' : 'bg-down-dim'
                }`}
              >
                {submit.isPending ? '提交中…' : '确认下单'}
              </button>
              {submit.isError && (
                <div className="mt-2 text-center text-[12px] text-down">下单失败，请重试</div>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function PriceField({
  label,
  value,
  onChange,
  markedPrice,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  markedPrice: number | null;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted">{label}</span>
        <button
          type="button"
          disabled={markedPrice == null}
          onClick={() => {
            if (markedPrice == null) return;
            onChange(Number(markedPrice.toFixed(2)));
          }}
          className="m-tap shrink-0 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200 disabled:border-border/60 disabled:bg-transparent disabled:text-muted/50"
        >
          {markedPrice != null ? `标记价格 ${formatPrice(markedPrice)}` : '标记价格'}
        </button>
      </div>
      <Stepper value={value} onChange={onChange} step={0.01} decimals={2} />
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
