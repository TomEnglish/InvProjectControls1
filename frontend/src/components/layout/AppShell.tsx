import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  return (
    <div className="min-h-screen flex bg-[color:var(--color-canvas)]">
      <Sidebar />
      <div className="flex-1 min-w-0" style={{ marginLeft: 'var(--sidebar-w)' }}>
        <Topbar />
        <main className="px-8 py-8 max-w-[1280px] mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
