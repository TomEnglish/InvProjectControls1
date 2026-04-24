import { z } from 'zod';
import { Uom } from './enums';

export const CoaCode = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  prime: z.string().min(1),
  code: z.string().min(1),
  description: z.string().min(1),
  parent: z.string().nullable(),
  level: z.number().int().min(1).max(5),
  uom: Uom,
  base_rate: z.number().nonnegative(),
  pf_adj: z.number().positive(),
  pf_rate: z.number().nonnegative(),
});
export type CoaCode = z.infer<typeof CoaCode>;

export const CoaCodeUpsert = CoaCode.omit({ id: true, pf_rate: true }).partial({ tenant_id: true });
export type CoaCodeUpsert = z.infer<typeof CoaCodeUpsert>;
