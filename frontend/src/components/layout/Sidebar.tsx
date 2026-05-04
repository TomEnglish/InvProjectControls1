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
  Camera,
  TrendingUp,
  PieChart,
  Upload as UploadIcon,
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
      { to: '/progress', label: 'Progress', icon: Play },
      { to: '/progress/upload', label: 'Upload', icon: UploadIcon },
      { to: '/snapshots', label: 'Snapshots', icon: Camera },
      { to: '/changes', label: 'Change Mgmt', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/progress/earned-value', label: 'Earned Value', icon: TrendingUp },
      { to: '/progress/disciplines', label: 'Disciplines', icon: PieChart },
      { to: '/reports', label: 'Reports', icon: FileBarChart },
    ],
  },
];

export function Sidebar() {
  return (
    <aside
      className="fixed top-0 left-0 h-screen flex flex-col overflow-y-auto z-50 bg-[color:var(--color-surface)] border-r border-[color:var(--color-line)]"
      style={{ width: 'var(--sidebar-w)' }}
    >
      <div className="px-4 py-5 border-b border-[color:var(--color-line)]">
        <a href="/" className="flex items-center gap-2.5">
          <img src="/brand/invenio-mark.svg" alt="" className="w-8 h-8 dark:hidden" />
          <img src="/brand/invenio-mark-dark.svg" alt="" className="w-8 h-8 hidden dark:block" />
          <div>
            <div className="text-sm font-extrabold text-[color:var(--color-primary)] tracking-tight leading-none">
              Invenio
            </div>
            <div className="text-[11px] text-[color:var(--color-text-muted)] mt-0.5">
              ProjectControls
            </div>
          </div>
        </a>
      </div>

      <nav className="flex-1 py-2">
        {sections.map((section) => (
          <div key={section.label} className="mb-1">
            <div className="px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-widest text-[color:var(--color-text-subtle)] font-bold">
              {section.label}
            </div>
            {section.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-2.5 mx-2 px-2.5 py-2 text-sm rounded-md font-medium transition-colors',
                    isActive
                      ? 'bg-[color:var(--color-primary-soft)] text-[color:var(--color-primary)]'
                      : 'text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-raised)] hover:text-[color:var(--color-text)]',
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

      <div className="px-4 py-3 border-t border-[color:var(--color-line)] text-[11px] text-[color:var(--color-text-subtle)]">
        v0.1 · Phase 0
      </div>
    </aside>
  );
}
