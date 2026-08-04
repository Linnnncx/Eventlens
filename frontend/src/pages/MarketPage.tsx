import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Activity, ArrowUpRight, Clock, Star } from 'lucide-react';
import {
  fetchMarketStatus,
  fetchOrders,
  fetchPortfolio,
  fetchSnapshots,
  fetchSymbols,
  fetchWatchlist,
} from '../api/endpoints';
import { SearchBox } from '../components/SearchBox';
import { PriceFlash } from '../components/PriceFlash';
import { EmptyState } from '../components/EmptyState';
import { useMarketSocket } from '../hooks/useMarketSocket';
import { useAccountStore } from '../stores/accountStore';
import {
  changeColorClass,
  formatChange,
  formatCurrency,
  formatPercent,
  sessionLabel,
} from '../utils/format';
import { useEffect } from 'react';
import { INDEX_STRIP } from '../features/market/indices';
import { MoverHeatmaps } from '../features/market/MoverHeatmaps';

const INDEX_SYMBOLS = INDEX_STRIP.map((i) => i.symbol);
const HEATMAP_TOP_N = 8;

export function MarketPage() {
  const setPortfolio = useAccountStore((s) => s.setPortfolio);

  const { data: status } = useQuery({
    queryKey: ['marketStatus'],
    queryFn: fetchMarketStatus,
    refetchInterval: 60_000,
  });

  const { data: portfolio, isLoading: portfolioLoading } = useQuery({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (portfolio) setPortfolio(portfolio);
  }, [portfolio, setPortfolio]);

  const { data: watchlist } = useQuery({
    queryKey: ['watchlist'],
    queryFn: fetchWatchlist,
  });

  const { data: coreSymbols } = useQuery({
    queryKey: ['symbols', 'core'],
    queryFn: () => fetchSymbols(true),
  });

  const watchSymbols = watchlist?.items ?? [];
  const coreMovers = (coreSymbols?.items ?? []).slice(0, 8).map((s) => s.symbol);
  const heatPool = (coreSymbols?.items ?? [])
    .filter((s) => (s.assetType || 'equity') === 'equity')
    .slice(0, 48)
    .map((s) => s.symbol);
  const allSymbols = [
    ...new Set([...INDEX_SYMBOLS, ...heatPool, ...coreMovers, ...watchSymbols]),
  ];

  const { data: snapshots } = useQuery({
    queryKey: ['snapshots', allSymbols.join(',')],
    queryFn: () => fetchSnapshots(allSymbols),
    enabled: allSymbols.length > 0,
    refetchInterval: 30_000,
  });

  const { data: orders } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    refetchInterval: 30_000,
  });

  const { quotes } = useMarketSocket(allSymbols);

  const snapMap = new Map(snapshots?.snapshots.map((s) => [s.symbol, s]) ?? []);

  const getPrice = (sym: string) => quotes[sym]?.price ?? snapMap.get(sym)?.price ?? 0;
  const getChange = (sym: string) => snapMap.get(sym)?.changePercent ?? 0;

  const heatCells = heatPool
    .map((sym) => {
      const snap = snapMap.get(sym);
      return {
        symbol: sym,
        name: snap?.name ?? sym,
        changePercent: snap?.changePercent ?? 0,
        price: getPrice(sym),
      };
    })
    .filter((c) => Number.isFinite(c.changePercent));

  const gainers = [...heatCells]
    .filter((c) => c.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, HEATMAP_TOP_N);
  const losers = [...heatCells]
    .filter((c) => c.changePercent < 0)
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, HEATMAP_TOP_N);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-7 p-5 pb-10 md:p-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
              <Activity className="h-5 w-5 text-primary" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-50">EventLens Market</h1>
          </div>
          <p className="text-sm text-muted md:text-[15px]">
            Event-driven market intelligence &amp; paper trading
          </p>
        </div>
        <div className="w-full md:max-w-md">
          <SearchBox autoFocus />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Equity"
          value={portfolioLoading ? '…' : formatCurrency(portfolio?.equity ?? 0)}
          sub={
            portfolio
              ? `${formatChange(portfolio.pnl)} (${formatPercent(portfolio.pnlPercent)})`
              : undefined
          }
          subClass={portfolio ? changeColorClass(portfolio.pnl) : undefined}
        />
        <StatCard
          label="Cash"
          value={portfolioLoading ? '…' : formatCurrency(portfolio?.cash ?? 0)}
        />
        <StatCard
          label="Market"
          value={status ? sessionLabel(status.session, status.isOpen) : '…'}
          sub={status ? format(new Date(status.serverTime), 'HH:mm:ss zzz') : undefined}
          icon={<Clock className="h-4 w-4 text-muted" />}
        />
        <StatCard
          label="Positions"
          value={String(portfolio?.positions.length ?? 0)}
          sub={`${watchSymbols.length} watchlist`}
        />
      </section>

      <section>
        <h2 className="mb-2.5 text-sm font-medium tracking-wide text-muted">指数</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {INDEX_STRIP.map((idx) => (
            <SymbolCard
              key={idx.symbol}
              symbol={idx.symbol}
              name={idx.label}
              price={getPrice(idx.symbol)}
              changePercent={getChange(idx.symbol)}
              titleFirst
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2.5 text-sm font-medium tracking-wide text-muted">今日涨跌热点</h2>
        <MoverHeatmaps gainers={gainers} losers={losers} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2.5 text-sm font-medium tracking-wide text-muted">Core Movers</h2>
          <div className="card divide-y divide-border">
            {coreMovers.length === 0 ? (
              <EmptyState title="No core symbols" />
            ) : (
              coreMovers.map((sym) => (
                <SymbolRow
                  key={sym}
                  symbol={sym}
                  name={snapMap.get(sym)?.name ?? sym}
                  price={getPrice(sym)}
                  changePercent={getChange(sym)}
                />
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-medium tracking-wide text-muted">
            <Star className="h-3.5 w-3.5" /> Watchlist
          </h2>
          <div className="card divide-y divide-border">
            {watchSymbols.length === 0 ? (
              <EmptyState title="Empty watchlist" description="Search and add symbols from the workbench." />
            ) : (
              watchSymbols.map((sym) => (
                <SymbolRow
                  key={sym}
                  symbol={sym}
                  name={snapMap.get(sym)?.name ?? sym}
                  price={getPrice(sym)}
                  changePercent={getChange(sym)}
                />
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2.5 text-sm font-medium tracking-wide text-muted">Positions</h2>
          <div className="card divide-y divide-border">
            {!portfolio?.positions.length ? (
              <EmptyState title="No open positions" />
            ) : (
              portfolio.positions.map((p) => (
                <Link
                  key={p.symbol}
                  to={`/workbench/${p.symbol}`}
                  className="flex items-center justify-between px-3 py-2.5 hover:bg-surface-hover"
                >
                  <div>
                    <span className="font-medium">{p.symbol}</span>
                    <span className="ml-2 text-xs text-muted">{p.quantity} sh</span>
                  </div>
                  <div className="text-right">
                    <PriceFlash value={p.price} formatter={(v) => formatCurrency(v)} className="text-sm" />
                    <div className={`text-xs tabular ${changeColorClass(p.pnl)}`}>
                      {formatChange(p.pnl)} ({formatPercent(p.pnlPercent)})
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2.5 text-sm font-medium tracking-wide text-muted">Recent Orders</h2>
          <div className="card divide-y divide-border">
            {!orders?.items.length ? (
              <EmptyState title="No orders yet" />
            ) : (
              orders.items.slice(0, 8).map((o) => (
                <div key={o.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                  <div>
                    <span className={o.side === 'buy' ? 'text-up' : 'text-down'}>{o.side.toUpperCase()}</span>
                    <span className="ml-2 font-medium">{o.symbol}</span>
                    <span className="ml-2 text-xs text-muted">{o.orderType}</span>
                  </div>
                  <div className="text-right text-xs">
                    <div className="tabular">{o.quantity} @ {o.filledPrice?.toFixed(2) ?? '—'}</div>
                    <div className="text-muted">{o.status}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  subClass,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="card px-4 py-4 transition-colors hover:bg-surface-hover/40">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        {icon}
      </div>
      <div className="mt-1.5 tabular text-xl font-semibold tracking-tight text-gray-50">{value}</div>
      {sub && <div className={`mt-1 text-sm tabular ${subClass ?? 'text-muted'}`}>{sub}</div>}
    </div>
  );
}

function SymbolCard({
  symbol,
  name,
  price,
  changePercent,
  titleFirst = false,
}: {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  /** Show Chinese/index name first (e.g. 道琼斯) with ticker as secondary. */
  titleFirst?: boolean;
}) {
  return (
    <Link
      to={`/workbench/${symbol}`}
      className="card px-3.5 py-3 transition-colors hover:bg-surface-hover"
    >
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">{titleFirst ? name : symbol}</span>
        <ArrowUpRight className="h-4 w-4 text-muted" />
      </div>
      <div className="truncate text-xs text-muted">{titleFirst ? symbol : name}</div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <PriceFlash
          value={price}
          formatter={(v) =>
            v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          }
          className="text-base font-medium"
        />
        <span className={`text-sm tabular ${changeColorClass(changePercent)}`}>
          {formatPercent(changePercent)}
        </span>
      </div>
    </Link>
  );
}

function SymbolRow({
  symbol,
  name,
  price,
  changePercent,
}: {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
}) {
  return (
    <Link
      to={`/workbench/${symbol}`}
      className="flex items-center justify-between px-3.5 py-3 transition-colors hover:bg-surface-hover"
    >
      <div className="min-w-0">
        <span className="text-[15px] font-medium">{symbol}</span>
        <span className="ml-2 truncate text-sm text-muted">{name}</span>
      </div>
      <div className="text-right">
        <PriceFlash value={price} className="text-[15px]" />
        <div className={`text-sm tabular ${changeColorClass(changePercent)}`}>
          {formatPercent(changePercent)}
        </div>
      </div>
    </Link>
  );
}
