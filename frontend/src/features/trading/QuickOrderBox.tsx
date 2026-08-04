import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, GripVertical, Maximize2, Minimize2, X } from 'lucide-react';
import { previewOrder, simulateOrder } from '../../api/endpoints';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import type { OrderPreviewRequest, OrderSide } from '../../types/api';
import { formatCurrency } from '../../utils/format';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PriceInput } from './PriceInput';
import {
  ORDER_CATEGORIES,
  ORDER_FIELDS,
  type AdvancedOrderType,
  type OrderCategory,
  type OrderFieldId,
  getOrderType,
  isPriceField,
  orderTypesByCategory,
} from './orderTypes';

interface QuickOrderBoxProps {
  symbol: string;
  newsId?: string | null;
  price?: number;
  onClose?: () => void;
  /** Embed in parent (mobile sheet) instead of fixed+draggable */
  inline?: boolean;
}

type InputMode = 'qty' | 'notional';

const POS_KEY = 'eventlens.quickOrder.pos';

export function QuickOrderBox({ symbol, newsId, price = 0, onClose, inline = false }: QuickOrderBoxProps) {
  const queryClient = useQueryClient();
  const tradeSide = useWorkbenchStore((s) => s.tradeSide);
  const setTradeSide = useWorkbenchStore((s) => s.setTradeSide);
  const bookPrice = useWorkbenchStore((s) => s.bookPrice);
  const setBookPrice = useWorkbenchStore((s) => s.setBookPrice);

  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<OrderCategory>('basic');
  const [orderKind, setOrderKind] = useState<AdvancedOrderType>('market');
  const [side, setSide] = useState<OrderSide>(tradeSide);
  const [inputMode, setInputMode] = useState<InputMode>('qty');
  const [quantity, setQuantity] = useState('');
  const [notional, setNotional] = useState('');
  const [fields, setFields] = useState<Partial<Record<OrderFieldId, string>>>({});
  const [pos, setPos] = useState(() => loadPos());
  const dragRef = useRef<{
    pointerId: number;
    ox: number;
    oy: number;
    px: number;
    py: number;
    bw: number;
    bh: number;
  } | null>(null);
  const posRef = useRef(pos);
  const rafDragRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  posRef.current = pos;

  const typeDef = getOrderType(orderKind);

  useEffect(() => {
    setSide(tradeSide);
  }, [tradeSide]);

  useEffect(() => {
    if (bookPrice != null) {
      setOrderKind((k) => (k === 'market' ? 'limit' : k));
      setFields((f) => ({ ...f, limitPrice: bookPrice.toFixed(2) }));
      setBookPrice(null);
    }
  }, [bookPrice, setBookPrice]);

  useEffect(() => {
    setQuantity('');
    setNotional('');
    setFields({});
    setOrderKind('market');
    setCategory('basic');
  }, [symbol]);

  useEffect(() => {
    if (newsId) {
      setFields((f) => ({ ...f, eventNewsId: newsId }));
    }
  }, [newsId]);

  const setField = (id: OrderFieldId, value: string) => {
    setFields((f) => ({ ...f, [id]: value }));
  };

  const buildRequest = (): OrderPreviewRequest => {
    const limitRaw = fields.limitPrice ? Number(fields.limitPrice) : undefined;
    const stopLoss =
      fields.stopLossPrice || fields.stopPrice
        ? Number(fields.stopLossPrice || fields.stopPrice)
        : undefined;
    const takeProfit = fields.takeProfitPrice ? Number(fields.takeProfitPrice) : undefined;

    return {
      symbol,
      side,
      orderType: typeDef.execAs,
      quantity: inputMode === 'qty' && quantity ? Number(quantity) : undefined,
      notional:
        inputMode === 'notional' && notional
          ? Number(notional)
          : fields.notional
            ? Number(fields.notional)
            : undefined,
      limitPrice: typeDef.execAs === 'limit' && limitRaw ? limitRaw : undefined,
      referencePrice: price > 0 ? price : undefined,
      stopLoss: stopLoss || undefined,
      takeProfit: takeProfit || undefined,
      newsId: newsId ?? fields.eventNewsId ?? undefined,
    };
  };

  const canPreview = Boolean(
    (inputMode === 'qty' && quantity && Number(quantity) > 0) ||
    (inputMode === 'notional' && notional && Number(notional) > 0) ||
    (orderKind === 'dca' && fields.notional && Number(fields.notional) > 0),
  );
  const previewRequest = useDebouncedValue(buildRequest(), 250);

  const previewQuery = useQuery({
    queryKey: ['quick-preview', previewRequest],
    queryFn: ({ signal }) => previewOrder(previewRequest, signal),
    enabled: Boolean(canPreview),
    staleTime: 4_000,
  });

  const submitMut = useMutation({
    mutationFn: () => simulateOrder(buildRequest()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      setQuantity('');
      setNotional('');
    },
  });

  const flushDragFrame = useCallback(() => {
    rafDragRef.current = null;
    const next = pendingPosRef.current;
    const el = boxRef.current;
    if (!next || !el) return;
    // Direct DOM write — avoids re-rendering the whole order form every pointermove.
    el.style.left = `${next.x}px`;
    el.style.top = `${next.y}px`;
  }, []);

  const onDragPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (inline || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, select, a, label')) return;
    const el = boxRef.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = posRef.current;
    dragRef.current = {
      pointerId: e.pointerId,
      ox: e.clientX,
      oy: e.clientY,
      px: start.x,
      py: start.y,
      bw: el.offsetWidth,
      bh: el.offsetHeight,
    };
    pendingPosRef.current = start;
    document.body.style.userSelect = 'none';
    el.style.willChange = 'left, top';
  }, [inline]);

  const onDragPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const next = clampPos(
        drag.px + (e.clientX - drag.ox),
        drag.py + (e.clientY - drag.oy),
        drag.bw,
        drag.bh,
      );
      pendingPosRef.current = next;
      if (rafDragRef.current == null) {
        rafDragRef.current = requestAnimationFrame(flushDragFrame);
      }
    },
    [flushDragFrame],
  );

  const onDragPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (rafDragRef.current != null) {
      cancelAnimationFrame(rafDragRef.current);
      rafDragRef.current = null;
    }
    const el = boxRef.current;
    const finalPos = pendingPosRef.current ?? posRef.current;
    pendingPosRef.current = null;
    if (el) {
      el.style.left = `${finalPos.x}px`;
      el.style.top = `${finalPos.y}px`;
      el.style.willChange = '';
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    document.body.style.userSelect = '';
    setPos(finalPos);
    savePos(finalPos);
  }, []);

  const pickType = (id: AdvancedOrderType) => {
    const def = getOrderType(id);
    setOrderKind(id);
    setCategory(def.category);
    if (id === 'dca') setInputMode('notional');
  };

  const isBuy = side === 'buy';
  const preview = previewQuery.data;

  return (
    <div
      ref={boxRef}
      data-quick-order
      className={
        inline
          ? 'flex h-full max-h-none w-full flex-col overflow-hidden bg-surface-card'
          : 'fixed z-40 hidden max-h-[min(92vh,820px)] w-[min(460px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface-card shadow-float lg:flex'
      }
      style={inline ? undefined : { left: pos.x, top: pos.y }}
    >
      <div
        className={`flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised/90 px-3 py-2.5 ${
          inline ? '' : 'cursor-grab touch-none active:cursor-grabbing'
        }`}
        onPointerDown={inline ? undefined : onDragPointerDown}
        onPointerMove={inline ? undefined : onDragPointerMove}
        onPointerUp={inline ? undefined : onDragPointerUp}
        onPointerCancel={inline ? undefined : onDragPointerUp}
      >
        {!inline && <GripVertical className="h-4 w-4 shrink-0 text-muted" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-semibold tracking-wide text-gray-50">{symbol}</span>
            <span className="rounded-md bg-surface px-1.5 py-0.5 text-xs text-muted">
              {typeDef.label}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="btn-ghost gap-1.5 px-2 py-1 text-xs text-primary"
          title={expanded ? '收起高级类型' : '更多订单类型'}
        >
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {expanded ? '收起' : '更多订单类型'}
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="btn-ghost p-1" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {expanded && (
          <div className="space-y-2.5 rounded-xl border border-border bg-surface/80 p-3">
            <div className="flex flex-wrap gap-1.5">
              {ORDER_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCategory(c.id);
                    const first = orderTypesByCategory(c.id)[0];
                    if (first) pickType(first.id);
                  }}
                  className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
                    category === c.id
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted hover:bg-surface-hover hover:text-gray-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {orderTypesByCategory(category).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickType(t.id)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    orderKind === t.id
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-border hover:bg-surface-hover'
                  }`}
                >
                  <div className="text-sm font-medium text-gray-100">{t.label}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">
                    {t.description}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">{typeDef.description}</p>
          </div>
        )}

        <div className="seg-control">
          {(['buy', 'sell'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSide(s);
                setTradeSide(s);
              }}
              className={`seg-btn ${
                side === s
                  ? s === 'buy'
                    ? 'bg-up text-white shadow-sm'
                    : 'bg-down text-white shadow-sm'
                  : 'seg-btn-idle'
              }`}
            >
              {s === 'buy' ? '买入' : '卖出'}
            </button>
          ))}
        </div>

        {!expanded && (
          <div className="seg-control">
            {(['market', 'limit'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => pickType(t)}
                className={`seg-btn ${orderKind === t ? 'seg-btn-active' : 'seg-btn-idle'}`}
              >
                {t === 'market' ? '市价单' : '限价单'}
              </button>
            ))}
          </div>
        )}

        {orderKind !== 'dca' && (
          <>
            <div className="seg-control">
              {(['qty', 'notional'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setInputMode(m)}
                  className={`seg-btn ${inputMode === m ? 'seg-btn-active' : 'seg-btn-idle'}`}
                >
                  {m === 'qty' ? '数量' : '金额'}
                </button>
              ))}
            </div>
            {inputMode === 'qty' ? (
              <Field label="数量 (股)" value={quantity} onChange={setQuantity} placeholder="0" step="1" />
            ) : (
              <Field
                label="金额 (USD)"
                value={notional}
                onChange={setNotional}
                placeholder="0.00"
                step="0.01"
              />
            )}
          </>
        )}

        {typeDef.fields.map((fid) => {
          if (fid === 'notional' && orderKind === 'dca') {
            return (
              <Field
                key={fid}
                label="每期金额 (USD)"
                value={fields.notional ?? ''}
                onChange={(v) => setField('notional', v)}
                placeholder="0.00"
                step="0.01"
              />
            );
          }
          if (fid === 'side') return null;
          const def = ORDER_FIELDS[fid];
          if (def.kind === 'select' && def.options) {
            return (
              <label key={fid} className="block">
                <span className="mb-1.5 block text-sm text-muted">{def.label}</span>
                <select
                  className="input text-sm"
                  value={fields[fid] ?? def.options[0]?.value ?? ''}
                  onChange={(e) => setField(fid, e.target.value)}
                >
                  {def.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (def.kind === 'text') {
            return (
              <label key={fid} className="block">
                <span className="mb-1.5 block text-sm text-muted">{def.label}</span>
                <input
                  className="input text-sm"
                  value={fields[fid] ?? ''}
                  onChange={(e) => setField(fid, e.target.value)}
                  placeholder={def.placeholder}
                />
                {def.hint && <span className="mt-1 block text-xs text-muted">{def.hint}</span>}
              </label>
            );
          }
          if (!expanded && fid === 'timeInForce') return null;
          if (isPriceField(fid)) {
            return (
              <PriceInput
                key={fid}
                symbol={symbol}
                label={def.label}
                value={fields[fid] ?? ''}
                onChange={(v) => setField(fid, v)}
                placeholder={def.placeholder}
                hint={def.hint}
              />
            );
          }
          return (
            <Field
              key={fid}
              label={def.label}
              value={fields[fid] ?? ''}
              onChange={(v) => setField(fid, v)}
              placeholder={def.placeholder}
              step={def.step}
              hint={def.hint}
            />
          );
        })}

        {preview && (
          <div className="flex justify-between rounded-lg bg-surface-raised/60 px-3 py-2 text-sm text-muted">
            <span>
              约 <span className="tabular text-gray-200">{preview.quantity.toFixed(2)}</span> 股 ·{' '}
              <span className="tabular text-gray-200">{formatCurrency(preview.estimatedValue)}</span>
            </span>
            <span>
              费 <span className="tabular">{formatCurrency(preview.estimatedFee)}</span>
            </span>
          </div>
        )}

        {submitMut.isSuccess && (
          <p className="flex items-center gap-1.5 text-sm text-up">
            <CheckCircle2 className="h-4 w-4" /> 模拟成交成功
          </p>
        )}
        {submitMut.isError && (
          <p className="text-sm text-down">{(submitMut.error as Error).message}</p>
        )}
        {preview && !preview.canSubmit && preview.rejectReason && (
          <p className="text-sm text-down">{preview.rejectReason}</p>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-surface-raised/40 p-4">
        <button
          type="button"
          disabled={!canPreview || preview?.canSubmit === false || submitMut.isPending}
          onClick={() => submitMut.mutate()}
          className={`w-full rounded-xl py-3 text-base font-semibold text-white shadow-sm transition-opacity disabled:opacity-45 ${
            isBuy ? 'bg-up hover:bg-up-dim' : 'bg-down hover:bg-down-dim'
          }`}
        >
          {submitMut.isPending
            ? '提交中…'
            : `确认${isBuy ? '买入' : '卖出'} · ${typeDef.label}`}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  step,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      <input
        type="number"
        min="0"
        step={step ?? 'any'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input tabular text-base"
        placeholder={placeholder}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { x: number; y: number };
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        return clampPos(p.x, p.y, null);
      }
    }
  } catch {
    /* ignore */
  }
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  return { x: Math.max(16, w / 2 - 230), y: Math.max(80, h - 420) };
}

function savePos(p: { x: number; y: number }) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function clampPos(
  x: number,
  y: number,
  widthOrEl: number | HTMLElement | null,
  height?: number,
): { x: number; y: number } {
  const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const wh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const bw =
    typeof widthOrEl === 'number'
      ? widthOrEl
      : (widthOrEl?.offsetWidth ?? 460);
  const bh =
    typeof height === 'number'
      ? height
      : typeof widthOrEl === 'number'
        ? 360
        : (widthOrEl?.offsetHeight ?? 360);
  return {
    x: Math.min(Math.max(8, x), Math.max(8, ww - bw - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, wh - Math.min(bh, wh * 0.5) - 8)),
  };
}
