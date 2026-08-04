import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Sheets that own their own scrolling (chat, long lists) pass false. */
  scroll?: boolean;
}

export function Sheet({ open, onClose, title, children, scroll = true }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div className="m-sheet safe-bottom" role="dialog" aria-modal="true">
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
          <div className="min-w-0 text-base font-semibold text-gray-100">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="m-tap -mr-2 flex h-9 w-9 items-center justify-center rounded-full text-muted"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={scroll ? 'min-h-0 flex-1 overflow-y-auto px-4 pb-3' : 'min-h-0 flex-1'}>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

export interface SegmentedProps<T extends string> {
  items: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  className = '',
}: SegmentedProps<T>) {
  return (
    <div className={`seg-control ${className}`}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={`seg-btn m-tap ${value === item.id ? 'seg-btn-active' : 'seg-btn-idle'}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export interface ChipProps {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function Chip({ active, onClick, children, className = '' }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`m-tap shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? 'border-primary/50 bg-primary/15 text-primary'
          : 'border-border bg-surface-raised text-muted'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function ScrollRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`no-scrollbar flex gap-2 overflow-x-auto ${className}`}>{children}</div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-hover/60 ${className}`} />;
}

export function EmptyState({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-muted">{text}</div>;
}

export interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  decimals?: number;
  suffix?: string;
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  decimals = 0,
  suffix,
}: StepperProps) {
  const nudge = (dir: number) => {
    const next = Number((value + dir * step).toFixed(decimals + 4));
    onChange(Math.max(min, next));
  };

  return (
    <div className="flex items-stretch overflow-hidden rounded-xl border border-border bg-surface-raised">
      <button
        type="button"
        onClick={() => nudge(-1)}
        className="m-tap w-12 shrink-0 text-xl font-medium text-muted"
        aria-label="减少"
      >
        −
      </button>
      <div className="flex flex-1 items-center justify-center gap-1 border-x border-border py-3">
        <input
          className="tabular w-full bg-transparent text-center text-lg font-semibold text-gray-100 outline-none"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.max(min, n));
          }}
        />
        {suffix && <span className="pr-1 text-xs text-muted">{suffix}</span>}
      </div>
      <button
        type="button"
        onClick={() => nudge(1)}
        className="m-tap w-12 shrink-0 text-xl font-medium text-muted"
        aria-label="增加"
      >
        +
      </button>
    </div>
  );
}
