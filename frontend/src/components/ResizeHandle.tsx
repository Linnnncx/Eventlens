import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type ResizeAxis = 'x' | 'y';

interface ResizeHandleProps {
  axis: ResizeAxis;
  onDrag: (delta: number) => void;
  onDragEnd?: () => void;
  /** Double-click restores a caller-provided default. */
  onReset?: () => void;
  title?: string;
}

/**
 * Thin drag strip between panels. Pointer capture keeps resizing smooth even when
 * the cursor leaves the handle.
 */
export function ResizeHandle({ axis, onDrag, onDragEnd, onReset, title }: ResizeHandleProps) {
  const lastRef = useRef(0);
  const draggingRef = useRef(false);
  const pendingRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    const d = pendingRef.current;
    if (d === 0) return;
    pendingRef.current = 0;
    onDrag(d);
  }, [onDrag]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      pendingRef.current = 0;
      lastRef.current = axis === 'x' ? e.clientX : e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [axis],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const pos = axis === 'x' ? e.clientX : e.clientY;
      const delta = pos - lastRef.current;
      if (delta === 0) return;
      lastRef.current = pos;
      pendingRef.current += delta;
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [axis, flush],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (pendingRef.current !== 0) {
        const d = pendingRef.current;
        pendingRef.current = 0;
        onDrag(d);
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onDragEnd?.();
    },
    [onDrag, onDragEnd],
  );

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const isX = axis === 'x';
  return (
    <div
      role="separator"
      aria-orientation={isX ? 'vertical' : 'horizontal'}
      title={title ?? (onReset ? '拖拽调整 · 双击还原' : '拖拽调整')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onReset?.()}
      className={
        isX
          ? // self-stretch is required — without height a flex-row child collapses to 0px
            // and the left/right handles become unclickable.
            'group relative z-40 w-2 shrink-0 grow-0 self-stretch cursor-col-resize bg-border/50 hover:bg-primary/60 active:bg-primary'
          : 'group relative z-40 h-2 shrink-0 grow-0 cursor-row-resize bg-border/50 hover:bg-primary/60 active:bg-primary'
      }
    >
      <div
        className={
          isX
            ? 'absolute inset-y-0 -left-1.5 -right-1.5'
            : 'absolute inset-x-0 -top-1.5 -bottom-1.5'
        }
      />
    </div>
  );
}

export interface WorkbenchLayout {
  leftWidth: number;
  rightWidth: number;
  chartHeight: number;
  indicatorHeight: number;
  bottomHeight: number;
}

export const DEFAULT_LAYOUT: WorkbenchLayout = {
  leftWidth: 320,
  rightWidth: 520,
  chartHeight: 360,
  indicatorHeight: 240,
  bottomHeight: 1300,
};

const STORAGE_KEY = 'eventlens.workbench.layout.v3';

const LIMITS = {
  leftWidth: { min: 160, max: 560 },
  rightWidth: { min: 320, max: 800 },
  chartHeight: { min: 180, max: 900 },
  indicatorHeight: { min: 100, max: 1200 },
  // The lower workspace is intentionally fixed: its content scrolls internally
  // instead of making the page progressively deeper.
  bottomHeight: { min: 1300, max: 1300 },
} as const;

function clamp(key: keyof WorkbenchLayout, value: number): number {
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

function loadLayout(): WorkbenchLayout {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem('eventlens.workbench.layout.v2') ??
      localStorage.getItem('eventlens.workbench.layout.v1');
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<WorkbenchLayout>;
    return {
      leftWidth: clamp('leftWidth', parsed.leftWidth ?? DEFAULT_LAYOUT.leftWidth),
      // Migrate previous default 416 → wider order-book panel
      rightWidth: clamp(
        'rightWidth',
        parsed.rightWidth === 416 ? 520 : (parsed.rightWidth ?? DEFAULT_LAYOUT.rightWidth),
      ),
      chartHeight: clamp('chartHeight', parsed.chartHeight ?? DEFAULT_LAYOUT.chartHeight),
      indicatorHeight: clamp(
        'indicatorHeight',
        parsed.indicatorHeight ?? DEFAULT_LAYOUT.indicatorHeight,
      ),
      // Older layouts defaulted to 200/220px, which only exposed a thin strip of News.
      bottomHeight: clamp(
        'bottomHeight',
        (parsed.bottomHeight ?? 0) <= 220
          ? DEFAULT_LAYOUT.bottomHeight
          : (parsed.bottomHeight ?? DEFAULT_LAYOUT.bottomHeight),
      ),
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function useWorkbenchLayout() {
  const [layout, setLayout] = useState<WorkbenchLayout>(loadLayout);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const setField = useCallback((key: keyof WorkbenchLayout, value: number) => {
    setLayout((prev) => {
      const next = clamp(key, value);
      if (prev[key] === next) return prev;
      return { ...prev, [key]: next };
    });
  }, []);

  const nudge = useCallback((key: keyof WorkbenchLayout, delta: number) => {
    setLayout((prev) => {
      const next = clamp(key, prev[key] + delta);
      if (prev[key] === next) return prev;
      return { ...prev, [key]: next };
    });
  }, []);

  /** Apply several deltas in one render (e.g. chart↑ indicator↓). */
  const nudgeMany = useCallback((deltas: Partial<Record<keyof WorkbenchLayout, number>>) => {
    setLayout((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(deltas) as (keyof WorkbenchLayout)[]) {
        const d = deltas[key];
        if (d == null || d === 0) continue;
        const value = clamp(key, prev[key] + d);
        if (value !== next[key]) {
          next[key] = value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const reset = useCallback((key?: keyof WorkbenchLayout) => {
    if (!key) {
      setLayout({ ...DEFAULT_LAYOUT });
      return;
    }
    setLayout((prev) => ({ ...prev, [key]: DEFAULT_LAYOUT[key] }));
  }, []);

  const resetAll = useCallback(() => setLayout({ ...DEFAULT_LAYOUT }), []);

  return { layout, setField, nudge, nudgeMany, reset, resetAll };
}
