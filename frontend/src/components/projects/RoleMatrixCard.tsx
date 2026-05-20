import { Check, Minus, type LucideIcon } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';

/**
 * Role × Capability matrix per Sandra's UAT spec
 * (app_review_todo.md #17 + #18). Lives on /users so Controllers
 * have one place to look up "who can do what" without spelunking
 * through individual RLS policies and assert_role gates.
 *
 * The matrix reflects the AS-BUILT system, not an aspirational
 * design. When a capability moves (e.g. when Wave 4 admitted PMs
 * to baseline lock), update this table to match — the matrix is
 * the source of truth for what users should expect.
 *
 * Roles map to the projectcontrols.user_role enum:
 *   super_admin = "Super Controller"
 *   admin       = "Controller"
 *   pm          = "PM" (Auditor in Sandra's vocabulary)
 *   pc_reviewer = "PC Reviewer"
 *   editor      = "Editor"
 *   clerk       = "Clerk"
 *   viewer      = "Viewer" (CM / Superintendent in Sandra's vocabulary)
 */

type Capability = {
  label: string;
  description?: string;
  // Each role's level for this capability: 'full' = read+write, 'read' = view only,
  // 'limited' = scoped write (e.g. own rows / own project), null = no access.
  byRole: Partial<Record<RoleKey, Cell>>;
};

type RoleKey =
  | 'super_admin'
  | 'admin'
  | 'pm'
  | 'pc_reviewer'
  | 'editor'
  | 'clerk'
  | 'viewer';

type Cell = 'full' | 'read' | 'limited';

const ROLE_COLUMNS: { key: RoleKey; label: string }[] = [
  { key: 'super_admin', label: 'Super Controller' },
  { key: 'admin', label: 'Controller' },
  { key: 'pm', label: 'PM' },
  { key: 'pc_reviewer', label: 'PC Reviewer' },
  { key: 'editor', label: 'Editor' },
  { key: 'clerk', label: 'Clerk' },
  { key: 'viewer', label: 'Viewer' },
];

// Shorthand for the capability rows.
const F: Cell = 'full';
const R: Cell = 'read';
const L: Cell = 'limited';

const CAPABILITIES: { section: string; rows: Capability[] }[] = [
  {
    section: 'Tenant governance',
    rows: [
      {
        label: 'Manage users (invite, set role, alias foreman)',
        description: 'Includes the User Admin page and foreman alias linking.',
        byRole: { super_admin: F, admin: L },
      },
      {
        label: 'COA library — edit codes + U/R',
        description: 'Tenant-wide unit-rate baseline. Per-project PF override is on Project Setup.',
        byRole: { super_admin: F, admin: F, pm: R, pc_reviewer: R, editor: R, clerk: R, viewer: R },
      },
      {
        label: 'Rules of Credit (ROC) library — edit milestones',
        description: 'Variable 1–8 milestone weights per work type. Read-only for everyone below Controller.',
        byRole: { super_admin: F, admin: F, pm: R, pc_reviewer: R, editor: R, clerk: R, viewer: R },
      },
      {
        label: 'Assign clerk craft permissions',
        description: '(project, craft) tuples that gate which discipline a clerk can submit to.',
        byRole: { super_admin: F, admin: L, pm: L },
      },
    ],
  },
  {
    section: 'Project lifecycle',
    rows: [
      {
        label: 'Create / edit project metadata',
        byRole: { super_admin: F, admin: L, pm: L },
      },
      {
        label: 'Pick in-scope COA codes',
        byRole: { super_admin: F, admin: L, pm: L },
      },
      {
        label: 'Override per-project U/R (PF) — audit-logged',
        description: 'Controller-only per Sandra\'s tight scoping. The before-row + new override land in audit_log.',
        byRole: { super_admin: F, admin: F },
      },
      {
        label: 'Upload baseline (per-discipline zone)',
        byRole: { super_admin: F, admin: L, pm: L },
      },
      {
        label: 'Lock baseline (draft → active)',
        byRole: { super_admin: F, admin: F, pm: F },
      },
      {
        label: 'Close week / advance period',
        byRole: { super_admin: F, admin: F, pm: F },
      },
    ],
  },
  {
    section: 'Weekly progress',
    rows: [
      {
        label: 'Submit progress file to auditor queue',
        description: 'Clerk-only entry point. File parses server-side, goes through heuristic + LLM checks, then waits for auditor review.',
        byRole: { super_admin: F, admin: F, pm: F, pc_reviewer: F, editor: F, clerk: L },
      },
      {
        label: 'Direct-import progress file (bypass queue)',
        description: 'Editor+ skip the queue and write directly to progress_records.',
        byRole: { super_admin: F, admin: F, pm: F, pc_reviewer: F, editor: F },
      },
      {
        label: 'Review / approve / reject queued files',
        description: 'Auditor inbox at /upload-queue. Each approve commits to live data.',
        byRole: { super_admin: F, admin: F, pm: F, pc_reviewer: F, editor: F },
      },
      {
        label: 'Edit milestone values on a record',
        byRole: { super_admin: F, admin: F, pm: F, pc_reviewer: F, editor: F },
      },
      {
        label: 'View progress records',
        byRole: { super_admin: F, admin: F, pm: F, pc_reviewer: F, editor: F, clerk: R, viewer: R },
      },
    ],
  },
  {
    section: 'Change orders',
    rows: [
      {
        label: 'Submit a Change Order',
        byRole: { super_admin: F, admin: F, pm: F, pc_reviewer: F, editor: F },
      },
      {
        label: 'PC review (forward / reject pending COs)',
        byRole: { super_admin: F, admin: F, pm: F, pc_reviewer: F },
      },
      {
        label: 'Approve / reject reviewed COs',
        byRole: { super_admin: F, admin: F, pm: F },
      },
    ],
  },
  {
    section: 'Reports + analytics',
    rows: [
      {
        label: 'View Reports / Variance Analysis / Earned Value',
        byRole: { super_admin: R, admin: R, pm: R, pc_reviewer: R, editor: R, clerk: R, viewer: R },
      },
      {
        label: 'Export client-facing PDF / CSV from Reports + QMR',
        byRole: { super_admin: F, admin: F, pm: F, pc_reviewer: F, editor: F, clerk: R, viewer: R },
      },
      {
        label: 'View audit log',
        byRole: { super_admin: R, admin: R },
      },
    ],
  },
];

// Pure helper, not a component — returns the icon + title + className
// for a given cell state. Named camelCase so React's component-naming
// heuristics don't mistake it for a renderer.
function cellMeta(cell: Cell | undefined): {
  icon: LucideIcon | null;
  title: string;
  className: string;
} {
  if (cell === 'full') {
    return {
      icon: Check,
      title: 'Read + write',
      className: 'text-[color:var(--color-variance-favourable)]',
    };
  }
  if (cell === 'limited') {
    return {
      icon: Check,
      title: 'Scoped write (own project / own rows)',
      className: 'text-[color:var(--color-warn)]',
    };
  }
  if (cell === 'read') {
    return {
      icon: Minus,
      title: 'View only',
      className: 'text-[color:var(--color-text-muted)]',
    };
  }
  return {
    icon: null,
    title: 'No access',
    className: 'text-[color:var(--color-text-subtle)]',
  };
}

export function RoleMatrixCard() {
  return (
    <Card padded={false}>
      <div className="px-6 pt-5 pb-3">
        <CardHeader
          eyebrow="Access reference"
          title="Role matrix"
          caption="Who can do what, by tenant role."
        />
        <p className="text-xs text-[color:var(--color-text-muted)] mt-2 leading-relaxed">
          Names in the database stay as <code>admin</code> / <code>super_admin</code>;
          UI labels show <strong>Controller</strong> / <strong>Super Controller</strong>{' '}
          per Sandra's UAT.{' '}
          <span className="font-semibold text-[color:var(--color-variance-favourable)]">✓</span>{' '}
          = read + write ·{' '}
          <span className="font-semibold text-[color:var(--color-warn)]">✓</span>{' '}
          = scoped write (own project / own rows) ·{' '}
          <span className="font-semibold text-[color:var(--color-text-muted)]">−</span>{' '}
          = view only · blank = no access.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="is-table">
          <thead>
            <tr>
              <th style={{ minWidth: 260 }}>Capability</th>
              {ROLE_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="text-center text-[10px] uppercase tracking-widest"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((section) => (
              <SectionRows key={section.section} section={section} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SectionRows({
  section,
}: {
  section: { section: string; rows: Capability[] };
}) {
  return (
    <>
      <tr style={{ background: 'var(--color-raised)' }}>
        <td
          colSpan={1 + ROLE_COLUMNS.length}
          className="font-semibold text-[10px] uppercase tracking-widest text-[color:var(--color-text-muted)] py-2"
        >
          {section.section}
        </td>
      </tr>
      {section.rows.map((cap) => (
        <tr key={cap.label}>
          <td>
            <div className="text-sm font-medium">{cap.label}</div>
            {cap.description && (
              <div className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
                {cap.description}
              </div>
            )}
          </td>
          {ROLE_COLUMNS.map((col) => {
            const cell = cap.byRole[col.key];
            const { icon: Icon, title, className } = cellMeta(cell);
            return (
              <td key={col.key} className="text-center" title={title}>
                {Icon ? <Icon size={14} className={`inline ${className}`} /> : ''}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
