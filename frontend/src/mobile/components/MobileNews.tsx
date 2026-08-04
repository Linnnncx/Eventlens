import { useQuery } from '@tanstack/react-query';
import { ExternalLink, LineChart } from 'lucide-react';
import { fetchEventReaction } from '../../api/endpoints';
import type { NewsItem } from '../../types/api';
import { formatMarketTime, formatPercent, changeColorClass } from '../../utils/format';
import { Sheet } from './ui';

const IMPORTANCE_DOT: Record<string, string> = {
  high: 'bg-down',
  medium: 'bg-amber-400',
  low: 'bg-border',
};

const IMPORTANCE_LABEL: Record<string, string> = {
  high: '重要',
  medium: '关注',
  low: '一般',
};

const DIRECTION_STYLE: Record<string, string> = {
  positive: 'bg-up/15 text-up',
  negative: 'bg-down/15 text-down',
  neutral: 'bg-surface-hover text-muted',
  uncertain: 'bg-surface-hover text-muted',
};

const DIRECTION_LABEL: Record<string, string> = {
  positive: '利好',
  negative: '利空',
  neutral: '中性',
  uncertain: '待定',
};

/** Sort by importance first, then recency — mobile only has room for the top few. */
export function rankNews(items: NewsItem[]): NewsItem[] {
  const weight: Record<string, number> = { high: 3, medium: 2, low: 1 };
  return [...items].sort((a, b) => {
    const diff = (weight[b.importance] ?? 0) - (weight[a.importance] ?? 0);
    if (diff !== 0) return diff;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

export function NewsCard({
  item,
  onOpen,
  showSymbol = false,
}: {
  item: NewsItem;
  onOpen: (item: NewsItem) => void;
  showSymbol?: boolean;
}) {
  const summary = item.summaryAi ?? item.summaryOriginal ?? '';

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="m-tap w-full rounded-xl border border-border/70 bg-surface-card px-3 py-2.5 text-left"
    >
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${IMPORTANCE_DOT[item.importance] ?? 'bg-border'}`} />
        <span>{IMPORTANCE_LABEL[item.importance] ?? '一般'}</span>
        {showSymbol && item.symbols[0] && (
          <span className="font-mono font-medium text-gray-300">{item.symbols[0]}</span>
        )}
        <span className="truncate">{item.source}</span>
        <span className="ml-auto shrink-0">{formatMarketTime(item.publishedAt, 'MM-dd HH:mm')}</span>
      </div>
      <div className="line-clamp-2 text-[14px] font-medium leading-snug text-gray-100">
        {item.headline}
      </div>
      {summary && <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted">{summary}</div>}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className={`badge ${DIRECTION_STYLE[item.direction] ?? 'bg-surface-hover text-muted'}`}>
          {DIRECTION_LABEL[item.direction] ?? '待定'}
        </span>
        {item.eventType && <span className="badge bg-surface-hover text-muted">{item.eventType}</span>}
      </div>
    </button>
  );
}

function ReactionRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-surface-raised px-2 py-1.5 text-center">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`tabular text-[13px] font-semibold ${value == null ? 'text-muted' : changeColorClass(value)}`}>
        {value == null ? '—' : formatPercent(value)}
      </div>
    </div>
  );
}

export function NewsDetailSheet({
  item,
  symbol,
  timeframe,
  onClose,
  onJumpToChart,
}: {
  item: NewsItem | null;
  symbol?: string;
  timeframe: string;
  onClose: () => void;
  onJumpToChart?: (item: NewsItem) => void;
}) {
  const reactionSymbol = symbol ?? item?.symbols[0] ?? '';

  const { data: reaction } = useQuery({
    queryKey: ['event-reaction', reactionSymbol, item?.id, timeframe],
    queryFn: () => fetchEventReaction(reactionSymbol, item!.id, timeframe),
    enabled: Boolean(item && reactionSymbol),
    staleTime: 300_000,
    retry: false,
  });

  if (!item) return null;

  return (
    <Sheet open onClose={onClose} title="事件详情">
      <div className="pb-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span className={`badge ${DIRECTION_STYLE[item.direction] ?? 'bg-surface-hover text-muted'}`}>
            {DIRECTION_LABEL[item.direction] ?? '待定'}
          </span>
          <span className="badge bg-surface-hover text-muted">
            {IMPORTANCE_LABEL[item.importance] ?? '一般'}
          </span>
          <span>{item.source}</span>
          <span>·</span>
          <span>{formatMarketTime(item.publishedAt)}</span>
        </div>

        <h2 className="text-[16px] font-semibold leading-snug text-gray-50">{item.headline}</h2>

        {(item.summaryAi ?? item.summaryOriginal) && (
          <p className="mt-2 text-[13px] leading-relaxed text-gray-300">
            {item.summaryAi ?? item.summaryOriginal}
          </p>
        )}

        {item.keyPoints.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[12px] font-medium text-gray-200">关键点</div>
            <ul className="space-y-1">
              {item.keyPoints.map((point, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-snug text-muted">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        {reaction && (
          <div className="mt-3">
            <div className="mb-1.5 text-[12px] font-medium text-gray-200">事件前后价格反应</div>
            <div className="grid grid-cols-4 gap-1.5">
              <ReactionRow label="前30分" value={reaction.pre30m} />
              <ReactionRow label="后5分" value={reaction.post5m} />
              <ReactionRow label="后30分" value={reaction.post30m} />
              <ReactionRow label="后60分" value={reaction.post60m} />
            </div>
            {reaction.volumeRatio != null && (
              <div className="mt-1.5 text-[11px] text-muted">
                成交量放大 {reaction.volumeRatio.toFixed(2)}×
              </div>
            )}
          </div>
        )}

        {item.uncertainties.length > 0 && (
          <div className="mt-3 rounded-lg border border-border/70 bg-surface-raised px-3 py-2">
            <div className="mb-1 text-[12px] font-medium text-amber-300">不确定性</div>
            <ul className="space-y-1">
              {item.uncertainties.map((point, i) => (
                <li key={i} className="text-[12px] leading-snug text-muted">
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {onJumpToChart && (
            <button
              type="button"
              onClick={() => onJumpToChart(item)}
              className="btn-primary m-tap flex-1 py-2.5"
            >
              <LineChart className="h-4 w-4" />
              查看 K 线位置
            </button>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost m-tap flex-1 border border-border py-2.5"
            >
              <ExternalLink className="h-4 w-4" />
              原文
            </a>
          )}
        </div>
      </div>
    </Sheet>
  );
}
