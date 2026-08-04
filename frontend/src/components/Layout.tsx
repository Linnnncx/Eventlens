import { Outlet, Link, useLocation } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { ProviderBadge } from './ProviderBadge';

export function Layout() {
  const location = useLocation();
  const isWorkbench = location.pathname.startsWith('/workbench');

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-surface/80 backdrop-blur-md">
        <div className="flex w-full items-center justify-between px-4 py-2.5 md:px-5">
          <Link
            to="/"
            className="group flex items-center gap-2.5 font-semibold tracking-tight text-gray-50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/30 transition-colors group-hover:bg-primary/25">
              <Activity className="h-4 w-4 text-primary" strokeWidth={2.5} />
            </span>
            <span className="text-base">EventLens</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              to="/"
              className={
                location.pathname === '/'
                  ? 'font-medium text-primary'
                  : 'text-muted transition-colors hover:text-gray-100'
              }
            >
              Market
            </Link>
            {isWorkbench && <span className="text-muted/80">/ Workbench</span>}
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
