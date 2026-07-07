import type { BaselineQualityChecks } from '@/lib/queries';

/** One project-level quality gate: a label + how many rows violate it. */
export type QualityAgg = { key: string; label: string; count: number; hint: string };

/**
 * Collapse the per-discipline quality counts into six project-level gates.
 * Each gate's `count` is the number of offending rows across all disciplines;
 * a gate fails when count > 0. Kept pure (no React) so the pass/fail
 * arithmetic that feeds the Verify Load sign-off is unit-testable.
 */
export function summarizeQuality(qc: BaselineQualityChecks): QualityAgg[] {
  const sum = (f: (d: BaselineQualityChecks['disciplines'][number]) => number) =>
    qc.disciplines.reduce((n, d) => n + f(d), 0);
  return [
    {
      key: 'fld_whrs',
      label: 'FLD_WHRS present',
      count: sum((d) => d.fld_whrs_missing_count),
      hint: 'numbered rows (with a REC_NO) whose field work-hours are 0 or null',
    },
    {
      key: 'fld_qty',
      label: 'FLD_QTY present',
      count: sum((d) => d.fld_qty_missing_count),
      hint: 'numbered rows (with a REC_NO) whose field quantity is 0 or null',
    },
    {
      key: 'no_milestone',
      label: 'Milestones present',
      count: sum((d) => d.no_milestone_count),
      hint: 'mapped records with no milestone rows (can’t earn progressively)',
    },
    {
      key: 'unmapped_wt',
      label: 'Work types mapped',
      count: sum((d) => d.unmapped_work_type_count),
      hint: 'records with no work type (fall back to the discipline default)',
    },
    {
      key: 'coa_scope',
      label: 'Codes in COA scope',
      count: sum((d) => d.coa_out_of_scope_count),
      hint: 'records whose COA code is not in the project scope (won’t roll up in cost)',
    },
    {
      key: 'unit_outlier',
      label: 'Unit-hours outliers',
      count: sum((d) => d.unit_outlier_count),
      hint: 'budget hrs/qty >10× or <1/10× the discipline median',
    },
    {
      key: 'unassigned',
      label: 'Assigned to a discipline',
      count: qc.unassigned_count,
      hint: 'records with no discipline (won’t roll into any discipline report)',
    },
  ];
}
