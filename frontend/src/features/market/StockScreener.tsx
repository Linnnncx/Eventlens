import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { fetchScreener, searchSymbols } from '../../api/endpoints';
import type { Snapshot } from '../../types/api';
import { changeColorClass, formatCompact, formatPercent, formatPrice } from '../../utils/format';

export type ScreenerSortKey =
  | 'changePercent'
  | 'price'
  | 'volume'
  | 'turnover'
  | 'marketCap'
  | 'symbol'
  | 'name';

type SideTab = 'watchlist' | 'market';

const SORT_OPTIONS: { key: ScreenerSortKey; label: string }[] = [
  { key: 'price', label: '价格' },
  { key: 'changePercent', label: '涨跌幅' },
  { key: 'volume', label: '成交量' },
  { key: 'turnover', label: '成交额' },
  { key: 'marketCap', label: '市值' },
  { key: 'symbol', label: '代码' },
  { key: 'name', label: '名称' },
];

const INDEX_FILTERS: { key: string; label: string }[] = [
  { key: 'index:DJI', label: '道琼斯' },
  { key: 'index:SPX', label: '标普500' },
  { key: 'index:IXIC', label: '纳斯达克' },
];

const TAB_KEY = 'eventlens.left.tab';

function loadTab(): SideTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v === 'watchlist' || v === 'market') return v;
  } catch {
    /* ignore */
  }
  return 'market';
}

function sortValue(row: Snapshot, key: ScreenerSortKey): number | string {
  switch (key) {
    case 'changePercent':
      return row.changePercent;
    case 'price':
      return row.price;
    case 'volume':
      return row.volume;
    case 'turnover':
      return row.turnover ?? row.price * row.volume;
    case 'marketCap':
      return row.marketCap ?? row.turnover ?? row.price * row.volume;
    case 'symbol':
      return row.symbol;
    case 'name':
      return (row.name || row.symbol).toLowerCase();
  }
}

function placeholderRow(symbol: string): Snapshot {
  return {
    symbol,
    name: symbol,
    price: 0,
    previousClose: 0,
    change: 0,
    changePercent: 0,
    dayHigh: 0,
    dayLow: 0,
    volume: 0,
    sector: 'Unknown',
    provider: 'local',
    timestamp: new Date().toISOString(),
  };
}

const ScreenerRow = memo(function ScreenerRow({
  row,
  active,
  held,
  metric,
  onSelect,
  onPrefetch,
  onCancelPrefetch,
}: {
  row: Snapshot;
  active: boolean;
  held: boolean;
  metric: ScreenerSortKey | null;
  onSelect: (symbol: string) => void;
  onPrefetch: (symbol: string) => void;
  onCancelPrefetch: () => void;
}) {
  const hasQuote = row.price > 0 || row.provider !== 'local';
  return (
    <button
      type="button"
      onClick={() => onSelect(row.symbol)}
      onMouseEnter={() => onPrefetch(row.symbol)}
      onMouseLeave={onCancelPrefetch}
      onFocus={() => onPrefetch(row.symbol)}
      className={`flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-surface-hover ${
        active
          ? 'bg-primary/10 ring-1 ring-inset ring-primary/25'
          : held
            ? 'bg-amber-400/[0.06]'
            : ''
      } screener-row`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-sm font-semibold leading-tight ${
              active ? 'text-primary' : held ? 'text-amber-300' : ''
            }`}
          >
            {row.symbol}
          </span>
          {held ? (
            <span className="rounded bg-amber-400/15 px-1 py-0.5 text-[9px] font-medium leading-none text-amber-300">
              持仓
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted">{row.name}</div>
      </div>
      <div className="shrink-0 text-right tabular">
        <div className="text-sm font-medium leading-tight">
          {hasQuote ? formatPrice(row.price) : '—'}
        </div>
        <div className={`text-xs ${hasQuote ? changeColorClass(row.changePercent) : 'text-muted'}`}>
          {hasQuote ? formatPercent(row.changePercent) : '—'}
        </div>
      </div>
      {metric ? (
        <div className="w-12 shrink-0 text-right text-[11px] tabular text-muted">
          {metric === 'volume' && formatCompact(row.volume)}
          {metric === 'turnover' && formatCompact(row.turnover ?? row.price * row.volume)}
          {metric === 'marketCap' &&
            formatCompact(row.marketCap ?? row.turnover ?? row.price * row.volume)}
        </div>
      ) : null}
    </button>
  );
});

export function StockScreener({
  current,
  watchSymbols = [],
  heldSymbols,
  onSelect,
  onPrefetch,
}: {
  current: string;
  watchSymbols?: string[];
  heldSymbols?: Set<string>;
  onSelect: (symbol: string) => void;
  onPrefetch?: (symbol: string) => void;
}) {
  const [tab, setTab] = useState<SideTab>(loadTab);
  const [sortKey, setSortKey] = useState<ScreenerSortKey>('price');
  const [sortAsc, setSortAsc] = useState(false);
  const [sector, setSector] = useState('all');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const prefetchTimerRef = useRef<number | null>(null);

  const schedulePrefetch = useCallback((symbol: string) => {
    if (prefetchTimerRef.current != null) window.clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = window.setTimeout(() => onPrefetch?.(symbol), 300);
  }, [onPrefetch]);

  const cancelPrefetch = useCallback(() => {
    if (prefetchTimerRef.current != null) {
      window.clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const switchTab = (next: SideTab) => {
    setTab(next);
    setQuery('');
    setSearchOpen(false);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['screener', 'equities'],
    queryFn: ({ signal }) => fetchScreener(true, signal),
    staleTime: 45_000,
    refetchInterval: 60_000,
  });

  const { data: remoteSearch } = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => searchSymbols(debounced, 10, signal),
    enabled: debounced.length >= 1 && searchOpen,
    staleTime: 30_000,
  });

  const rows = data?.snapshots ?? [];
  const snapMap = useMemo(() => new Map(rows.map((r) => [r.symbol, r])), [rows]);

  const sectors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.sector && r.sector !== 'Unknown') set.add(r.sector);
    }
    return Array.from(set).sort();
  }, [rows]);

  const baseRows = useMemo(() => {
    if (tab === 'watchlist') {
      return watchSymbols.map((s) => snapMap.get(s) ?? placeholderRow(s));
    }
    return rows;
  }, [tab, watchSymbols, snapMap, rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = baseRows;
    if (tab === 'market') {
      if (sector.startsWith('index:')) {
        const tag = sector.slice('index:'.length);
        list = list.filter((r) => (r.indices ?? []).includes(tag));
      } else if (sector !== 'all') {
        list = list.filter((r) => r.sector === sector);
      }
    }
    if (q) {
      list = list.filter(
        (r) =>
          r.symbol.toLowerCase().includes(q) ||
          (r.name || '').toLowerCase().includes(q),
      );
    }
    const dir = sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb) * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });
  }, [baseRows, tab, sector, query, sortKey, sortAsc]);

  const toggleSort = (key: ScreenerSortKey) => {
    if (key === sortKey) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === 'symbol' || key === 'name');
    }
  };

  const remoteItems = remoteSearch?.items ?? [];
  const showRemote =
    searchOpen &&
    debounced.length >= 1 &&
    remoteItems.some(
      (item) =>
        !filtered.some((r) => r.symbol === item.symbol) ||
        item.symbol.toUpperCase() === debounced.toUpperCase(),
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2.5 border-b border-border/80 px-2.5 py-2.5">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => switchTab('watchlist')}
            className={`rounded-md px-2 py-1.5 text-xs font-medium ${
              tab === 'watchlist' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-gray-200'
            }`}
          >
            自选
            {watchSymbols.length > 0 ? (
              <span className="ml-1 tabular text-[11px] opacity-70">{watchSymbols.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => switchTab('market')}
            className={`rounded-md px-2 py-1.5 text-xs font-medium ${
              tab === 'market' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-gray-200'
            }`}
          >
            市场
          </button>
        </div>

        <div ref={searchWrapRef} className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const hit =
                  filtered[0]?.symbol ??
                  remoteItems[0]?.symbol ??
                  (query.trim() ? query.trim().toUpperCase() : null);
                if (hit) {
                  onSelect(hit);
                  setQuery('');
                  setSearchOpen(false);
                }
              }
            }}
            placeholder={
              tab === 'watchlist'
                ? `搜索自选 · ${filtered.length}`
                : isLoading
                  ? '加载股票…'
                  : `代码 / 名称 · ${filtered.length}`
            }
            className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-2 text-sm outline-none focus:border-primary"
          />
          {showRemote && remoteItems.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-card shadow-float">
              {remoteItems.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-hover"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(item.symbol);
                    setQuery('');
                    setSearchOpen(false);
                  }}
                >
                  <span className="font-semibold">{item.symbol}</span>
                  <span className="truncate pl-2 text-xs text-muted">{item.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === 'market' && (
          <>
            <div className="flex flex-wrap gap-1">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggleSort(opt.key)}
                  className={`rounded-md px-2 py-1 text-[11px] ${
                    sortKey === opt.key
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted hover:bg-surface-hover hover:text-gray-200'
                  }`}
                >
                  {opt.label}
                  {sortKey === opt.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                </button>
              ))}
            </div>

            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-primary"
            >
              <option value="all">全部板块</option>
              {INDEX_FILTERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        )}

        {tab === 'watchlist' && (
          <div className="flex flex-wrap gap-1">
            {SORT_OPTIONS.slice(0, 3).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggleSort(opt.key)}
                className={`rounded-md px-2 py-1 text-[11px] ${
                  sortKey === opt.key
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted hover:bg-surface-hover hover:text-gray-200'
                }`}
              >
                {opt.label}
                {sortKey === opt.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'market' && isError && (
          <p className="px-3 py-4 text-sm text-down">筛选列表加载失败，请确认后端在跑。</p>
        )}
        {tab === 'watchlist' && watchSymbols.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted">
            自选为空。在顶部点星星，或从「市场」加入收藏。
          </p>
        )}
        {tab === 'market' && !isError && !isLoading && filtered.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted">没有匹配的股票</p>
        )}
        {tab === 'watchlist' && watchSymbols.length > 0 && filtered.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted">没有匹配的自选</p>
        )}
        {filtered.map((row) => (
          <ScreenerRow
            key={row.symbol}
            row={row}
            active={row.symbol === current}
            held={heldSymbols?.has(row.symbol) ?? false}
            metric={
              tab === 'market' &&
              (sortKey === 'volume' || sortKey === 'turnover' || sortKey === 'marketCap')
                ? sortKey
                : null
            }
            onSelect={onSelect}
            onPrefetch={schedulePrefetch}
            onCancelPrefetch={cancelPrefetch}
          />
        ))}
      </div>
    </div>
  );
}
