import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  RefreshCw,
  Settings2,
  Shield,
  Wallet,
} from 'lucide-react';
import {
  fetchClosedRankings,
  fetchEquityHistory,
  fetchOrders,
  fetchPortfolio,
  fetchProvidersStatus,
  fetchPublicConfig,
  resetDemo,
  type EquityHistoryRange,
} from '../../api/endpoints';
import { changeColorClass, formatPercent, formatPrice } from '../../utils/format';
import {
  DEFAULT_MA_PERIODS,
  loadMaPeriods,
  normalizeMaPeriods,
  saveMaPeriods,
} from '../../features/chart/indicatorConfig';
import { MobileEquityChart } from '../components/MobileEquityChart';

const RANGES: { id: EquityHistoryRange; label: string }[] = [
  { id: '1d', label: '1日' },
  { id: '1w', label: '1周' },
  { id: '1m', label: '1月' },
  { id: '6m', label: '半年' },
  { id: '1y', label: '1年' },
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 px-3 py-2.5 text-[13px] last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="tabular font-medium text-gray-100">{value}</span>
    </div>
  );
}

function maskMoney(hidden: boolean, value: string) {
  return hidden ? '****' : value;
}

export function MobileProfilePage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<EquityHistoryRange>('1d');
  const [hideBalance, setHideBalance] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [maDraft, setMaDraft] = useState(() => loadMaPeriods().join(','));
  const [saved, setSaved] = useState(false);

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    refetchInterval: 30_000,
  });

  const { data: history } = useQuery({
    queryKey: ['equity-history', range],
    queryFn: () => fetchEquityHistory(range),
    refetchInterval: 60_000,
  });

  const { data: rankings } = useQuery({
    queryKey: ['closed-rankings'],
    queryFn: () => fetchClosedRankings(15),
    staleTime: 30_000,
  });

  const { data: orders } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    staleTime: 30_000,
  });

  const { data: config } = useQuery({ queryKey: ['public-config'], queryFn: fetchPublicConfig });
  const { data: providers } = useQuery({
    queryKey: ['providers-status'],
    queryFn: fetchProvidersStatus,
    refetchInterval: 120_000,
  });

  const reset = useMutation({
    mutationFn: resetDemo,
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const equity = portfolio?.equity ?? 0;
  const cash = portfolio?.cash ?? 0;
  const todayChange = history?.todayChange ?? 0;
  const todayPct = history?.todayChangePercent ?? 0;
  const pendingOrders = useMemo(
    () => (orders?.items ?? []).filter((o) => o.status === 'pending').length,
    [orders],
  );
  const openPositions = portfolio?.positions.length ?? 0;

  const commitMa = () => {
    const periods = normalizeMaPeriods(maDraft.split(/[,，\s]+/).filter(Boolean));
    saveMaPeriods(periods);
    setMaDraft(periods.join(','));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="pb-8">
      <header className="safe-top border-b border-border/70 bg-surface-raised/95 px-3 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[17px] font-semibold text-gray-50">我的</h1>
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="m-tap flex h-9 w-9 items-center justify-center rounded-full text-muted"
            aria-label="设置"
          >
            <Settings2 className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Asset overview + chart */}
      <section className="px-3 pt-4">
        <div className="rounded-2xl border border-border/70 bg-surface-card px-3 pb-3 pt-3">
          <div className="flex items-center gap-1.5 text-[13px] text-muted">
            <span>总资产估值</span>
            <button
              type="button"
              onClick={() => setHideBalance((v) => !v)}
              className="m-tap text-muted"
              aria-label={hideBalance ? '显示资产' : '隐藏资产'}
            >
              {hideBalance ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="mt-1 tabular text-[28px] font-semibold tracking-tight text-gray-50">
            {maskMoney(hideBalance, `$${formatPrice(equity)}`)}
          </div>
          <div className={`mt-0.5 text-[13px] tabular ${changeColorClass(todayChange)}`}>
            今日收益{' '}
            {hideBalance
              ? '****'
              : `${todayChange >= 0 ? '+' : ''}$${formatPrice(Math.abs(todayChange))} (${formatPercent(todayPct)})`}
          </div>

          <div className="mt-3">
            {history?.points?.length ? (
              <MobileEquityChart
                points={history.points}
                high={history.high}
                low={history.low}
                height={168}
              />
            ) : (
              <div className="flex h-[168px] items-center justify-center text-[12px] text-muted">
                暂无资产曲线，交易后将自动记录
              </div>
            )}
          </div>

          <div className="mt-2 flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={`m-tap flex-1 rounded-full py-1.5 text-[12px] ${
                  range === r.id
                    ? 'bg-surface-raised font-medium text-gray-100'
                    : 'text-muted'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/50 pt-3 text-[12px]">
            <div>
              <div className="text-muted">可用现金</div>
              <div className="tabular mt-0.5 font-medium text-gray-100">
                {maskMoney(hideBalance, `$${formatPrice(cash)}`)}
              </div>
            </div>
            <div>
              <div className="text-muted">累计盈亏</div>
              <div className={`tabular mt-0.5 font-medium ${changeColorClass(portfolio?.pnl ?? 0)}`}>
                {hideBalance
                  ? '****'
                  : `${formatPercent(portfolio?.pnlPercent ?? 0)} · $${formatPrice(portfolio?.pnl ?? 0)}`}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick trading features */}
      <section className="grid grid-cols-4 gap-2 px-3 pt-4">
        {[
          { to: '/trade', label: '交易', icon: Wallet, hint: `${openPositions} 持仓` },
          { to: '/trade', label: '委托', icon: FileText, hint: pendingOrders ? `${pendingOrders} 待成交` : '查看' },
          { to: '/', label: '行情', icon: Shield, hint: '市场' },
          { to: '/news', label: '资讯', icon: ChevronRight, hint: '事件' },
        ].map(({ to, label, icon: Icon, hint }) => (
          <Link
            key={label}
            to={to}
            className="m-tap flex flex-col items-center gap-1.5 rounded-xl border border-border/70 bg-surface-card px-1 py-3"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised text-gray-200">
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-[12px] font-medium text-gray-100">{label}</span>
            <span className="text-[10px] text-muted">{hint}</span>
          </Link>
        ))}
      </section>

      {/* Closed PnL ranking */}
      <section className="px-3 pt-5">
        <div className="mb-2 flex items-end justify-between px-1">
          <h2 className="text-[14px] font-semibold text-gray-100">已平仓收益排行</h2>
          <span className="text-[11px] text-muted">按已实现盈亏</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface-card">
          {(rankings?.items ?? []).length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-muted">
              暂无已平仓记录，卖出清仓后会出现在这里
            </div>
          ) : (
            (rankings?.items ?? []).map((item, idx) => (
              <Link
                key={item.symbol}
                to={`/workbench/${item.symbol}`}
                className="m-tap flex items-center gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${
                    idx < 3 ? 'bg-amber-500/20 text-amber-200' : 'bg-surface-raised text-muted'
                  }`}
                >
                  {idx + 1}
                </span>
                <span className="font-mono text-[14px] font-semibold text-gray-50">{item.symbol}</span>
                <span className={`ml-auto tabular text-[14px] font-medium ${changeColorClass(item.realizedPnl)}`}>
                  {item.realizedPnl >= 0 ? '+' : ''}
                  ${formatPrice(Math.abs(item.realizedPnl))}
                </span>
              </Link>
            ))
          )}
        </div>
      </section>

      {/* Open positions snapshot */}
      <section className="px-3 pt-5">
        <div className="mb-2 flex items-end justify-between px-1">
          <h2 className="text-[14px] font-semibold text-gray-100">当前持仓</h2>
          <Link to="/trade" className="text-[11px] text-primary">
            去交易
          </Link>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface-card">
          {!portfolio?.positions.length ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted">暂无持仓</div>
          ) : (
            portfolio.positions.slice(0, 5).map((p) => (
              <Link
                key={p.symbol}
                to={`/workbench/${p.symbol}`}
                className="m-tap flex items-center justify-between border-b border-border/50 px-3 py-2.5 last:border-b-0"
              >
                <div>
                  <div className="font-mono text-[14px] font-semibold text-gray-50">{p.symbol}</div>
                  <div className="text-[11px] text-muted">{p.quantity} 股</div>
                </div>
                <div className="text-right">
                  <div className="tabular text-[13px] text-gray-100">${formatPrice(p.price)}</div>
                  <div className={`tabular text-[11px] ${changeColorClass(p.pnl)}`}>
                    {formatPercent(p.pnlPercent)}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>

      {showSettings && (
        <>
          <section className="px-3 pt-5">
            <div className="mb-1.5 px-1 text-[12px] font-medium text-gray-300">账户</div>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-surface-card">
              <Row label="初始资金" value={`$${formatPrice(config?.initialCash ?? 0)}`} />
              <Row label="时区" value={config?.timezone ?? '—'} />
            </div>
          </section>

          <section className="px-3 pt-4">
            <div className="mb-1.5 px-1 text-[12px] font-medium text-gray-300">图表偏好</div>
            <div className="rounded-xl border border-border/70 bg-surface-card px-3 py-3">
              <div className="mb-1.5 text-[12px] text-muted">
                默认 MA 周期（逗号分隔，默认 {DEFAULT_MA_PERIODS.join('/')}）
              </div>
              <div className="flex gap-2">
                <input
                  value={maDraft}
                  onChange={(e) => setMaDraft(e.target.value)}
                  inputMode="numeric"
                  className="input flex-1 py-2 text-[14px]"
                  placeholder="5,10,20"
                />
                <button type="button" onClick={commitMa} className="btn-primary m-tap px-4">
                  {saved ? '已保存' : '保存'}
                </button>
              </div>
            </div>
          </section>

          <section className="px-3 pt-4">
            <div className="mb-1.5 px-1 text-[12px] font-medium text-gray-300">数据源</div>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-surface-card">
              <Row label="行情" value={config?.marketDataProvider ?? '—'} />
              <Row label="新闻" value={config?.newsProvider ?? '—'} />
              <Row label="实时" value={config?.realtimeProvider ?? '—'} />
              <Row label="模型" value={config?.llmProvider ?? '—'} />
              <Row label="Fixture 模式" value={config?.fixtureMode ? '开启' : '关闭'} />
              {providers && <Row label="行情状态" value={providers.market} />}
              {providers && <Row label="新闻状态" value={providers.news} />}
            </div>
          </section>

          <section className="px-3 pt-4">
            <button
              type="button"
              onClick={() => {
                if (window.confirm('重置后所有持仓、委托和成交记录都会清空，确定吗？')) reset.mutate();
              }}
              disabled={reset.isPending}
              className="m-tap flex w-full items-center justify-center gap-2 rounded-xl border border-down/30 bg-down/10 py-3 text-[14px] font-medium text-down disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${reset.isPending ? 'animate-spin' : ''}`} />
              重置模拟账户
            </button>
          </section>

          <section className="px-3 pt-4">
            <div className="mb-1.5 px-1 text-[12px] font-medium text-gray-300">添加到主屏幕</div>
            <div className="rounded-xl border border-border/70 bg-surface-card px-3 py-3 text-[12px] leading-relaxed text-muted">
              <p className="text-gray-200">安装后可像 App 一样全屏打开。</p>
              <p className="mt-1.5">
                <span className="text-gray-300">iPhone：</span>
                Safari 打开 → 分享 →「添加到主屏幕」
              </p>
              <p className="mt-1">
                <span className="text-gray-300">Android：</span>
                Chrome 菜单 →「安装应用」或「添加到主屏幕」
              </p>
            </div>
          </section>
        </>
      )}

      <p className="px-4 pt-5 text-center text-[11px] leading-relaxed text-muted">
        本应用为模拟交易与事件研究工具，所有数据可能延迟或不准确，
        <br />
        不构成任何投资建议。
      </p>
    </div>
  );
}
