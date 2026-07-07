import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

/**
 * Full-data export for Controllers (admin+). Pulls every project-scoped data
 * table plus the tenant libraries the data references, and writes a single
 * multi-sheet .xlsx workbook — one sheet per table. Reads go through the
 * normal client, so RLS still applies: a Controller sees their whole tenant,
 * nobody sees across tenants.
 *
 * Scope is either one project (project_id filter) or the whole tenant
 * ("all projects"). Child tables carry no project_id, so a single-project
 * export filters them through their parent via an inner-join embed.
 */

// 31-char sheet-name cap (Excel) + no []:*?/\ — keep names short and safe.
type Sheet = { name: string; rows: Record<string, unknown>[] };

type TableSpec = {
  sheet: string;
  table: string;
  // How to scope to one project. 'direct' → .eq('project_id', id).
  // 'tenant' → no project filter (shared library, exported whole).
  // Otherwise an embed path: [embedTable, fkColumn] filtered on the parent's
  // project_id via an !inner join.
  scope: 'direct' | 'tenant' | { via: string; on: string };
};

const TABLES: TableSpec[] = [
  { sheet: 'Projects', table: 'projects', scope: 'direct' },
  { sheet: 'Disciplines', table: 'project_disciplines', scope: 'direct' },
  { sheet: 'Progress Records', table: 'progress_records', scope: 'direct' },
  {
    sheet: 'Progress Milestones',
    table: 'progress_record_milestones',
    scope: { via: 'progress_records', on: 'progress_record_id' },
  },
  { sheet: 'Progress Snapshots', table: 'progress_snapshots', scope: 'direct' },
  {
    sheet: 'Snapshot Items',
    table: 'progress_snapshot_items',
    scope: { via: 'progress_snapshots', on: 'snapshot_id' },
  },
  { sheet: 'Actual Hours', table: 'actual_hours', scope: 'direct' },
  { sheet: 'Progress Periods', table: 'progress_periods', scope: 'direct' },
  { sheet: 'Progress Streams', table: 'project_progress_streams', scope: 'direct' },
  { sheet: 'Change Orders', table: 'change_orders', scope: 'direct' },
  {
    sheet: 'Change Order Events',
    table: 'change_order_events',
    scope: { via: 'change_orders', on: 'change_order_id' },
  },
  { sheet: 'Upload Queue', table: 'upload_queue', scope: 'direct' },
  { sheet: 'IWPs', table: 'iwps', scope: 'direct' },
  { sheet: 'Data Check Signoffs', table: 'data_check_signoffs', scope: 'direct' },
  { sheet: 'Import Manifests', table: 'import_manifests', scope: 'direct' },
  { sheet: 'Attachments', table: 'attachments', scope: 'direct' },
  { sheet: 'Project COA Scope', table: 'project_coa_codes', scope: 'direct' },
  // Tenant-wide libraries the project data references. Exported whole in both
  // modes — a project's records are meaningless without the code/rate lookups.
  { sheet: 'COA Codes', table: 'coa_codes', scope: 'tenant' },
  { sheet: 'Work Types', table: 'work_types', scope: 'tenant' },
  { sheet: 'Work Type Milestones', table: 'work_type_milestones', scope: 'tenant' },
];

// Supabase caps a select at 1000 rows by default, so every fetch must page
// through .range() — otherwise a large project's records export silently
// truncates. The first page requests an exact count so we know the total up
// front: this bounds the loop precisely and, critically, avoids issuing an
// out-of-range .range() request when the row count is an exact multiple of
// PAGE_SIZE (PostgREST answers those with a 416 error that would abort the
// whole export). Falls back to short-page detection if count is unavailable.
const PAGE_SIZE = 1000;

type Page = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
  count: number | null;
};

async function paginate(table: string, run: (from: number, to: number) => PromiseLike<Page>) {
  const all: Record<string, unknown>[] = [];
  let total = Infinity;
  for (let from = 0; all.length < total; from += PAGE_SIZE) {
    const { data, error, count } = await run(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (count != null) total = count;
    const page = data ?? [];
    all.push(...page);
    // No count (e.g. a view) → stop on the first short page.
    if (count == null && page.length < PAGE_SIZE) break;
  }
  return all;
}

// `projects` itself filters by id, not project_id, when scoped to one project.
async function fetchTable(spec: TableSpec, projectId: string | null): Promise<Record<string, unknown>[]> {
  if (spec.table === 'projects') {
    return paginate(spec.table, (from, to) => {
      const q = supabase.from('projects').select('*', { count: 'exact' }).range(from, to);
      return projectId ? q.eq('id', projectId) : q;
    });
  }

  if (!projectId || spec.scope === 'tenant') {
    return paginate(spec.table, (from, to) =>
      supabase.from(spec.table).select('*', { count: 'exact' }).range(from, to),
    );
  }

  if (spec.scope === 'direct') {
    return paginate(spec.table, (from, to) =>
      supabase
        .from(spec.table)
        .select('*', { count: 'exact' })
        .eq('project_id', projectId)
        .range(from, to),
    );
  }

  // Embed-filter a child table through its parent's project_id. The dynamic
  // embed string defeats supabase-js's compile-time query parser, so this one
  // call is built through a narrow cast rather than the typed builder.
  const { via } = spec.scope;
  const rows = await paginate(spec.table, (from, to) => {
    const query = supabase
      .from(spec.table)
      .select(`*, ${via}!inner(project_id)`, { count: 'exact' }) as unknown as {
      eq: (col: string, val: string) => { range: (from: number, to: number) => PromiseLike<Page> };
    };
    return query.eq(`${via}.project_id`, projectId).range(from, to);
  });
  // Strip the join artifact so the sheet holds only the child's own columns.
  return rows.map((r) => {
    const rest = { ...r };
    delete rest[via];
    return rest;
  });
}

/**
 * Fetch every table and build+download the workbook. Returns a short summary
 * (sheet count, total rows) for the caller to surface.
 */
export async function exportProjectData(opts: {
  projectId: string | null; // null → all projects in the tenant
  filenameBase: string;
}): Promise<{ sheets: number; rows: number }> {
  const sheets: Sheet[] = [];
  for (const spec of TABLES) {
    const rows = await fetchTable(spec, opts.projectId);
    sheets.push({ name: spec.sheet, rows });
  }

  const wb = XLSX.utils.book_new();
  let totalRows = 0;
  for (const s of sheets) {
    totalRows += s.rows.length;
    // json_to_sheet on [] yields an empty sheet; add a single header note so an
    // empty tab isn't mistaken for a failed fetch.
    const ws = s.rows.length
      ? XLSX.utils.json_to_sheet(s.rows)
      : XLSX.utils.aoa_to_sheet([['(no rows)']]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }

  XLSX.writeFile(wb, `${opts.filenameBase}.xlsx`);
  return { sheets: sheets.length, rows: totalRows };
}
