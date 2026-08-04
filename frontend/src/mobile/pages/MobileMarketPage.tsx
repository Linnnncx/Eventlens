import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import {
  addToWatchlist,
  fetchMarketStatus,
  fetchPortfolio,
  fetchScreener,
  fetchSnapshots,
  fetchWatchlist,
  searchSymbols,
} from '../../api/endpoints';
import { INDEX_STRIP } from '../../features/market/indices';
import type { Snapshot } from '../../types/api';
import {
  changeColorClass,
  formatCompact,
  formatPercent,
  formatPrice,
  sessionLabel,
} from '../../utils/format';
import { MobileWatchlist } from '../components/MobileWatchlist';
import { Chip, EmptyState, ScrollRow, Segmented, Skeleton } from '../components/ui';

type MarketTab = 'watchlist' | 'market';

const TABS: { id: MarketTab; label: string }[] = [
  { id: 'watchlist', label: '自选' },
  { id: 'market', label: '市场' },
];

const SORTS: { id: string; label: string; pick: (s: Snapshot) => number }[] = [
  { id: 'changePercent', label: '涨跌幅', pick: (s) => s.changePercent },
  { id: 'turnover', label: '成交额', pick: (s) => s.turnover ?? s.price * s.volume },
  { id: 'marketCap', label: '市值', pick: (s) => s.marketCap ?? 0 },
  { id: 'price', label: '价格', pick: (s) => s.price },
];

const INDEX_FILTERS = [
  { id: '', label: '全部' },
  { id: 'DJI', label: '道指' },
  { id: 'SPX', label: '标普' },
  { id: 'IXIC', label: '纳指' },
];

function QuoteRow({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Link
      to={`/workbench/${snapshot.symbol}`}
      className="m-tap flex items-center gap-3 border-b border-border/50 px-4 py-2.5 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[14px] font-semibold leading-tight text-gray-50">
          {snapshot.symbol}
        </div>
        <div className="truncate text-[11px] leading-tight text-muted">{snapshot.name}</div>
      </div>
      <div className="tabular text-right">
        <div className="text-[14px] font-medium text-gray-100">{formatPrice(snapshot.price)}</div>
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
  );
}

export function MobileMarketPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MarketTab>('watchlist');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('changePercent');
  const [sortAsc, setSortAsc] = useState(false);
  const [indexFilter, setIndexFilter] = useState('');

  const { data: status } = useQuery({
    queryKey: ['marketStatus'],
    queryFn: fetchMarketStatus,
    refetchInterval: 60_000,
  });

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    refetchInterval: 60_000,
  });

  const { data: watchlist } = useQuery({ queryKey: ['watchlist'], queryFn: fetchWatchlist });

  const heldSymbols = useMemo(
    () => new Set((portfolio?.positions ?? []).map((p) => p.symbol)),
    [portfolio],
  );
  const watchSymbols = watchlist?.items ?? [];
  const indexSymbols = INDEX_STRIP.map((i) => i.symbol);

  // Positions always land on the watchlist so they stay one tap away.
  const syncedHeldRef = useRef<string>('');
  const syncHeld = useMutation({
    mutationFn: async (symbols: string[]) => {
      for (const symbol of symbols) {
        await addToWatchlist(symbol);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlist'] }),
  });

  useEffect(() => {
    if (!portfolio || !watchlist) return;
    const held = portfolio.positions.map((p) => p.symbol);
    const missing = held.filter((s) => !watchlist.items.includes(s));
    const key = missing.slice().sort().join(',');
    if (!key || key === syncedHeldRef.current || syncHeld.isPending) return;
    syncedHeldRef.current = key;
    syncHeld.mutate(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio?.positions.map((p) => p.symbol).join(','), watchlist?.items.join(',')]);

  const allSymbols = useMemo(
    () => [...new Set([...indexSymbols, ...watchSymbols, ...heldSymbols])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchSymbols.join(','), [...heldSymbols].join(',')],
  );

  const { data: snapshots, isLoading: snapLoading } = useQuery({
    queryKey: ['snapshots', allSymbols.join(',')],
    queryFn: () => fetchSnapshots(allSymbols),
    enabled: allSymbols.length > 0,
    refetchInterval: 30_000,
  });

  const { data: screener, isLoading: screenerLoading } = useQuery({
    queryKey: ['screener'],
    queryFn: () => fetchScreener(true),
    enabled: tab === 'market',
    staleTime: 60_000,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['symbol-search', query],
    queryFn: () => searchSymbols(query, 12),
    enabled: query.trim().length >= 1,
    staleTime: 30_000,
  });

  const snapMap = useMemo(
    () => new Map((snapshots?.snapshots ?? []).map((s) => [s.symbol, s])),
    [snapshots],
  );

  const marketRows = useMemo(() => {
    const rows = (screener?.snapshots ?? []).filter(
      (s) => !indexFilter || (s.indices ?? []).includes(indexFilter),
    );
    const pick = SORTS.find((s) => s.id === sort)?.pick ?? SORTS[0]!.pick;
    return [...rows]
      .sort((a, b) => (sortAsc ? pick(a) - pick(b) : pick(b) - pick(a)))
      .slice(0, 80);
  }, [screener, sort, sortAsc, indexFilter]);

  const onSortChip = (id: string) => {
    if (sort === id) setSortAsc((v) => !v);
    else {
      setSort(id);
      setSortAsc(false);
    }
  };

  return (
    <div className="pb-4">
      <header className="safe-top sticky top-0 z-20 border-b border-border/70 bg-surface-raised/95 px-3 pb-2 pt-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索代码或公司"
              className="input py-2 pl-9 pr-8 text-[14px]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted"
                aria-label="清除"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <span className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted">
            {status ? sessionLabel(status.session, status.isOpen) : '—'}
          </span>
        </div>
      </header>

      {query.trim() && (
        <div className="border-b border-border/60 bg-surface-card">
          {(searchResults?.items ?? []).length === 0 ? (
            <EmptyState text="没有匹配的标的" />
          ) : (
            (searchResults?.items ?? []).map((item) => (
              <button
                key={item.symbol}
                type="button"
                onClick={() => {
                  setQuery('');
                  navigate(`/workbench/${item.symbol}`);
                }}
                className="m-tap flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left last:border-b-0"
              >
                <span className="font-mono text-[14px] font-semibold text-gray-50">
                  {item.symbol}
                </span>
                <span className="truncate text-[12px] text-muted">{item.name}</span>
              </button>
            ))
          )}
        </div>
      )}

      <ScrollRow className="px-3 py-3">
        {INDEX_STRIP.map((idx) => {
          const snap = snapMap.get(idx.symbol);
          return (
            <Link
              key={idx.symbol}
              to={`/workbench/${idx.symbol}`}
              className="m-tap min-w-[7.5rem] shrink-0 rounded-xl border border-border/70 bg-surface-card px-3 py-2"
            >
              <div className="text-[11px] text-muted">{idx.label}</div>
              <div className="tabular text-[15px] font-semibold text-gray-50">
                {snap ? formatPrice(snap.price) : '—'}
              </div>
              <div
                className={`tabular text-[11px] font-medium ${changeColorClass(snap?.changePercent ?? 0)}`}
              >
                {snap ? formatPercent(snap.changePercent) : '—'}
              </div>
            </Link>
          );
        })}
      </ScrollRow>

      {portfolio && portfolio.positions.length > 0 && (
        <Link
          to="/trade"
          className="m-tap mx-3 mb-3 flex items-center justify-between rounded-xl border border-border/70 bg-surface-card px-3 py-2.5"
        >
          <div>
            <div className="text-[11px] text-muted">总资产</div>
            <div className="tabular text-[17px] font-semibold text-gray-50">
              ${formatPrice(portfolio.equity)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted">累计盈亏</div>
            <div className={`tabular text-[15px] font-semibold ${changeColorClass(portfolio.pnl)}`}>
              {portfolio.pnl >= 0 ? '+' : ''}
              {formatPrice(portfolio.pnl)}
            </div>
          </div>
        </Link>
      )}

      <div className="px-3">
        <Segmented items={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'market' && (
        <div className="space-y-2 px-3 pt-3">
          <ScrollRow>
            {INDEX_FILTERS.map((f) => (
              <Chip key={f.id} active={indexFilter === f.id} onClick={() => setIndexFilter(f.id)}>
                {f.label}
              </Chip>
            ))}
          </ScrollRow>
          <ScrollRow>
            {SORTS.map((s) => (
              <Chip key={s.id} active={sort === s.id} onClick={() => onSortChip(s.id)}>
                {s.label} {sort === s.id ? (sortAsc ? '↑' : '↓') : ''}
              </Chip>
            ))}
          </ScrollRow>
        </div>
      )}

      <div className="mt-3 overflow-hidden border-y border-border/60 bg-surface-card">
        {tab === 'watchlist' ? (
          snapLoading && watchSymbols.length === 0 ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <MobileWatchlist
              symbols={watchSymbols}
              snapMap={snapMap}
              heldSymbols={heldSymbols}
            />
          )
        ) : screenerLoading && marketRows.length === 0 ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : marketRows.length === 0 ? (
          <EmptyState text="暂无数据" />
        ) : (
          marketRows.map((row) => <QuoteRow key={row.symbol} snapshot={row} />)
        )}
      </div>
    </div>
  );
}
