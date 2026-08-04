import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | void;
  children: ReactNode;
  /** Disable when a nested sheet / chart owns the gesture. */
  disabled?: boolean;
  className?: string;
}

const THRESHOLD = 72;

/**
 * Lightweight pull-to-refresh for the mobile tab pages.
 * Only arms when the scroll container is already at the top.
 */
export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
  className = '',
}: PullToRefreshProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef(0);
  const pulling = useRef(false);
  const offsetRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const updateOffset = useCallback((next: number) => {
    offsetRef.current = next;
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setOffset(offsetRef.current);
    });
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    },
  );

  const finish = useCallback(async () => {
    if (refreshing) return;
    if (offsetRef.current < THRESHOLD) {
      updateOffset(0);
      return;
    }
    setRefreshing(true);
    updateOffset(THRESHOLD * 0.7);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      updateOffset(0);
    }
  }, [onRefresh, refreshing, updateOffset]);

  const onTouchStart = (e: TouchEvent) => {
    if (disabled || refreshing) return;
    const el = scrollerRef.current;
    if (!el || el.scrollTop > 0) {
      pulling.current = false;
      return;
    }
    startY.current = e.touches[0]?.clientY ?? 0;
    pulling.current = true;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!pulling.current || disabled || refreshing) return;
    const el = scrollerRef.current;
    if (!el || el.scrollTop > 0) {
      pulling.current = false;
      updateOffset(0);
      return;
    }
    const y = e.touches[0]?.clientY ?? 0;
    const delta = y - startY.current;
    if (delta <= 0) {
      updateOffset(0);
      return;
    }
    // Rubber-band: diminishing returns past the threshold.
    const next = Math.min(THRESHOLD * 1.4, delta * 0.55);
    updateOffset(next);
    if (next > 8) e.preventDefault();
  };

  const onTouchEnd = () => {
    if (!pulling.current) return;
    pulling.current = false;
    void finish();
  };

  return (
    <div
      ref={scrollerRef}
      className={`relative h-full overflow-y-auto overscroll-y-contain ${className}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className="pointer-events-none sticky top-0 z-10 flex h-0 items-end justify-center overflow-visible"
        aria-hidden
      >
        <div
          className="flex items-center gap-1.5 text-[12px] text-muted transition-opacity"
          style={{
            transform: `translateY(${Math.max(offset - 8, 0)}px)`,
            opacity: offset > 12 || refreshing ? 1 : 0,
          }}
        >
          {refreshing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              刷新中
            </>
          ) : (
            <>
              <ArrowDown
                className={`h-3.5 w-3.5 transition-transform ${offset >= THRESHOLD ? 'rotate-180' : ''}`}
              />
              {offset >= THRESHOLD ? '松开刷新' : '下拉刷新'}
            </>
          )}
        </div>
      </div>
      <div style={{ transform: offset || refreshing ? `translateY(${offset}px)` : undefined }}>
        {children}
      </div>
    </div>
  );
}
