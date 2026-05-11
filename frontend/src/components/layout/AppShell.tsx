import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

function RouteFallback() {
  return (
    <div className="is-surface p-6 space-y-3">
      <div className="is-skeleton" style={{ height: 20, width: 200 }} />
      <div className="is-skeleton" style={{ height: 200, width: '100%' }} />
    </div>
  );
}

export function AppShell() {
  return (
    <div className="min-h-screen flex bg-[color:var(--color-canvas)]">
      <Sidebar />
      <div className="flex-1 min-w-0" style={{ marginLeft: 'var(--sidebar-w)' }}>
        <Topbar />
        <main className="px-8 py-8 max-w-[1280px] mx-auto">
          {/*
            Lazy-loaded routes (Reports, QMR, Snapshots, EarnedValue, Budget,
            DisciplineProgress) suspend on first navigation. A single Suspense
            boundary here so each transition reuses the same skeleton.
          */}
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
