import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Trash2 } from 'lucide-react';
import { removeFromWatchlist } from '../../api/endpoints';
import type { Snapshot } from '../../types/api';
import { formatCompact, formatPercent, formatPrice } from '../../utils/format';
import { EmptyState } from './ui';

const ORDER_KEY = 'eventlens.watchlist.order.v1';
const DELETE_THRESHOLD = 72;
const LONG_PRESS_MS = 280;

function loadOrder(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function saveWatchlistOrder(symbols: string[]) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(symbols));
}

export function applyWatchlistOrder(symbols: string[]): string[] {
  const saved = loadOrder();
  const ordered = saved.filter((s) => symbols.includes(s));
  const rest = symbols.filter((s) => !ordered.includes(s));
  return [...ordered, ...rest];
}

interface MobileWatchlistProps {
  symbols: string[];
  snapMap: Map<string, Snapshot>;
  /** Symbols currently held — highlighted so positions jump out of the list. */
  heldSymbols?: Set<string>;
}

export function MobileWatchlist({ symbols, snapMap, heldSymbols }: MobileWatchlistProps) {
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [order, setOrder] = useState(() => applyWatchlistOrder(symbols));
  const [openSwipe, setOpenSwipe] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  useEffect(() => {
    setOrder((prev) => {
      const next = applyWatchlistOrder(symbols);
      return next.join(',') === prev.join(',') ? prev : next;
    });
  }, [symbols]);

  const rows = useMemo(
    () => order.map((s) => snapMap.get(s)).filter(Boolean) as Snapshot[],
    [order, snapMap],
  );

  const remove = useMutation({
    mutationFn: (symbol: string) => removeFromWatchlist(symbol),
    onSuccess: (_data, symbol) => {
      setOrder((prev) => {
        const next = prev.filter((s) => s !== symbol);
        saveWatchlistOrder(next);
        return next;
      });
      setOpenSwipe(null);
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });

  const moveSymbolTo = (symbol: string, clientY: number) => {
    const list = listRef.current;
    if (!list) return;
    const rowEls = [...list.querySelectorAll<HTMLElement>('[data-watch-row]')];
    if (rowEls.length === 0) return;
    let target = rowEls.length - 1;
    for (let i = 0; i < rowEls.length; i++) {
      const rect = rowEls[i]!.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        target = i;
        break;
      }
    }
    setOrder((prev) => {
      const from = prev.indexOf(symbol);
      if (from < 0 || from === target) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(target, 0, symbol);
      return next;
    });
  };

  if (rows.length === 0) {
    return <EmptyState text="自选为空，去市场里加几只" />;
  }

  return (
    <div ref={listRef} className="divide-y divide-border/50">
      {rows.map((snapshot) => (
        <WatchRow
          key={snapshot.symbol}
          snapshot={snapshot}
          held={heldSymbols?.has(snapshot.symbol) ?? false}
          swipeOpen={openSwipe === snapshot.symbol}
          dragging={dragging === snapshot.symbol}
          onSwipeOpen={() => setOpenSwipe(snapshot.symbol)}
          onSwipeClose={() => setOpenSwipe((s) => (s === snapshot.symbol ? null : s))}
          onDelete={() => remove.mutate(snapshot.symbol)}
          deleting={remove.isPending && remove.variables === snapshot.symbol}
          onDragBegin={() => {
            setOpenSwipe(null);
            setDragging(snapshot.symbol);
          }}
          onDragMove={(clientY) => moveSymbolTo(snapshot.symbol, clientY)}
          onDragEnd={() => {
            setDragging(null);
            saveWatchlistOrder(orderRef.current);
          }}
        />
      ))}
      <div className="px-4 py-2 text-center text-[11px] text-muted">
        左滑删除 · 按住把手拖动排序
        {heldSymbols && heldSymbols.size > 0 ? ' · 持仓标的高亮显示' : ''}
      </div>
    </div>
  );
}

function WatchRow({
  snapshot,
  held,
  swipeOpen,
  dragging,
  onSwipeOpen,
  onSwipeClose,
  onDelete,
  deleting,
  onDragBegin,
  onDragMove,
  onDragEnd,
}: {
  snapshot: Snapshot;
  held: boolean;
  swipeOpen: boolean;
  dragging: boolean;
  onSwipeOpen: () => void;
  onSwipeClose: () => void;
  onDelete: () => void;
  deleting: boolean;
  onDragBegin: () => void;
  onDragMove: (clientY: number) => void;
  onDragEnd: () => void;
}) {
  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<'x' | 'y' | null>(null);
  const longPress = useRef<number | null>(null);
  const dragActive = useRef(false);
  const [dx, setDx] = useState(0);

  const applyDx = swipeOpen ? Math.min(0, dx - DELETE_THRESHOLD) : Math.min(0, dx);
  const translate = Math.max(-DELETE_THRESHOLD, applyDx);

  const clearLongPress = () => {
    if (longPress.current != null) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const handle = (e.target as HTMLElement).closest('[data-drag-handle]');
    startX.current = e.clientX;
    startY.current = e.clientY;
    axis.current = null;
    dragActive.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (handle) {
      longPress.current = window.setTimeout(() => {
        dragActive.current = true;
        onDragBegin();
        if (navigator.vibrate) navigator.vibrate(12);
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const mx = e.clientX - startX.current;
    const my = e.clientY - startY.current;

    if (dragActive.current) {
      clearLongPress();
      onDragMove(e.clientY);
      return;
    }

    if (Math.abs(mx) > 6 || Math.abs(my) > 6) clearLongPress();

    if (axis.current == null) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      axis.current = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (axis.current === 'y') return;
    }
    if (axis.current !== 'x') return;
    setDx(mx);
  };

  const onPointerUp = () => {
    clearLongPress();
    if (dragActive.current) {
      dragActive.current = false;
      onDragEnd();
    } else if (axis.current === 'x') {
      if (dx < -DELETE_THRESHOLD * 0.55) onSwipeOpen();
      else onSwipeClose();
    }
    setDx(0);
    axis.current = null;
  };

  return (
    <div
      data-watch-row
      className={`relative overflow-hidden ${dragging ? 'z-20 bg-surface-hover/40 opacity-95 ring-1 ring-inset ring-primary/35' : ''}`}
    >
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="absolute inset-y-0 right-0 flex w-[72px] items-center justify-center bg-down text-[13px] font-medium text-white"
        aria-label={`删除 ${snapshot.symbol}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <div
        className="relative z-10 flex items-center bg-surface-card"
        style={{
          transform: `translateX(${dragging ? 0 : translate}px)`,
          transition: dragging || dx !== 0 ? undefined : 'transform 0.15s ease',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          data-drag-handle
          className="flex h-14 w-9 shrink-0 touch-none items-center justify-center text-muted active:text-gray-200"
          aria-label="拖动排序"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <Link
          to={`/workbench/${snapshot.symbol}`}
          className="m-tap flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-4"
          onClick={(e) => {
            if (swipeOpen || dragging || Math.abs(translate) > 4) {
              e.preventDefault();
              onSwipeClose();
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`font-mono text-[14px] font-semibold leading-tight ${
                  held ? 'text-amber-300' : 'text-gray-50'
                }`}
              >
                {snapshot.symbol}
              </span>
              {held && (
                <span className="rounded bg-amber-400/15 px-1 py-0.5 text-[10px] font-medium text-amber-300">
                  持仓
                </span>
              )}
            </div>
            <div
              className={`truncate text-[11px] leading-tight ${held ? 'text-amber-200/70' : 'text-muted'}`}
            >
              {snapshot.name}
            </div>
          </div>
          <div className="tabular text-right">
            <div className="text-[14px] font-medium text-gray-100">
              {formatPrice(snapshot.price)}
            </div>
            <div className="text-[10px] text-muted">{formatCompact(snapshot.volume)}</div>
          </div>
          <div
            className={`tabular w-[74px] rounded-md py-1.5 text-center text-[13px] font-semibold text-white ${
              snapshot.changePercent >= 0 ? 'bg-up-dim' : 'bg-down-dim'
            }`}
          >
            {formatPercent(snapshot.changePercent)}
          </div>
        </Link>
      </div>
    </div>
  );
}
