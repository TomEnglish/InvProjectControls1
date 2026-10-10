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
  ClipboardCheck,
  Upload as UploadIcon,
  Clock3,
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
      { to: '/projects', label: 'Project Setup & Baseline', icon: FolderCog },
      // Post-import reconciliation: did everything in the uploaded QMR
      // workbook actually land in the database?
      { to: '/data-check', label: 'Data Check', icon: ClipboardCheck },
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
      { to: '/budget', label: 'Budget', icon: Lock },
      { to: '/progress', label: 'Progress', icon: Play },
      { to: '/progress/upload', label: 'Progress Audit', icon: UploadIcon },
      { to: '/progress/actual-hours', label: 'Actual Hours', icon: Clock3, minRole: 'pc_reviewer' },
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
      className="fixed top-0 left-0 h-screen flex flex-col overflow-y-auto z-50 bg-[color:var(--color-sidebar)] text-[color:var(--color-sidebar-ink)] border-r border-[color:var(--color-sidebar-border)]"
      style={{ width: 'var(--sidebar-w)' }}
    >
      <div className="flex items-center justify-center px-2 border-b border-[color:var(--color-sidebar-border)]" style={{ height: 'var(--topbar-h)' }}>
        <a href="/" className="flex items-center" aria-label="Invenio ProjectControls home">
          {/* Light-text logo: the sidebar is navy in both themes. */}
          <img src="/brand/invenio-technologies-logo-light.png" alt="Invenio Technologies" className="h-10 w-auto" />
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
            <div className="px-5 pt-3 pb-1 text-[11px] uppercase tracking-[0.05em] text-[color:var(--color-sidebar-muted)]">
              {section.label}
            </div>
            {items.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-2.5 pl-[17px] pr-5 py-2 text-sm border-l-[3px] transition-colors',
                    isActive
                      ? 'border-[color:var(--color-sidebar-accent)] bg-[color:var(--color-sidebar-active)] text-white font-medium [&>svg]:text-[color:var(--color-sidebar-accent)]'
                      : 'border-transparent text-[color:var(--color-sidebar-ink)] hover:bg-[color:var(--color-sidebar-hover)] [&>svg]:text-[color:var(--color-sidebar-muted)]',
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

      <div className="px-5 py-3 border-t border-[color:var(--color-sidebar-border)] text-[11px] text-[color:var(--color-sidebar-muted)]">
        v0.1 · Phase 0
      </div>
    </aside>
  );
}
