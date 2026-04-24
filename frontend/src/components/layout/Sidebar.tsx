import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderCog,
  ListTree,
  SlidersHorizontal,
  Lock,
  Play,
  ArrowLeftRight,
  FileBarChart,
  type LucideIcon,
} from 'lucide-react';

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };
type NavSection = { label: string; items: NavItem[] };

const sections: NavSection[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Setup',
    items: [
      { to: '/projects', label: 'Project Setup', icon: FolderCog },
      { to: '/coa', label: 'COA & Unit Rates', icon: ListTree },
      { to: '/roc', label: 'Rules of Credit', icon: SlidersHorizontal },
    ],
  },
  {
    label: 'Execution',
    items: [
      { to: '/budget', label: 'Budget & Baseline', icon: Lock },
      { to: '/progress', label: 'Progress & EV', icon: Play },
      { to: '/changes', label: 'Change Mgmt', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Analytics',
    items: [{ to: '/reports', label: 'Reports', icon: FileBarChart }],
  },
];

export function Sidebar() {
  return (
    <aside
      className="fixed top-0 left-0 h-screen flex flex-col text-white overflow-y-auto z-50"
      style={{ width: 'var(--sidebar-w)', background: 'var(--color-primary)' }}
    >
      <div className="px-4 py-5 border-b border-white/15">
        <h1 className="text-sm font-bold tracking-wider uppercase">Invenio</h1>
        <div className="text-xs text-white/60 mt-1">ProjectControls</div>
      </div>

      <nav className="flex-1 py-3">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-white/40 font-semibold">
              {section.label}
            </div>
            {section.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 px-4 py-2.5 text-sm border-l-[3px] transition-colors',
                    isActive
                      ? 'bg-white/10 text-white border-[color:var(--color-accent)]'
                      : 'text-white/75 border-transparent hover:bg-white/5 hover:text-white',
                  ].join(' ')
                }
              >
                <Icon size={16} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-white/15 text-[11px] text-white/40">
        v0.1 · Phase 0
      </div>
    </aside>
  );
}
