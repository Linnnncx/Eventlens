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

const INDEX_ETFS = ['SPY', 'QQQ', 'DIA', 'IWM'];

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
  const allSymbols = [...new Set([...INDEX_ETFS, ...coreMovers, ...watchSymbols])];

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

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 pb-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">EventLens Market</h1>
          </div>
          <p className="text-sm text-muted">Event-driven market intelligence &amp; paper trading</p>
        </div>
        <div className="w-full md:max-w-sm">
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
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Index ETFs</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {INDEX_ETFS.map((sym) => (
            <SymbolCard
              key={sym}
              symbol={sym}
              name={snapMap.get(sym)?.name ?? sym}
              price={getPrice(sym)}
              changePercent={getChange(sym)}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Core Movers</h2>
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
          <h2 className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted">
            <Star className="h-3 w-3" /> Watchlist
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
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Positions</h2>
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
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Recent Orders</h2>
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
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        {icon}
      </div>
      <div className="mt-1 tabular text-lg font-semibold">{value}</div>
      {sub && <div className={`mt-0.5 text-xs tabular ${subClass ?? 'text-muted'}`}>{sub}</div>}
    </div>
  );
}

function SymbolCard({
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
      className="card px-3 py-2.5 transition-colors hover:bg-surface-hover"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{symbol}</span>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted" />
      </div>
      <div className="truncate text-[10px] text-muted">{name}</div>
      <div className="mt-1 flex items-baseline justify-between">
        <PriceFlash value={price} className="text-sm font-medium" />
        <span className={`text-xs tabular ${changeColorClass(changePercent)}`}>
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
      className="flex items-center justify-between px-3 py-2.5 hover:bg-surface-hover"
    >
      <div className="min-w-0">
        <span className="font-medium">{symbol}</span>
        <span className="ml-2 truncate text-xs text-muted">{name}</span>
      </div>
      <div className="text-right">
        <PriceFlash value={price} className="text-sm" />
        <div className={`text-xs tabular ${changeColorClass(changePercent)}`}>
          {formatPercent(changePercent)}
        </div>
      </div>
    </Link>
  );
}
