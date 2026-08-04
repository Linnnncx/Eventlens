import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '../../components/EmptyState';
import { cancelOrder, modifyOrder } from '../../api/endpoints';
import type { Order, Position, Trade } from '../../types/api';
import {
  changeColorClass,
  formatCurrency,
  formatMarketTime,
  formatPercent,
  formatPrice,
} from '../../utils/format';

function signedMoney(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatCurrency(value)}`;
}

function signedPct(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return formatPercent(value);
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return formatMarketTime(value, 'MMM d HH:mm:ss', false);
  } catch {
    return '—';
  }
}

function orderPrice(o: Order): string {
  if (o.filledPrice != null) return formatPrice(o.filledPrice);
  if (o.limitPrice != null) return formatPrice(o.limitPrice);
  return o.orderType === 'market' ? '市价' : '—';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'filled':
      return '已成交';
    case 'open':
      return '待成交';
    case 'canceled':
    case 'cancelled':
      return '已撤销';
    case 'rejected':
      return '已拒绝';
    case 'partial':
      return '部分成交';
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'filled':
      return 'text-up';
    case 'open':
    case 'partial':
      return 'text-amber-400';
    case 'canceled':
    case 'cancelled':
    case 'rejected':
      return 'text-muted';
    default:
      return 'text-muted';
  }
}

function SideBadge({ side }: { side: string }) {
  const buy = side === 'buy';
  return (
    <span className={`font-semibold ${buy ? 'text-up' : 'text-down'}`}>
      {buy ? '买入' : '卖出'}
    </span>
  );
}

function DataTable({
  headers,
  children,
}: {
  headers: { key: string; label: string; align?: 'left' | 'right' | 'center'; title?: string }[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 overflow-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface-card">
          <tr className="border-b border-border text-[12px] tracking-wide text-muted">
            {headers.map((h) => (
              <th
                key={h.key}
                title={h.title}
                className={`whitespace-nowrap px-2.5 py-2 font-medium ${
                  h.align === 'right' ? 'text-right' : h.align === 'center' ? 'text-center' : 'text-left'
                }`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </div>
  );
}

const POSITION_HEADERS = [
  { key: 'symbol', label: '标的' },
  { key: 'qty', label: '持仓', align: 'right' as const },
  { key: 'avail', label: '可用', align: 'right' as const },
  { key: 'avg', label: '成本价', align: 'right' as const },
  { key: 'px', label: '现价', align: 'right' as const },
  { key: 'mv', label: '市值', align: 'right' as const },
  {
    key: 'float',
    label: '浮动盈亏',
    align: 'right' as const,
    title: '相对成本价：(现价 − 成本价) × 持仓',
  },
  {
    key: 'today',
    label: '今日盈亏',
    align: 'right' as const,
    title: '隔夜仓相对昨收；今日新买相对买入价（不是相对成本≠现价时的缺口）',
  },
  {
    key: 'hold',
    label: '持仓盈亏',
    align: 'right' as const,
    title: '持仓累计盈亏，当前与浮动盈亏一致（相对成本价）',
  },
  { key: 'weight', label: '仓位%', align: 'right' as const },
];

export function PositionsTable({
  positions,
  activeSymbol,
}: {
  positions: Position[];
  activeSymbol?: string;
}) {
  if (positions.length === 0) {
    return <EmptyState title="暂无持仓" description="成交后的仓位会显示在这里" />;
  }
  return (
    <DataTable headers={POSITION_HEADERS}>
      {positions.map((p) => {
        const floating = p.floatingPnl ?? p.pnl;
        const floatingPct = p.floatingPnlPercent ?? p.pnlPercent;
        const today = p.todayPnl ?? 0;
        const todayPct = p.todayPnlPercent ?? 0;
        const holding = p.holdingPnl ?? floating;
        const holdingPct = p.holdingPnlPercent ?? floatingPct;
        const active = activeSymbol === p.symbol;
        return (
          <tr
            key={p.symbol}
            className={`tabular hover:bg-surface-hover/80 ${active ? 'bg-primary/5' : ''}`}
          >
            <td className="px-2.5 py-2">
              <Link to={`/workbench/${p.symbol}`} className="font-semibold text-foreground hover:text-primary">
                {p.symbol}
              </Link>
              {p.sector && p.sector !== 'Unknown' && (
                <div className="text-[11px] text-muted">{p.sector}</div>
              )}
            </td>
            <td className="px-2.5 py-2 text-right">{formatPrice(p.quantity, 0)}</td>
            <td className="px-2.5 py-2 text-right text-muted">
              {formatPrice(p.availableQuantity ?? p.quantity, 0)}
            </td>
            <td className="px-2.5 py-2 text-right">{formatPrice(p.avgCost)}</td>
            <td className="px-2.5 py-2 text-right font-medium">{formatPrice(p.price)}</td>
            <td className="px-2.5 py-2 text-right">{formatCurrency(p.marketValue)}</td>
            <td className={`px-2.5 py-2 text-right ${changeColorClass(floating)}`}>
              <div>{signedMoney(floating)}</div>
              <div className="text-[11px] opacity-80">{signedPct(floatingPct)}</div>
            </td>
            <td className={`px-2.5 py-2 text-right ${changeColorClass(today)}`}>
              <div>{signedMoney(today)}</div>
              <div className="text-[11px] opacity-80">{signedPct(todayPct)}</div>
            </td>
            <td className={`px-2.5 py-2 text-right ${changeColorClass(holding)}`}>
              <div>{signedMoney(holding)}</div>
              <div className="text-[11px] opacity-80">{signedPct(holdingPct)}</div>
            </td>
            <td className="px-2.5 py-2 text-right text-muted">
              {((p.weight || 0) * 100).toFixed(1)}%
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}

const ORDER_HEADERS = [
  { key: 'symbol', label: '标的' },
  { key: 'side', label: '方向', align: 'center' as const },
  { key: 'type', label: '类型' },
  { key: 'price', label: '委托/成交价', align: 'right' as const },
  { key: 'qty', label: '数量', align: 'right' as const },
  { key: 'created', label: '下单时间' },
  { key: 'status', label: '状态', align: 'center' as const },
  { key: 'fee', label: '手续费', align: 'right' as const },
];

export function OrdersTable({
  orders,
  activeSymbol,
  emptyLabel = '暂无委托',
}: {
  orders: Order[];
  activeSymbol?: string;
  emptyLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editLimitPrice, setEditLimitPrice] = useState('');

  const refreshOrders = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['portfolio'] });
  };
  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelOrder(id),
    onSuccess: refreshOrders,
  });
  const modifyMutation = useMutation({
    mutationFn: ({ id, quantity, limitPrice }: { id: string; quantity: number; limitPrice: number }) =>
      modifyOrder(id, { quantity, limitPrice }),
    onSuccess: () => {
      setEditingId(null);
      refreshOrders();
    },
  });

  if (orders.length === 0) {
    return <EmptyState title={emptyLabel} description="提交的模拟委托会出现在这里" />;
  }
  return (
    <DataTable headers={ORDER_HEADERS}>
      {orders.map((o) => {
        const active = activeSymbol === o.symbol;
        const actionable = o.status === 'open' || o.status === 'pending';
        const editing = editingId === o.id;
        return (
          <Fragment key={o.id}>
            <tr className={`tabular hover:bg-surface-hover/80 ${active ? 'bg-primary/5' : ''}`}>
              <td className="px-2.5 py-2">
                <Link to={`/workbench/${o.symbol}`} className="font-semibold hover:text-primary">
                  {o.symbol}
                </Link>
              </td>
              <td className="px-2.5 py-2 text-center"><SideBadge side={o.side} /></td>
              <td className="px-2.5 py-2 uppercase text-muted">{o.orderType}</td>
              <td className="px-2.5 py-2 text-right">{orderPrice(o)}</td>
              <td className="px-2.5 py-2 text-right">{formatPrice(o.quantity, 0)}</td>
              <td className="px-2.5 py-2 text-muted">{fmtTime(o.createdAt)}</td>
              <td className="px-2.5 py-2">
                <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                  <span className={`font-medium ${statusClass(o.status)}`}>
                    {statusLabel(o.status)}
                  </span>
                  {actionable ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(editing ? null : o.id);
                          setEditQuantity(String(o.quantity));
                          setEditLimitPrice(String(o.limitPrice ?? ''));
                        }}
                        className="rounded-md border border-primary/40 px-2 py-1 text-xs text-primary hover:bg-primary/10"
                      >
                        改单
                      </button>
                      <button
                        type="button"
                        onClick={() => cancelMutation.mutate(o.id)}
                        disabled={cancelMutation.isPending && cancelMutation.variables === o.id}
                        className="rounded-md border border-down/40 px-2 py-1 text-xs text-down hover:bg-down/10 disabled:opacity-50"
                      >
                        撤单
                      </button>
                    </>
                  ) : null}
                </div>
              </td>
              <td className="px-2.5 py-2 text-right text-muted">
                {o.fee != null ? formatCurrency(o.fee) : '—'}
              </td>
            </tr>
            {editing ? (
              <tr className="bg-primary/[0.04]">
                <td colSpan={8} className="px-3 py-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-xs text-muted">
                      数量
                      <input
                        type="number"
                        min="0.0001"
                        step="any"
                        value={editQuantity}
                        onChange={(event) => setEditQuantity(event.target.value)}
                        className="mt-1 block w-32 rounded-md border border-border bg-surface px-2.5 py-2 text-gray-100 outline-none focus:border-primary"
                      />
                    </label>
                    <label className="text-xs text-muted">
                      限价
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={editLimitPrice}
                        onChange={(event) => setEditLimitPrice(event.target.value)}
                        className="mt-1 block w-32 rounded-md border border-border bg-surface px-2.5 py-2 text-gray-100 outline-none focus:border-primary"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={
                        modifyMutation.isPending ||
                        Number(editQuantity) <= 0 ||
                        Number(editLimitPrice) <= 0
                      }
                      onClick={() =>
                        modifyMutation.mutate({
                          id: o.id,
                          quantity: Number(editQuantity),
                          limitPrice: Number(editLimitPrice),
                        })
                      }
                      className="btn-primary px-4 py-2 text-xs disabled:opacity-50"
                    >
                      {modifyMutation.isPending ? '保存中…' : '确认改单'}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="btn-ghost px-3 py-2 text-xs">
                      取消
                    </button>
                    {modifyMutation.isError ? (
                      <span className="text-xs text-down">改单失败，请检查数量和价格</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : null}
          </Fragment>
        );
      })}
    </DataTable>
  );
}

const TRADE_HEADERS = [
  { key: 'symbol', label: '标的' },
  { key: 'side', label: '方向', align: 'center' as const },
  { key: 'price', label: '成交价', align: 'right' as const },
  { key: 'qty', label: '股数', align: 'right' as const },
  { key: 'notional', label: '成交额', align: 'right' as const },
  { key: 'ordered', label: '下单时间' },
  { key: 'filled', label: '成交时间' },
  { key: 'fee', label: '手续费', align: 'right' as const },
];

export function TradesTable({
  trades,
  activeSymbol,
}: {
  trades: Trade[];
  activeSymbol?: string;
}) {
  if (trades.length === 0) {
    return <EmptyState title="暂无成交" description="成交记录会显示价格、时间与手续费" />;
  }
  return (
    <DataTable headers={TRADE_HEADERS}>
      {trades.map((t) => {
        const active = activeSymbol === t.symbol;
        return (
          <tr
            key={t.id}
            className={`tabular hover:bg-surface-hover/80 ${active ? 'bg-primary/5' : ''}`}
          >
            <td className="px-2.5 py-2">
              <Link to={`/workbench/${t.symbol}`} className="font-semibold hover:text-primary">
                {t.symbol}
              </Link>
            </td>
            <td className="px-2.5 py-2 text-center">
              <SideBadge side={t.side} />
            </td>
            <td className="px-2.5 py-2 text-right font-medium">{formatPrice(t.price)}</td>
            <td className="px-2.5 py-2 text-right">{formatPrice(t.quantity, 0)}</td>
            <td className="px-2.5 py-2 text-right">{formatCurrency(t.notional)}</td>
            <td className="px-2.5 py-2 text-muted">{fmtTime(t.orderCreatedAt)}</td>
            <td className="px-2.5 py-2 text-muted">{fmtTime(t.filledAt ?? t.createdAt)}</td>
            <td
              className="px-2.5 py-2 text-right text-muted"
              title={
                t.feeBreakdown
                  ? `富途美股参考：佣金 ${formatCurrency(t.feeBreakdown.commission)} + 平台费 ${formatCurrency(t.feeBreakdown.platformFee)} + 交收费 ${formatCurrency(t.feeBreakdown.clearingFee)}${t.feeBreakdown.taf ? ` + TAF ${formatCurrency(t.feeBreakdown.taf)}` : ''}`
                  : '富途美股收费标准参考'
              }
            >
              {formatCurrency(t.fee)}
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
