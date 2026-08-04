import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import {
  cancelOrder,
  fetchOrders,
  fetchPortfolio,
  fetchQuote,
  fetchTrades,
  searchSymbols,
} from '../../api/endpoints';
import type { Position } from '../../types/api';
import { changeColorClass, formatMarketTime, formatPrice } from '../../utils/format';
import { MobileInlineOrder } from '../components/MobileInlineOrder';
import { EmptyState, Segmented, Skeleton } from '../components/ui';

type TradeTab = 'positions' | 'orders' | 'trades';

const TABS: { id: TradeTab; label: string }[] = [
  { id: 'positions', label: '持仓' },
  { id: 'orders', label: '委托' },
  { id: 'trades', label: '成交' },
];

const STATUS_LABEL: Record<string, string> = {
  filled: '已成交',
  pending: '待成交',
  rejected: '已拒绝',
  canceled: '已撤单',
  cancelled: '已撤单',
};

/** Keep ticker search Latin-only; strip IME junk / spaces. */
function normalizeTickerInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, '')
    .slice(0, 12);
}

function signedMoney(value: number): string {
  const abs = formatPrice(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
}

export function MobileTradePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TradeTab>('positions');

  const [symbolInput, setSymbolInput] = useState('');
  const [symbol, setSymbol] = useState('');
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);

  const { data: portfolio, isLoading } = useQuery({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    refetchInterval: 45_000,
  });

  const { data: orders } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    enabled: tab === 'orders',
    staleTime: 20_000,
  });

  const { data: trades } = useQuery({
    queryKey: ['trades'],
    queryFn: fetchTrades,
    enabled: tab === 'trades',
    staleTime: 20_000,
  });

  const searchKey = normalizeTickerInput(symbolInput);
  const { data: searchResults } = useQuery({
    queryKey: ['symbol-search', searchKey],
    queryFn: () => searchSymbols(searchKey, 8),
    enabled: searchKey.length >= 1 && !symbol && !composing,
    staleTime: 30_000,
  });

  const { data: quoteData } = useQuery({
    queryKey: ['quote', symbol],
    queryFn: () => fetchQuote(symbol),
    enabled: Boolean(symbol),
    refetchInterval: 20_000,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });

  const positions = portfolio?.positions ?? [];
  const position = positions.find((p) => p.symbol === symbol);
  const quote = quoteData?.quote;
  const price = quote?.price ?? 0;

  const pickSymbol = (next: string) => {
    const upper = normalizeTickerInput(next);
    if (!upper) return;
    composingRef.current = false;
    setComposing(false);
    setSymbol(upper);
    setSymbolInput(upper);
  };

  const onSearchChange = (raw: string) => {
    if (composingRef.current) {
      setSymbolInput(raw);
      return;
    }
    const next = normalizeTickerInput(raw);
    setSymbolInput(next);
    setSymbol('');
  };

  const onCompositionEnd = (raw: string) => {
    composingRef.current = false;
    setComposing(false);
    const next = normalizeTickerInput(raw);
    setSymbolInput(next);
    setSymbol('');
  };

  const suggestions = useMemo(() => {
    const fromSearch = searchResults?.items ?? [];
    if (fromSearch.length > 0) return fromSearch;
    if (searchKey.length >= 1) {
      return positions
        .filter((p) => p.symbol.includes(searchKey))
        .map((p) => ({ symbol: p.symbol, name: p.symbol }));
    }
    return [];
  }, [searchResults, positions, searchKey]);

  const showSuggestions = !symbol && searchKey.length >= 1 && !composing;

  return (
    <div className="pb-6">
      <header className="safe-top sticky top-0 z-20 border-b border-border/70 bg-surface-raised/95 px-3 pb-3 pt-3 backdrop-blur-md">
        <h1 className="mb-2 text-[17px] font-semibold text-gray-50">交易</h1>
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="rounded-xl border border-border/70 bg-surface-card px-3 py-3">
            <div className="text-[11px] text-muted">总资产（USD）</div>
            <div className="tabular text-[26px] font-bold leading-tight text-gray-50">
              {formatPrice(portfolio?.equity ?? 0)}
            </div>
            <div className="tabular mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <div className="text-muted">现金</div>
                <div className="font-medium text-gray-100">
                  {formatPrice(portfolio?.cash ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-muted">持仓市值</div>
                <div className="font-medium text-gray-100">
                  {formatPrice(portfolio?.marketValue ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-muted">累计盈亏</div>
                <div className={`font-medium ${changeColorClass(portfolio?.pnl ?? 0)}`}>
                  {(portfolio?.pnl ?? 0) >= 0 ? '+' : ''}
                  {formatPrice(portfolio?.pnl ?? 0)}
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      <section className="mx-3 mt-3 rounded-xl border border-border/70 bg-surface-card px-3 py-3">
        <div className="mb-2 text-[13px] font-medium text-gray-200">快速下单</div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={symbolInput}
            onChange={(e) => onSearchChange(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
              setComposing(true);
            }}
            onCompositionEnd={(e) => onCompositionEnd(e.currentTarget.value)}
            placeholder="输入股票代码，如 AAPL"
            className="input py-2.5 pl-9 pr-8 font-mono text-[15px] uppercase"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            lang="en"
            inputMode="search"
            enterKeyHint="search"
          />
          {symbolInput && (
            <button
              type="button"
              onClick={() => {
                composingRef.current = false;
                setComposing(false);
                setSymbolInput('');
                setSymbol('');
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted"
              aria-label="清除"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {showSuggestions && (
          <div className="mt-1 overflow-hidden rounded-lg border border-border/60 bg-surface-raised">
            {suggestions.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-muted">没有匹配标的</div>
            ) : (
              suggestions.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSymbol(item.symbol)}
                  className="m-tap flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left last:border-b-0"
                >
                  <span className="font-mono text-[13px] font-semibold text-gray-100">
                    {item.symbol}
                  </span>
                  <span className="truncate text-[12px] text-muted">{item.name}</span>
                </button>
              ))
            )}
          </div>
        )}

        {symbol ? (
          <MobileInlineOrder
            symbol={symbol}
            price={price}
            changePercent={quote?.changePercent ?? 0}
            cash={portfolio?.cash ?? 0}
            position={position}
          />
        ) : (
          <p className="mt-3 text-[12px] text-muted">
            搜索并选择股票后，可直接在本页填写市价/限价单。
          </p>
        )}
      </section>

      <div className="px-3 pt-3">
        <Segmented items={TABS} value={tab} onChange={setTab} />
      </div>

      <div className="space-y-2 px-3 pt-3">
        {tab === 'positions' &&
          (positions.length === 0 ? (
            <EmptyState text="当前没有持仓" />
          ) : (
            positions.map((p) => (
              <PositionRow
                key={p.symbol}
                position={p}
                active={p.symbol === symbol}
                onSelect={() => pickSymbol(p.symbol)}
              />
            ))
          ))}

        {tab === 'orders' &&
          ((orders?.items ?? []).length === 0 ? (
            <EmptyState text="没有委托记录" />
          ) : (
            (orders?.items ?? []).map((o) => (
              <div
                key={o.id}
                className="rounded-xl border border-border/70 bg-surface-card px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className={`badge ${o.side === 'buy' ? 'badge-up' : 'badge-down'}`}>
                    {o.side === 'buy' ? '买入' : '卖出'}
                  </span>
                  <span className="font-mono text-[14px] font-semibold text-gray-50">
                    {o.symbol}
                  </span>
                  <span className="ml-auto text-[11px] text-muted">
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
                <div className="tabular mt-1.5 flex items-center justify-between text-[12px] text-muted">
                  <span>
                    {o.orderType === 'market' ? '市价' : `限价 ${formatPrice(o.limitPrice ?? 0)}`} ×{' '}
                    {o.quantity}
                  </span>
                  <span>{formatMarketTime(o.createdAt, 'MM-dd HH:mm', false)}</span>
                </div>
                {o.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => cancel.mutate(o.id)}
                    disabled={cancel.isPending}
                    className="m-tap mt-2 w-full rounded-lg border border-border py-2 text-[13px] text-muted"
                  >
                    撤单
                  </button>
                )}
              </div>
            ))
          ))}

        {tab === 'trades' &&
          ((trades?.items ?? []).length === 0 ? (
            <EmptyState text="没有成交记录" />
          ) : (
            (trades?.items ?? []).map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-border/70 bg-surface-card px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className={`badge ${t.side === 'buy' ? 'badge-up' : 'badge-down'}`}>
                    {t.side === 'buy' ? '买入' : '卖出'}
                  </span>
                  <span className="font-mono text-[14px] font-semibold text-gray-50">
                    {t.symbol}
                  </span>
                  <span className="tabular ml-auto text-[13px] font-medium text-gray-100">
                    {t.quantity} @ {formatPrice(t.price)}
                  </span>
                </div>
                <div className="tabular mt-1.5 flex items-center justify-between text-[11px] text-muted">
                  <span>金额 {formatPrice(t.notional)}</span>
                  <span>手续费 {formatPrice(t.fee)}</span>
                  <span>
                    {t.filledAt ? formatMarketTime(t.filledAt, 'MM-dd HH:mm', false) : '—'}
                  </span>
                </div>
              </div>
            ))
          ))}
      </div>
    </div>
  );
}

function PositionRow({
  position: p,
  active,
  onSelect,
}: {
  position: Position;
  active: boolean;
  onSelect: () => void;
}) {
  const floating = p.floatingPnl ?? p.pnl;
  const today = p.todayPnl ?? 0;
  const realized = p.realizedPnl ?? 0;
  const weightPct = (p.weight || 0) * 100;

  return (
    <div
      className={`rounded-xl border bg-surface-card px-3 py-2.5 ${
        active ? 'border-primary/50' : 'border-border/70'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={onSelect} className="m-tap min-w-0 text-left">
          <div className="font-mono text-[15px] font-semibold text-gray-50">{p.symbol}</div>
          <div className="tabular text-[11px] text-muted">市值 ${formatPrice(p.marketValue)}</div>
        </button>
        <Link to={`/workbench/${p.symbol}`} className="shrink-0 text-[12px] text-primary">
          看行情 →
        </Link>
      </div>

      <div className="-mx-1 overflow-x-auto">
        <div className="grid min-w-[34rem] grid-cols-6 gap-1 px-1">
          <PosCol label="持股数" value={`${Math.round(p.quantity)}`} />
          <PosCol label="成本" value={formatPrice(p.avgCost)} />
          <PosCol label="现价" value={formatPrice(p.price)} />
          <PosCol
            label="浮动盈亏"
            value={signedMoney(floating)}
            tone={floating}
            sub={`${today >= 0 ? '+' : ''}${formatPrice(today)} 当日`}
            subTone={today}
          />
          <PosCol label="已实现" value={signedMoney(realized)} tone={realized} />
          <PosCol label="持仓占比" value={`${weightPct.toFixed(1)}%`} />
        </div>
      </div>
    </div>
  );
}

function PosCol({
  label,
  value,
  tone,
  sub,
  subTone,
}: {
  label: string;
  value: string;
  tone?: number;
  sub?: string;
  subTone?: number;
}) {
  return (
    <div className="min-w-0 text-center">
      <div className="mb-0.5 text-[10px] leading-none text-muted">{label}</div>
      <div
        className={`tabular truncate text-[12px] font-semibold leading-tight ${
          tone == null ? 'text-gray-100' : changeColorClass(tone)
        }`}
      >
        {value}
      </div>
      {sub != null && (
        <div
          className={`tabular truncate text-[10px] leading-tight ${
            subTone == null ? 'text-muted' : changeColorClass(subTone)
          }`}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
