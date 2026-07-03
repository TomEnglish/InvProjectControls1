import { describe, expect, it } from 'vitest';
import type { ParsedRow } from './progressParser';
import {
  buildManifestStats,
  latestManifestsBySheet,
  compareDiscipline,
  compareColumns,
  compareWorkTypePivot,
  type ImportManifest,
  type DisciplineIngestionStats,
} from './ingestionStats';

const rows: ParsedRow[] = [
  {
    dwg: 'CV-100',
    code: '04130',
    budget_qty: 187,
    budget_hrs: 1271.6,
    spl_cnt: 2,
    source_row: 1,
    iwp_name: 'IWP-1',
    work_type: 'CIV-FDN',
    discipline_label: 'Civil',
    milestones: [
      { name: 'Formwork', pct: 100 },
      { name: 'Rebar', pct: 50 },
    ],
  },
  {
    dwg: 'CV-101',
    budget_qty: 10,
    // budget_hrs absent → defaults to 0 in the DB; manifest mirrors that.
    source_row: 2,
    work_type: 'CIV-FDN',
    discipline_label: 'Civil',
    milestones: [{ name: 'Complete', pct: 0 }],
  },
  {
    dwg: 'CV-102',
    budget_hrs: 8,
    source_row: 3,
    discipline_label: 'Civil',
    // no work_type → lands on '(none)'
  },
];

function manifest(overrides: Partial<ImportManifest>): ImportManifest {
  return {
    id: 'm1',
    sheet_name: 'Civ Audit',
    discipline_code: 'CIVIL',
    source_filename: 'qmr.xlsx',
    sheet_row_count: 3,
    parsed_row_count: 3,
    stats: buildManifestStats(rows),
    created_at: '2026-07-03T00:00:00Z',
    ...overrides,
  };
}

function dbStats(overrides: Partial<DisciplineIngestionStats>): DisciplineIngestionStats {
  return {
    discipline_code: 'CIVIL',
    display_name: 'Civil',
    row_count: 3,
    milestone_entries: 3,
    columns: buildManifestStats(rows).columns,
    sums: { budget_qty: 197, budget_hrs: 1279.6, spl_cnt: 2 },
    numeric_ranges: {
      budget_qty: { min: 10, max: 187 },
      budget_hrs: { min: 0, max: 1271.6 },
      source_row: { min: 1, max: 3 },
    },
    budget_hrs_nonzero: 2,
    work_types: { 'CIV-FDN': 2, '(none)': 1 },
    ...overrides,
  };
}

describe('buildManifestStats', () => {
  it('counts non-null values per column with DB column names', () => {
    const stats = buildManifestStats(rows);
    expect(stats.columns.dwg).toBe(3);
    expect(stats.columns.code).toBe(1);
    expect(stats.columns.budget_qty).toBe(2);
    expect(stats.columns.spl_cnt).toBe(1);
    expect(stats.columns.iwp_id).toBe(1); // iwp_name → iwp_id
    expect(stats.columns.tag_no).toBe(0);
  });

  it('computes sums, ranges, and the nonzero-hours count', () => {
    const stats = buildManifestStats(rows);
    expect(stats.sums.budget_qty).toBeCloseTo(197);
    expect(stats.sums.budget_hrs).toBeCloseTo(1279.6);
    expect(stats.sums.spl_cnt).toBe(2);
    expect(stats.numeric_ranges.budget_qty).toEqual({ min: 10, max: 187 });
    // absent budget_hrs participates as the DB default 0
    expect(stats.numeric_ranges.budget_hrs).toEqual({ min: 0, max: 1271.6 });
    expect(stats.numeric_ranges.source_row).toEqual({ min: 1, max: 3 });
    expect(stats.budget_hrs_nonzero).toBe(2);
  });

  it('counts milestone entries and pivots work types with (none)', () => {
    const stats = buildManifestStats(rows);
    expect(stats.milestone_entries).toBe(3);
    expect(stats.work_types).toEqual({ 'CIV-FDN': 2, '(none)': 1 });
  });
});

describe('latestManifestsBySheet', () => {
  it('keeps only the newest manifest per sheet', () => {
    const older = manifest({ id: 'a', created_at: '2026-07-01T00:00:00Z' });
    const newer = manifest({ id: 'b', created_at: '2026-07-02T00:00:00Z' });
    const other = manifest({ id: 'c', sheet_name: 'Pipe Audit' });
    const latest = latestManifestsBySheet([older, other, newer]);
    expect(latest.map((m) => m.id).sort()).toEqual(['b', 'c']);
  });
});

describe('compareDiscipline', () => {
  it('passes when DB matches the manifest', () => {
    const checks = compareDiscipline([manifest({})], dbStats({}));
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('fails row count and sums on a partial load', () => {
    const checks = compareDiscipline(
      [manifest({})],
      dbStats({ row_count: 2, milestone_entries: 2, sums: { budget_qty: 187, budget_hrs: 1271.6, spl_cnt: 2 } }),
    );
    const byKey = new Map(checks.map((c) => [c.key, c.status]));
    expect(byKey.get('row_count')).toBe('fail');
    expect(byKey.get('milestone_entries')).toBe('fail');
    expect(byKey.get('sum_budget_qty')).toBe('fail');
  });

  it('fails everything when the discipline is missing from the DB entirely', () => {
    const checks = compareDiscipline([manifest({})], undefined);
    expect(checks.filter((c) => c.status === 'fail').map((c) => c.key)).toContain('row_count');
  });

  it('tolerates numeric(14,3) rounding drift in sums', () => {
    const checks = compareDiscipline(
      [manifest({})],
      dbStats({ sums: { budget_qty: 197.001, budget_hrs: 1279.599, spl_cnt: 2 } }),
    );
    expect(checks.find((c) => c.key === 'sum_budget_qty')!.status).toBe('pass');
    expect(checks.find((c) => c.key === 'sum_budget_hrs')!.status).toBe('pass');
  });
});

describe('compareColumns', () => {
  it('sums across manifests and flags a dropped column', () => {
    const m = manifest({});
    const db = dbStats({ columns: { ...m.stats.columns, cwp: 0, dwg: 2 } });
    const checks = compareColumns([m], [db]);
    expect(checks.find((c) => c.label === 'dwg')!.status).toBe('fail');
    expect(checks.find((c) => c.label === 'code')!.status).toBe('pass');
  });

  it('treats a column absent from the DB stats as 0', () => {
    const m = manifest({});
    const withoutDwg = { ...dbStats({}).columns };
    delete withoutDwg.dwg;
    const checks = compareColumns([m], [dbStats({ columns: withoutDwg })]);
    const dwg = checks.find((c) => c.label === 'dwg')!;
    expect(dwg.actual).toBe(0);
    expect(dwg.status).toBe('fail');
  });
});

describe('compareWorkTypePivot', () => {
  it('unions codes from both sides and matches counts', () => {
    const pivotRows = compareWorkTypePivot([manifest({})], [dbStats({})]);
    expect(pivotRows).toHaveLength(2);
    expect(pivotRows.every((p) => p.status === 'pass')).toBe(true);
  });

  it('surfaces a code missing from the work-types library', () => {
    // File says CIV-XX ×1, DB stored it as NULL work_type_id → '(none)' inflated.
    const m = manifest({});
    m.stats.work_types = { 'CIV-FDN': 2, 'CIV-XX': 1 };
    const db = dbStats({ work_types: { 'CIV-FDN': 2, '(none)': 1 } });
    const pivotRows = compareWorkTypePivot([m], [db]);
    const missing = pivotRows.find((p) => p.workType === 'CIV-XX')!;
    expect(missing).toMatchObject({ expected: 1, actual: 0, status: 'fail' });
    const none = pivotRows.find((p) => p.workType === '(none)')!;
    expect(none).toMatchObject({ expected: 0, actual: 1, status: 'fail' });
  });
});

describe('review-fix regressions', () => {
  it('compareColumns ignores DB disciplines that have no manifest', () => {
    const m = manifest({});
    const zoneLoaded = dbStats({
      discipline_code: 'STEEL',
      display_name: 'Steel',
      columns: { ...dbStats({}).columns, dwg: 40 },
    });
    const checks = compareColumns([m], [dbStats({}), zoneLoaded]);
    // Steel's 40 dwg values must not inflate `actual` past the manifest's 3.
    expect(checks.find((c) => c.label === 'dwg')!).toMatchObject({
      expected: 3,
      actual: 3,
      status: 'pass',
    });
  });

  it('compareDiscipline sums multiple tabs sharing a discipline', () => {
    const a = manifest({ id: 'a', sheet_name: 'Civ Audit' });
    const b = manifest({ id: 'b', sheet_name: 'Civ Audit 2' });
    const combined = dbStats({
      row_count: 6,
      milestone_entries: 6,
      sums: { budget_qty: 394, budget_hrs: 2559.2, spl_cnt: 4 },
    });
    const checks = compareDiscipline([a, b], combined);
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('compareWorkTypePivot folds casing before diffing', () => {
    const m = manifest({});
    m.stats.work_types = { 'civ-fdn': 2, '(none)': 1 };
    const pivotRows = compareWorkTypePivot([m], [dbStats({})]); // DB has 'CIV-FDN': 2
    expect(pivotRows.every((p) => p.status === 'pass')).toBe(true);
    expect(pivotRows.map((p) => p.workType).sort()).toEqual(['(none)', 'CIV-FDN']);
  });
});
