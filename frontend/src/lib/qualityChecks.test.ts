import { describe, expect, it } from 'vitest';
import { summarizeQuality } from './qualityChecks';
import type { BaselineQualityChecks, DisciplineQuality } from './queries';

function disc(overrides: Partial<DisciplineQuality>): DisciplineQuality {
  return {
    discipline_code: 'PIPE',
    display_name: 'Piping',
    total_rows: 10,
    fld_whrs_missing_count: 0,
    fld_qty_missing_count: 0,
    no_milestone_count: 0,
    unmapped_work_type_count: 0,
    coa_out_of_scope_count: 0,
    unit_outlier_count: 0,
    ...overrides,
  };
}

const byKey = (qc: BaselineQualityChecks) =>
  Object.fromEntries(summarizeQuality(qc).map((c) => [c.key, c.count]));

describe('summarizeQuality', () => {
  it('returns exactly seven gates', () => {
    const gates = summarizeQuality({ milestone_weights: [], disciplines: [], unassigned_count: 0 });
    expect(gates).toHaveLength(7);
    expect(gates.map((g) => g.key)).toEqual([
      'fld_whrs',
      'fld_qty',
      'no_milestone',
      'unmapped_wt',
      'coa_scope',
      'unit_outlier',
      'unassigned',
    ]);
  });

  it('all-clean data yields zero on every gate', () => {
    const counts = byKey({
      milestone_weights: [],
      disciplines: [disc({}), disc({ discipline_code: 'CIVIL' })],
      unassigned_count: 0,
    });
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('sums each metric across disciplines and folds in unassigned_count', () => {
    const counts = byKey({
      milestone_weights: [],
      disciplines: [
        disc({ fld_whrs_missing_count: 2, no_milestone_count: 1, unit_outlier_count: 3 }),
        disc({
          discipline_code: 'CIVIL',
          fld_whrs_missing_count: 1,
          fld_qty_missing_count: 6,
          unmapped_work_type_count: 4,
          coa_out_of_scope_count: 5,
        }),
      ],
      unassigned_count: 7,
    });
    expect(counts.fld_whrs).toBe(3); // 2 + 1
    expect(counts.fld_qty).toBe(6);
    expect(counts.no_milestone).toBe(1);
    expect(counts.unmapped_wt).toBe(4);
    expect(counts.coa_scope).toBe(5);
    expect(counts.unit_outlier).toBe(3);
    expect(counts.unassigned).toBe(7); // project-level, not per-discipline
  });

  it('a gate fails (count > 0) only when a violation exists', () => {
    const gates = summarizeQuality({
      milestone_weights: [],
      disciplines: [disc({ coa_out_of_scope_count: 1 })],
      unassigned_count: 0,
    });
    const failing = gates.filter((g) => g.count > 0);
    expect(failing).toHaveLength(1);
    expect(failing[0]!.key).toBe('coa_scope');
  });
});
