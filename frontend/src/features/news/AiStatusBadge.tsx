interface AiStatusBadgeProps {
  ready: boolean;
  loading?: boolean;
  className?: string;
}

export function AiStatusBadge({ ready, loading = false, className = '' }: AiStatusBadgeProps) {
  if (loading) {
    return (
      <span
        className={`inline-flex items-center rounded-md border border-border/80 bg-surface-raised px-2 py-0.5 text-[11px] text-muted ${className}`}
      >
        读取中…
      </span>
    );
  }

  if (ready) {
    return (
      <span
        className={`inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ${className}`}
      >
        已配置AI
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 ${className}`}
    >
      未配置AI
    </span>
  );
}
