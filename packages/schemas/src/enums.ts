import { z } from 'zod';

export const DisciplineCode = z.enum([
  'CIVIL',
  'PIPE',
  'STEEL',
  'ELEC',
  'MECH',
  'INST',
  'SITE',
]);
export type DisciplineCode = z.infer<typeof DisciplineCode>;

export const UserRole = z.enum(['admin', 'pm', 'pc_reviewer', 'editor', 'viewer']);
export type UserRole = z.infer<typeof UserRole>;

export const ProjectStatus = z.enum(['draft', 'active', 'locked', 'closed']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const RecordStatus = z.enum(['draft', 'active', 'complete', 'void']);
export type RecordStatus = z.infer<typeof RecordStatus>;

export const CoStatus = z.enum(['draft', 'pending', 'pc_reviewed', 'approved', 'rejected']);
export type CoStatus = z.infer<typeof CoStatus>;

export const CoType = z.enum([
  'scope_add',
  'scope_reduction',
  'ifc_update',
  'design_change',
  'client_directive',
]);
export type CoType = z.infer<typeof CoType>;

export const Uom = z.enum(['LF', 'CY', 'EA', 'TONS', 'SF', 'HR', 'LS']);
export type Uom = z.infer<typeof Uom>;
