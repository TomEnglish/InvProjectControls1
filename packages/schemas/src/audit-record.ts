import { z } from 'zod';
import { DisciplineCode, RecordStatus, Uom } from './enums';

export const MilestoneValue = z.number().min(0).max(1);

export const AuditRecord = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid(),
  discipline_id: z.string().uuid(),
  coa_code_id: z.string().uuid(),
  rec_no: z.number().int().positive(),
  dwg: z.string().min(1),
  rev: z.string().min(1),
  description: z.string().min(1),
  uom: Uom,
  fld_qty: z.number().nonnegative(),
  fld_whrs: z.number().nonnegative(),
  status: RecordStatus,
});
export type AuditRecord = z.infer<typeof AuditRecord>;

export const MilestoneUpdate = z.object({
  seq: z.number().int().min(1).max(8),
  value: MilestoneValue,
});
export type MilestoneUpdate = z.infer<typeof MilestoneUpdate>;

export const RecordUpdateMilestonesPayload = z.object({
  record_id: z.string().uuid(),
  milestones: z.array(MilestoneUpdate).min(1).max(8),
});
export type RecordUpdateMilestonesPayload = z.infer<typeof RecordUpdateMilestonesPayload>;

/**
 * The 61-column unified audit workbook schema (Phase 0 surface: types only;
 * full validation rules enforced in `import-audit-records` Edge Function).
 * See ARCHITECTURE.md §XIV for the column-by-column contract.
 */
export const UnifiedAuditRow = z.object({
  rec_no: z.number().int().optional(),
  project_code: z.string(),
  source_file: z.string(),
  source_sheet: z.string(),
  source_row: z.number().int(),
  row_hash: z.string(),
  dwg: z.string(),
  rev: z.string(),
  sheet: z.string().optional(),
  dwg_title: z.string().optional(),
  ifc_date: z.string().optional(),
  area: z.string(),
  sub_area: z.string().optional(),
  unit: z.string().optional(),
  system: z.string().optional(),
  line_tag: z.string().optional(),
  iso: z.string().optional(),
  spool_or_joint: z.string().optional(),
  discipline_code: DisciplineCode,
  coa_prime: z.string(),
  coa_code: z.string(),
  description: z.string(),
  uom: Uom,
  ifc_qty: z.number().nonnegative(),
  contract_qty: z.number().nonnegative().optional(),
  fld_qty: z.number().nonnegative(),
  prev_fld_qty: z.number().nonnegative().optional(),
  qty_source: z.enum(['takeoff', 'ifc', 'field_measured', 'co']).optional(),
  base_rate: z.number().nonnegative().optional(),
  pf_adj: z.number().positive().optional(),
  pf_rate: z.number().nonnegative().optional(),
  fld_whrs: z.number().nonnegative().optional(),
  budget_whrs: z.number().nonnegative().optional(),
  m1: MilestoneValue.default(0),
  m2: MilestoneValue.default(0),
  m3: MilestoneValue.default(0),
  m4: MilestoneValue.default(0),
  m5: MilestoneValue.default(0),
  m6: MilestoneValue.default(0),
  m7: MilestoneValue.default(0),
  m8: MilestoneValue.default(0),
  earn_pct: z.number().optional(),
  ern_qty: z.number().optional(),
  earn_whrs: z.number().optional(),
  prev_earn_whrs: z.number().optional(),
  period_earn_whrs: z.number().optional(),
  planned_start: z.string().optional(),
  planned_end: z.string().optional(),
  actual_start: z.string().optional(),
  forecast_end: z.string().optional(),
  total_float_days: z.number().int().optional(),
  hold_point: z.boolean().optional(),
  nde_status: z.enum(['pending', 'complete', 'failed', 'n/a']).optional(),
  punch_list_open: z.number().int().nonnegative().optional(),
  record_status: RecordStatus,
  notes: z.string().optional(),
});
export type UnifiedAuditRow = z.infer<typeof UnifiedAuditRow>;
