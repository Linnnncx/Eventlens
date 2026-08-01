import { Outlet, Link, useLocation } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { ProviderBadge } from './ProviderBadge';

export function Layout() {
  const location = useLocation();
  const isWorkbench = location.pathname.startsWith('/workbench');

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
        <div className="flex h-12 w-full items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Activity className="h-5 w-5 text-primary" strokeWidth={2.5} />
            <span>EventLens</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              to="/"
              className={location.pathname === '/' ? 'text-primary' : 'text-muted hover:text-gray-100'}
            >
              Market
            </Link>
            {isWorkbench && (
              <span className="text-muted">/ Workbench</span>
            )}
            <ProviderBadge />
          </nav>
        </div>
      </header>
      <main className="flex w-full flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
