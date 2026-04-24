import { z } from 'zod';
import { CoStatus, CoType, Uom } from './enums';

export const ChangeOrder = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid(),
  co_number: z.string().min(1),
  date: z.string(),
  discipline_id: z.string().uuid(),
  type: CoType,
  description: z.string().min(1),
  qty_change: z.number(),
  uom: Uom,
  hrs_impact: z.number(),
  status: CoStatus,
  requested_by: z.string().min(1),
});
export type ChangeOrder = z.infer<typeof ChangeOrder>;

export const CoSubmitPayload = z.object({
  project_id: z.string().uuid(),
  discipline_id: z.string().uuid(),
  type: CoType,
  description: z.string().min(5),
  qty_change: z.number(),
  uom: Uom,
  hrs_impact: z.number().optional(),
  requested_by: z.string().min(1),
});
export type CoSubmitPayload = z.infer<typeof CoSubmitPayload>;

export const CoDecisionPayload = z.object({
  co_id: z.string().uuid(),
  decision: z.enum(['forward', 'reject']),
  notes: z.string().optional(),
});
export type CoDecisionPayload = z.infer<typeof CoDecisionPayload>;
