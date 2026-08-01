import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Sparkles, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { analyzeNews, fetchEventReaction, fetchNewsContent } from '../../api/endpoints';
import { EmptyState } from '../../components/EmptyState';
import type { NewsItem, Timeframe } from '../../types/api';
import {
  directionColor,
  directionLabel,
  formatMarketTime,
  formatPercent,
  importanceColor,
} from '../../utils/format';

interface NewsPanelProps {
  symbol: string;
  event: NewsItem | null;
  timeframe: Timeframe;
}

export function NewsPanel({ symbol, event, timeframe }: NewsPanelProps) {
  const queryClient = useQueryClient();

  const reactionQuery = useQuery({
    queryKey: ['reaction', symbol, event?.id, timeframe],
    queryFn: () => fetchEventReaction(symbol, event!.id, timeframe),
    enabled: Boolean(event?.id),
    retry: false,
  });

  const contentQuery = useQuery({
    queryKey: ['news-content', event?.id],
    queryFn: () => fetchNewsContent(event!.id),
    enabled: Boolean(event?.id),
    staleTime: Infinity,
    retry: false,
  });

  const paragraphs = (contentQuery.data?.body ?? '')
    .split('\n\n')
    .map((p) => p.trim())
    .filter(Boolean);

  const analyzeMut = useMutation({
    mutationFn: () => analyzeNews(event!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', symbol] });
      queryClient.invalidateQueries({ queryKey: ['news', symbol] });
    },
  });

  if (!event) {
    return (
      <EmptyState
        title="点击或悬停查看新闻"
        description="悬停带虚线点的 K 线，或在下方 News 列表中点击一条。"
      />
    );
  }

  const DirectionIcon =
    event.direction === 'positive'
      ? TrendingUp
      : event.direction === 'negative'
        ? TrendingDown
        : Minus;

  const reaction = reactionQuery.data;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={`badge-news uppercase ${importanceColor(event.importance)}`}>
            {event.importance}
          </span>
          <span className="text-muted">{event.eventType.replace('_', ' ')}</span>
          <span className="text-muted">·</span>
          <span className={directionColor(event.direction)}>
            <DirectionIcon className="mr-0.5 inline h-3 w-3" />
            {directionLabel(event.direction)}
          </span>
        </div>
        <h2 className="text-base font-semibold leading-snug text-gray-100">{event.headline}</h2>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span>{event.source}</span>
          <span>·</span>
          <time>{formatMarketTime(event.publishedAt, 'MMM d, yyyy HH:mm')}</time>
          {event.url && (
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 text-primary hover:underline"
            >
              Source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {event.imageUrl && (
          <section className="overflow-hidden rounded-md border border-border">
            <img
              src={event.imageUrl}
              alt=""
              className="max-h-48 w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </section>
        )}

        {(event.summaryAi || event.summaryOriginal) && (
          <section>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Summary</h3>
            <p className="text-sm leading-relaxed text-gray-300">
              {event.summaryAi ?? event.summaryOriginal}
            </p>
          </section>
        )}

        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Article</h3>
          {contentQuery.isLoading ? (
            <p className="text-sm text-muted">正在读取正文…</p>
          ) : paragraphs.length > 0 ? (
            <div className="space-y-2">
              {paragraphs.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-gray-300">
                  {p}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">
              该来源未提供可抓取的正文
              {event.url ? '，可点击右上角 Source 查看原文。' : '。'}
            </p>
          )}
        </section>

        <button
          type="button"
          onClick={() => analyzeMut.mutate()}
          disabled={analyzeMut.isPending}
          className="btn-primary w-full"
        >
          <Sparkles className="h-4 w-4" />
          {analyzeMut.isPending ? 'Analyzing…' : 'AI Summary'}
        </button>

        {analyzeMut.data && (
          <section className="rounded-md border border-news/30 bg-news/5 p-3">
            <h3 className="mb-1 text-xs font-medium text-news">AI Analysis</h3>
            <p className="text-sm text-gray-300">{analyzeMut.data.summaryZh}</p>
            {analyzeMut.data.keyPoints.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-sm text-muted">
                {analyzeMut.data.keyPoints.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {reactionQuery.isLoading && (
          <p className="text-sm text-muted">Loading reaction metrics…</p>
        )}

        {reaction && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Event Reaction
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Post 5m" value={reaction.post5m} />
              <Metric label="Post 30m" value={reaction.post30m} />
              <Metric label="Post 60m" value={reaction.post60m} />
              <Metric label="Max up" value={reaction.maxUp} />
              <Metric label="Max drawdown" value={reaction.maxDrawdown} />
              <Metric label="Volume ratio" value={reaction.volumeRatio} isRatio />
            </div>
            <p className="mt-2 text-[10px] text-muted">{reaction.disclaimer}</p>
          </section>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  isRatio = false,
}: {
  label: string;
  value: number | null;
  isRatio?: boolean;
}) {
  if (value === null || value === undefined) {
    return (
      <div className="rounded border border-border bg-surface-raised px-2 py-1.5">
        <div className="text-[10px] text-muted">{label}</div>
        <div className="tabular text-sm text-muted">—</div>
      </div>
    );
  }

  const display = isRatio ? `${value.toFixed(2)}×` : formatPercent(value * 100);
  const color = isRatio ? 'text-gray-200' : value >= 0 ? 'text-up' : 'text-down';

  return (
    <div className="rounded border border-border bg-surface-raised px-2 py-1.5">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`tabular text-sm font-medium ${color}`}>{display}</div>
    </div>
  );
}
