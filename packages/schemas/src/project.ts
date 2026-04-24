import { z } from 'zod';
import { ProjectStatus } from './enums';

export const ProjectRow = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  project_code: z.string().min(1),
  name: z.string().min(1),
  client: z.string().min(1),
  status: ProjectStatus,
  start_date: z.string(),
  end_date: z.string(),
  manager_id: z.string().uuid().nullable(),
  baseline_locked_at: z.string().nullable(),
});
export type ProjectRow = z.infer<typeof ProjectRow>;

export const ProjectSummary = z.object({
  project_id: z.string().uuid(),
  overall_pct: z.number(),
  total_budget_hrs: z.number(),
  total_earned_hrs: z.number(),
  total_actual_hrs: z.number(),
  cpi: z.number(),
  spi: z.number(),
  disciplines: z.array(
    z.object({
      discipline_code: z.string(),
      display_name: z.string(),
      records: z.number(),
      budget_hrs: z.number(),
      earned_hrs: z.number(),
      actual_hrs: z.number(),
      earned_pct: z.number(),
      cpi: z.number(),
    }),
  ),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const BudgetRollup = z.object({
  original_budget: z.number(),
  current_budget: z.number(),
  forecast_budget: z.number(),
  approved_changes_hrs: z.number(),
  pending_changes_hrs: z.number(),
});
export type BudgetRollup = z.infer<typeof BudgetRollup>;
