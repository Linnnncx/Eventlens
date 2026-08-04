import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { fetchNews, fetchPortfolio, fetchSymbols, fetchWatchlist } from '../../api/endpoints';
import type { NewsItem } from '../../types/api';
import { isIndexSymbol } from '../../features/market/indices';
import { NewsCard, NewsDetailSheet, rankNews } from '../components/MobileNews';
import { Chip, EmptyState, ScrollRow, Skeleton } from '../components/ui';

type Filter = 'all' | 'watchlist' | 'high';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'watchlist', label: '我的自选' },
  { id: 'high', label: '高重要性' },
];

const MAX_FEED_SYMBOLS = 12;

export function MobileNewsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [openNews, setOpenNews] = useState<NewsItem | null>(null);
  const [showLow, setShowLow] = useState(false);
  const [feedLimit, setFeedLimit] = useState(4);

  const { data: watchlist } = useQuery({ queryKey: ['watchlist'], queryFn: fetchWatchlist });
  const { data: portfolio } = useQuery({ queryKey: ['portfolio'], queryFn: fetchPortfolio });
  const { data: coreSymbols } = useQuery({
    queryKey: ['symbols', 'core'],
    queryFn: () => fetchSymbols(true),
  });

  const watchSymbols = useMemo(() => {
    const held = (portfolio?.positions ?? []).map((p) => p.symbol);
    return [...new Set([...(watchlist?.items ?? []), ...held])].filter((s) => !isIndexSymbol(s));
  }, [watchlist, portfolio]);

  const coreList = useMemo(
    () =>
      (coreSymbols?.items ?? [])
        .map((s) => s.symbol)
        .filter((s) => !isIndexSymbol(s)),
    [coreSymbols],
  );

  // Always fetch a broad pool; filter client-side so chip switches feel instant.
  const feedSymbols = useMemo(() => {
    const pool =
      filter === 'watchlist'
        ? watchSymbols
        : [...new Set([...watchSymbols, ...coreList])];
    return pool.slice(0, MAX_FEED_SYMBOLS);
  }, [filter, watchSymbols, coreList]);

  useEffect(() => setFeedLimit(4), [filter, feedSymbols.join(',')]);

  const results = useQueries({
    queries: feedSymbols.slice(0, feedLimit).map((symbol) => ({
      queryKey: ['news', symbol],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchNews(symbol, 20, signal),
      staleTime: 180_000,
    })),
  });

  const batchSettled = results.length > 0 && results.every((r) => !r.isPending && !r.isFetching);
  useEffect(() => {
    if (!batchSettled || feedLimit >= feedSymbols.length) return;
    const timer = window.setTimeout(
      () => setFeedLimit((current) => Math.min(current + 4, feedSymbols.length)),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [batchSettled, feedLimit, feedSymbols.length]);

  const loading = results.some((r) => r.isLoading || r.isFetching);
  const watchSet = useMemo(() => new Set(watchSymbols), [watchSymbols]);
  const newsStamp = results
    .map((r) => `${r.dataUpdatedAt}:${r.data?.items?.length ?? 0}`)
    .join('|');

  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: NewsItem[] = [];
    for (const result of results) {
      for (const item of result.data?.items ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
      }
    }

    let ranked = rankNews(merged);

    if (filter === 'watchlist') {
      ranked = ranked.filter((item) => item.symbols.some((s) => watchSet.has(s)));
    } else if (filter === 'high') {
      ranked = ranked.filter((item) => item.importance === 'high');
    }

    return ranked;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsStamp, filter, watchSet]);

  // For "高重要性" everything shown is already high — don't bury low separately.
  const primary =
    filter === 'high' ? items : items.filter((i) => i.importance !== 'low');
  const secondary = filter === 'high' ? [] : items.filter((i) => i.importance === 'low');

  return (
    <div className="pb-6">
      <header className="safe-top sticky top-0 z-20 border-b border-border/70 bg-surface-raised/95 px-3 pb-2 pt-3 backdrop-blur-md">
        <h1 className="mb-2 text-[17px] font-semibold text-gray-50">资讯</h1>
        <ScrollRow>
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              active={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setShowLow(false);
              }}
            >
              {f.label}
            </Chip>
          ))}
        </ScrollRow>
        <div className="mt-1.5 text-[11px] text-muted">
          {filter === 'all' && `共 ${items.length} 条`}
          {filter === 'watchlist' &&
            (watchSymbols.length === 0
              ? '自选为空'
              : `自选相关 ${items.length} 条`)}
          {filter === 'high' && `高重要性 ${items.length} 条`}
        </div>
      </header>

      <div className="space-y-2 px-3 pt-3">
        {loading && items.length === 0 ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : items.length === 0 ? (
          <EmptyState
            text={
              filter === 'watchlist'
                ? '自选暂无相关资讯'
                : filter === 'high'
                  ? '暂无高重要性资讯'
                  : '暂无资讯'
            }
          />
        ) : (
          <>
            {primary.map((item) => (
              <NewsCard key={item.id} item={item} onOpen={setOpenNews} showSymbol />
            ))}

            {secondary.length > 0 && (
              <>
                {showLow &&
                  secondary.map((item) => (
                    <NewsCard key={item.id} item={item} onOpen={setOpenNews} showSymbol />
                  ))}
                <button
                  type="button"
                  onClick={() => setShowLow((v) => !v)}
                  className="m-tap w-full rounded-xl border border-border/70 bg-surface-raised py-2.5 text-[13px] text-muted"
                >
                  {showLow ? '收起一般资讯' : `查看更多（${secondary.length} 条一般资讯）`}
                </button>
              </>
            )}
          </>
        )}
      </div>

      <NewsDetailSheet
        item={openNews}
        timeframe="1Day"
        onClose={() => setOpenNews(null)}
        onJumpToChart={(item) => {
          const symbol = item.symbols[0];
          setOpenNews(null);
          if (symbol) navigate(`/workbench/${symbol}`);
        }}
      />
    </div>
  );
}
