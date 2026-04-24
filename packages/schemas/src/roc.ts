import { z } from 'zod';
import { DisciplineCode } from './enums';

export const RocMilestone = z.object({
  seq: z.number().int().min(1).max(8),
  label: z.string().min(1),
  weight: z.number().min(0).max(1),
});
export type RocMilestone = z.infer<typeof RocMilestone>;

export const RocTemplate = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  discipline_code: DisciplineCode,
  name: z.string().min(1),
  version: z.number().int().min(1),
  is_default: z.boolean(),
  milestones: z.array(RocMilestone).length(8),
});
export type RocTemplate = z.infer<typeof RocTemplate>;

/** Validates weights sum to 1.0 within 0.0001 tolerance. */
export const RocTemplateSetPayload = z.object({
  template_id: z.string().uuid(),
  milestones: z
    .array(RocMilestone)
    .length(8)
    .refine(
      (ms) => Math.abs(ms.reduce((s, m) => s + m.weight, 0) - 1) < 0.0001,
      'Milestone weights must sum to 1.0000',
    ),
});
export type RocTemplateSetPayload = z.infer<typeof RocTemplateSetPayload>;
