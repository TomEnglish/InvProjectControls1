import type { ParsedRow } from './progressParser';

/**
 * Ingestion Data Check — manifest capture + file-vs-database diff.
 *
 * A manifest is the "answer key": per-tab aggregates computed from the exact
 * payload the QMR baseline card sent to import-baseline-records, persisted to
 * import_manifests at import time. The Data Check page recomputes the same
 * aggregates from the database (baseline_ingestion_stats RPC) and diffs the
 * two sides key-for-key. Sums act as checksums — they catch dropped rows,
 * truncated values, and unit-scaling errors that count-only checks miss.
 *
 * Column keys use the DATABASE column names (iwp_name → iwp_id) so manifest
 * and RPC output diff directly. Fields the baseline import intentionally
 * transforms are excluded from the strict grid and documented on the page:
 * description (fallback chain to '(unnamed)'), uom (defaulted to EA),
 * percent_complete + milestone values (pinned to 0), earned_*_imported
 * (nulled), work_type (compared via the per-code pivot instead, because
 * unknown codes legitimately land as NULL work_type_id).
 */

// parser field → manifest/DB column key
const COLUMN_FIELDS: ReadonlyArray<readonly [keyof ParsedRow, string]> = [
  ['dwg', 'dwg'],
  ['rev', 'rev'],
  ['code', 'code'],
  ['tag_no', 'tag_no'],
  ['spool_fr', 'spool_fr'],
  ['sched_id', 'sched_id'],
  ['system', 'system'],
  ['carea', 'carea'],
  ['line_area', 'line_area'],
  ['var_area', 'var_area'],
  ['test_pkg', 'test_pkg'],
  ['cwp', 'cwp'],
  ['foreman_name', 'foreman_name'],
  ['gen_foreman_name', 'gen_foreman_name'],
  ['attr_type', 'attr_type'],
  ['attr_size', 'attr_size'],
  ['attr_spec', 'attr_spec'],
  ['paint_spec', 'paint_spec'],
  ['insu_spec', 'insu_spec'],
  ['heat_trace_spec', 'heat_trace_spec'],
  ['service', 'service'],
  ['ta_bank', 'ta_bank'],
  ['ta_bay', 'ta_bay'],
  ['ta_level', 'ta_level'],
  ['pslip', 'pslip'],
  ['discipline_label', 'discipline_label'],
  ['budget_qty', 'budget_qty'],
  ['spl_cnt', 'spl_cnt'],
  ['source_row', 'source_row'],
  ['iwp_name', 'iwp_id'],
] as const;

export type NumericRange = { min: number | null; max: number | null };

export type ManifestStats = {
  columns: Record<string, number>;
  sums: { budget_qty: number; budget_hrs: number; spl_cnt: number };
  numeric_ranges: {
    budget_qty: NumericRange;
    budget_hrs: NumericRange;
    source_row: NumericRange;
  };
  budget_hrs_nonzero: number;
  milestone_entries: number;
  /** Per-WORK_TYPE-code row counts; rows without a code land on '(none)'. */
  work_types: Record<string, number>;
};

/** Row shape of the import_manifests table. */
export type ImportManifest = {
  id: string;
  sheet_name: string;
  discipline_code: string | null;
  source_filename: string | null;
  sheet_row_count: number;
  parsed_row_count: number;
  stats: ManifestStats;
  created_at: string;
};

/** One per-discipline object from the baseline_ingestion_stats RPC. */
export type DisciplineIngestionStats = {
  discipline_code: string;
  display_name: string;
  row_count: number;
  milestone_entries: number;
  columns: Record<string, number>;
  sums: { budget_qty: number; budget_hrs: number; spl_cnt: number };
  numeric_ranges: {
    budget_qty: NumericRange;
    budget_hrs: NumericRange;
    source_row: NumericRange;
  };
  budget_hrs_nonzero: number;
  work_types: Record<string, number>;
};

export function buildManifestStats(rows: ParsedRow[]): ManifestStats {
  const columns: Record<string, number> = {};
  for (const [, key] of COLUMN_FIELDS) columns[key] = 0;

  const sums = { budget_qty: 0, budget_hrs: 0, spl_cnt: 0 };
  const ranges: ManifestStats['numeric_ranges'] = {
    budget_qty: { min: null, max: null },
    budget_hrs: { min: null, max: null },
    source_row: { min: null, max: null },
  };
  let budgetHrsNonzero = 0;
  let milestoneEntries = 0;
  const workTypes: Record<string, number> = {};

  const widen = (r: NumericRange, v: number) => {
    r.min = r.min === null ? v : Math.min(r.min, v);
    r.max = r.max === null ? v : Math.max(r.max, v);
  };

  for (const row of rows) {
    for (const [field, key] of COLUMN_FIELDS) {
      if (row[field] !== undefined && row[field] !== null) columns[key]!++;
    }
    if (row.budget_qty !== undefined) {
      sums.budget_qty += row.budget_qty;
      widen(ranges.budget_qty, row.budget_qty);
    }
    // budget_hrs is NOT NULL DEFAULT 0 in the DB, so absent file values load
    // as 0 — count/range over the effective (defaulted) value to match.
    const hrs = row.budget_hrs ?? 0;
    sums.budget_hrs += hrs;
    widen(ranges.budget_hrs, hrs);
    if (hrs !== 0) budgetHrsNonzero++;
    if (row.spl_cnt !== undefined) sums.spl_cnt += row.spl_cnt;
    if (row.source_row !== undefined) widen(ranges.source_row, row.source_row);
    milestoneEntries += row.milestones?.length ?? 0;
    const wt = row.work_type ?? '(none)';
    workTypes[wt] = (workTypes[wt] ?? 0) + 1;
  }

  return {
    columns,
    sums,
    numeric_ranges: ranges,
    budget_hrs_nonzero: budgetHrsNonzero,
    milestone_entries: milestoneEntries,
    work_types: workTypes,
  };
}

/**
 * Latest manifest per sheet. History is kept in the table so a duplicate
 * re-import shows as DB > manifest; only the newest expectation per tab
 * participates in the diff.
 */
export function latestManifestsBySheet(manifests: ImportManifest[]): ImportManifest[] {
  const bySheet = new Map<string, ImportManifest>();
  for (const m of manifests) {
    const prev = bySheet.get(m.sheet_name);
    if (!prev || m.created_at > prev.created_at) bySheet.set(m.sheet_name, m);
  }
  return [...bySheet.values()].sort((a, b) => a.sheet_name.localeCompare(b.sheet_name));
}

export type CheckStatus = 'pass' | 'fail';

export type IngestionCheck = {
  key: string;
  label: string;
  expected: number;
  actual: number;
  status: CheckStatus;
};

// numeric(14,3) storage rounds each row to 3 decimals, so an aggregate can
// drift from the float sum by up to 0.0005/row. Anything beyond that band is
// a real discrepancy.
function sumsMatch(expected: number, actual: number, rowCount: number): boolean {
  return Math.abs(expected - actual) <= 0.01 + 0.0005 * rowCount;
}

function check(
  key: string,
  label: string,
  expected: number,
  actual: number,
  pass: boolean,
): IngestionCheck {
  return { key, label, expected, actual, status: pass ? 'pass' : 'fail' };
}

/**
 * Per-discipline row/sum/milestone checks: ALL manifest tabs that landed on
 * one discipline vs that discipline's DB group. Taking an array guards the
 * (unexpected but unguardable-at-parse-time) case of two tabs resolving to
 * the same discipline_code — their expectations sum before the diff instead
 * of each tab failing against the combined DB total.
 */
export function compareDiscipline(
  manifests: ImportManifest[],
  db: DisciplineIngestionStats | undefined,
): IngestionCheck[] {
  const rows = manifests.reduce((n, m) => n + m.parsed_row_count, 0);
  const milestones = manifests.reduce((n, m) => n + m.stats.milestone_entries, 0);
  const sumQty = manifests.reduce((n, m) => n + m.stats.sums.budget_qty, 0);
  const sumHrs = manifests.reduce((n, m) => n + m.stats.sums.budget_hrs, 0);
  const d = (v: number | undefined) => v ?? 0;
  return [
    check('row_count', 'Records loaded', rows, d(db?.row_count), rows === d(db?.row_count)),
    check(
      'milestone_entries',
      'Milestone entries',
      milestones,
      d(db?.milestone_entries),
      milestones === d(db?.milestone_entries),
    ),
    check(
      'sum_budget_qty',
      'Σ budget qty (FLD_QTY)',
      sumQty,
      d(db?.sums.budget_qty),
      sumsMatch(sumQty, d(db?.sums.budget_qty), rows),
    ),
    check(
      'sum_budget_hrs',
      'Σ budget hrs (FLD_WHRS)',
      sumHrs,
      d(db?.sums.budget_hrs),
      sumsMatch(sumHrs, d(db?.sums.budget_hrs), rows),
    ),
  ];
}

/**
 * Column-coverage grid: summed manifest non-null counts vs summed DB counts.
 * The DB side is scoped to disciplines that HAVE manifests — records loaded
 * outside the QMR flow (per-discipline zones, unassigned) have no file-side
 * expectation and would otherwise inflate `actual` into false failures.
 * The page surfaces those separately via the unmanifested-disciplines
 * warning.
 */
export function compareColumns(
  manifests: ImportManifest[],
  db: DisciplineIngestionStats[],
): IngestionCheck[] {
  const expected: Record<string, number> = {};
  for (const m of manifests) {
    for (const [key, n] of Object.entries(m.stats.columns)) {
      expected[key] = (expected[key] ?? 0) + n;
    }
  }
  const manifested = new Set(manifests.map((m) => m.discipline_code).filter(Boolean));
  const actual: Record<string, number> = {};
  for (const s of db) {
    if (!manifested.has(s.discipline_code)) continue;
    for (const [key, n] of Object.entries(s.columns)) {
      actual[key] = (actual[key] ?? 0) + n;
    }
  }
  return Object.keys(expected)
    .sort()
    .map((key) =>
      check(`col_${key}`, key, expected[key]!, actual[key] ?? 0, expected[key] === (actual[key] ?? 0)),
    );
}

export type WorkTypePivotRow = {
  disciplineCode: string;
  workType: string;
  expected: number;
  actual: number;
  status: CheckStatus;
};

// The import's work-type lookup is case-insensitive, so a lowercase code in
// the file still resolves to the library's canonical (uppercase) code. Fold
// both pivot sides to uppercase before diffing so casing alone never fails.
function normalizeWorkTypeKeys(pivot: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(pivot)) {
    // '(none)' is our no-work-type sentinel, not a code — leave it alone.
    const norm = key === '(none)' ? key : key.toUpperCase();
    out[norm] = (out[norm] ?? 0) + n;
  }
  return out;
}

/**
 * Discipline × work-type pivot. Manifest counts unknown codes under their
 * own name while the DB stores them as NULL work_type_id ('(none)'), so a
 * code that exists in the file but not the library shows as expected > 0 /
 * actual 0 alongside an inflated '(none)' — exactly the signal wanted.
 */
export function compareWorkTypePivot(
  manifests: ImportManifest[],
  db: DisciplineIngestionStats[],
): WorkTypePivotRow[] {
  const dbByCode = new Map(db.map((s) => [s.discipline_code, s]));
  const out: WorkTypePivotRow[] = [];
  const seenDisciplines = new Set<string>();
  for (const m of manifests) {
    if (!m.discipline_code || seenDisciplines.has(m.discipline_code)) continue;
    seenDisciplines.add(m.discipline_code);
    const sameDiscipline = manifests.filter((x) => x.discipline_code === m.discipline_code);
    const expectedPivot = normalizeWorkTypeKeys(
      sameDiscipline.reduce<Record<string, number>>((acc, x) => {
        for (const [k, n] of Object.entries(x.stats.work_types)) acc[k] = (acc[k] ?? 0) + n;
        return acc;
      }, {}),
    );
    const actualPivot = normalizeWorkTypeKeys(
      dbByCode.get(m.discipline_code)?.work_types ?? {},
    );
    const codes = new Set([...Object.keys(expectedPivot), ...Object.keys(actualPivot)]);
    for (const wt of [...codes].sort()) {
      const expected = expectedPivot[wt] ?? 0;
      const actual = actualPivot[wt] ?? 0;
      out.push({
        disciplineCode: m.discipline_code,
        workType: wt,
        expected,
        actual,
        status: expected === actual ? 'pass' : 'fail',
      });
    }
  }
  return out;
}
