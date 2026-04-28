import { describe, it, expect } from 'vitest';
import { hasRole } from './queries';

describe('hasRole', () => {
  it('lets admin pass any role gate', () => {
    expect(hasRole('admin', 'viewer')).toBe(true);
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('admin', 'pm')).toBe(true);
  });

  it('blocks editor from PM-gated actions', () => {
    expect(hasRole('editor', 'pm')).toBe(false);
  });

  it('lets PM pass PC reviewer gate (PMs > PC reviewers in rank)', () => {
    expect(hasRole('pm', 'pc_reviewer')).toBe(true);
    expect(hasRole('pm', 'editor')).toBe(true);
  });

  it('returns false for missing role', () => {
    expect(hasRole(undefined, 'viewer')).toBe(false);
    expect(hasRole(null, 'admin')).toBe(false);
  });
});
