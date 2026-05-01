import { describe, expect, it } from 'vitest';
import { hasRole } from './queries';

describe('hasRole', () => {
  it('lets super_admin pass every role gate', () => {
    expect(hasRole('super_admin', 'viewer')).toBe(true);
    expect(hasRole('super_admin', 'editor')).toBe(true);
    expect(hasRole('super_admin', 'pc_reviewer')).toBe(true);
    expect(hasRole('super_admin', 'pm')).toBe(true);
    expect(hasRole('super_admin', 'admin')).toBe(true);
    expect(hasRole('super_admin', 'super_admin')).toBe(true);
  });

  it('keeps admin below super_admin but above project execution roles', () => {
    expect(hasRole('admin', 'viewer')).toBe(true);
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('admin', 'pm')).toBe(true);
    expect(hasRole('admin', 'super_admin')).toBe(false);
  });

  it('blocks editor from PM-gated actions', () => {
    expect(hasRole('editor', 'pm')).toBe(false);
  });

  it('lets PM pass PC reviewer gate', () => {
    expect(hasRole('pm', 'pc_reviewer')).toBe(true);
    expect(hasRole('pm', 'editor')).toBe(true);
  });

  it('returns false for missing role', () => {
    expect(hasRole(undefined, 'viewer')).toBe(false);
    expect(hasRole(null, 'admin')).toBe(false);
  });
});
