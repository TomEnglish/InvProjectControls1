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
  ClipboardList,
  Upload as UploadIcon,
  Inbox,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useCurrentUser, hasRole, type UserRole } from '@/lib/queries';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /**
   * Minimum tenant role required to see this nav item. Items with no
   * minRole are visible to every authenticated user (any role >= viewer).
   * Server-side RLS + assert_role enforces the real authorization; this
   * just hides UI that won't function for under-privileged users.
   */
  minRole?: UserRole;
};
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
      { to: '/work-types', label: 'Rules of Credit (ROC)', icon: SlidersHorizontal },
      // A15: tenant-wide user / invite / alias admin lives here so it
      // doesn't crowd the per-project setup page.
      { to: '/users', label: 'User Admin', icon: Users, minRole: 'admin' },
    ],
  },
  {
    label: 'Execution',
    items: [
      { to: '/budget', label: 'Budget & Baseline', icon: Lock },
      { to: '/progress', label: 'Progress', icon: Play },
      { to: '/progress/upload', label: 'Upload', icon: UploadIcon },
      // Auditor inbox — review queued clerk submissions. Hidden from
      // viewer/clerk; clerks see their own submissions inline on the
      // /progress/upload page instead.
      { to: '/upload-queue', label: 'Upload Queue', icon: Inbox, minRole: 'pc_reviewer' },
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
      { to: '/qmr', label: 'QMR Report', icon: ClipboardList },
    ],
  },
];

export function Sidebar() {
  const { data: me } = useCurrentUser();
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
        {sections.map((section) => {
          const items = section.items.filter(
            (i) => !i.minRole || hasRole(me?.role, i.minRole),
          );
          if (items.length === 0) return null;
          return (
          <div key={section.label} className="mb-1">
            <div className="px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-widest text-[color:var(--color-text-subtle)] font-bold">
              {section.label}
            </div>
            {items.map(({ to, label, icon: Icon, end }) => (
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
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-[color:var(--color-line)] text-[11px] text-[color:var(--color-text-subtle)]">
        v0.1 · Phase 0
      </div>
    </aside>
  );
}
