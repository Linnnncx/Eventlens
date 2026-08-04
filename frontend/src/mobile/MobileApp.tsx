import { lazy, Suspense, useCallback } from 'react';
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LineChart, Newspaper, Wallet, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MobileMarketPage } from './pages/MobileMarketPage';
import { PullToRefresh } from './components/PullToRefresh';

const MobileNewsPage = lazy(() =>
  import('./pages/MobileNewsPage').then((module) => ({ default: module.MobileNewsPage })),
);
const MobileTradePage = lazy(() =>
  import('./pages/MobileTradePage').then((module) => ({ default: module.MobileTradePage })),
);
const MobileProfilePage = lazy(() =>
  import('./pages/MobileProfilePage').then((module) => ({ default: module.MobileProfilePage })),
);
const MobileStockPage = lazy(() =>
  import('./pages/MobileStockPage').then((module) => ({ default: module.MobileStockPage })),
);

interface TabDef {
  to: string;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { to: '/', label: '行情', icon: LineChart },
  { to: '/news', label: '资讯', icon: Newspaper },
  { to: '/trade', label: '交易', icon: Wallet },
  { to: '/me', label: '我的', icon: User },
];

function TabBar() {
  return (
    <nav className="safe-bottom sticky bottom-0 z-30 grid shrink-0 grid-cols-4 border-t border-border/80 bg-surface-raised/95 pt-1 backdrop-blur-md">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `m-tap flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium ${
              isActive ? 'text-primary' : 'text-muted'
            }`
          }
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function MobileRouteLoading() {
  return (
    <div className="flex min-h-full items-center justify-center bg-surface text-sm text-muted">
      正在加载页面…
    </div>
  );
}

export function MobileApp() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const fullScreen = location.pathname.startsWith('/workbench');

  const refresh = useCallback(async () => {
    const path = location.pathname;
    const allowed = path === '/news'
      ? new Set(['news', 'watchlist', 'portfolio'])
      : path === '/trade'
        ? new Set(['portfolio', 'positions', 'orders', 'trades'])
        : path === '/me'
          ? new Set([
              'portfolio',
              'equity-history',
              'closed-rankings',
              'orders',
              'public-config',
              'providers-status',
            ])
          : new Set(['marketStatus', 'portfolio', 'watchlist', 'snapshots', 'screener']);
    await queryClient.invalidateQueries({
      predicate: (query) => allowed.has(String(query.queryKey[0] ?? '')),
    });
  }, [location.pathname, queryClient]);

  const routes = (
    <Suspense fallback={<MobileRouteLoading />}>
      <Routes>
        <Route path="/" element={<MobileMarketPage />} />
        <Route path="/news" element={<MobileNewsPage />} />
        <Route path="/trade" element={<MobileTradePage />} />
        <Route path="/me" element={<MobileProfilePage />} />
        <Route path="/workbench/:symbol" element={<MobileStockPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-surface">
      {fullScreen ? (
        <div className="min-h-0 flex-1 overflow-hidden">{routes}</div>
      ) : (
        <>
          <PullToRefresh onRefresh={refresh} className="min-h-0 flex-1">
            {routes}
          </PullToRefresh>
          <TabBar />
        </>
      )}
    </div>
  );
}
