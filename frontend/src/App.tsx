import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useIsMobile } from './hooks/useIsMobile';

const MarketPage = lazy(() => import('./pages/MarketPage').then((m) => ({ default: m.MarketPage })));
const WorkbenchPage = lazy(() => import('./pages/WorkbenchPage').then((m) => ({ default: m.WorkbenchPage })));
const MobileApp = lazy(() => import('./mobile/MobileApp').then((m) => ({ default: m.MobileApp })));

function AppLoading() {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-surface text-sm text-muted">
      正在加载交易台…
    </div>
  );
}

export default function App() {
  // Same URLs on every device — the viewport decides which shell renders.
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Suspense fallback={<AppLoading />}>
        <MobileApp />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<AppLoading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MarketPage />} />
          <Route path="workbench/:symbol" element={<WorkbenchPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
