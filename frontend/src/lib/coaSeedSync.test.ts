/**
 * Drift guard: the canonical industry-standard COA codes must be identical
 * between
 *   - supabase/migrations/20260508000001_seed_industry_coa_codes.sql
 *   - scripts/seed/index.ts (the dev-seed array)
 *
 * If someone updates one and forgets the other, fresh dev seeds drift away
 * from what's in the live UAT tenant. This test parses both files and
 * compares (code, description, base_rate, pf_adj, uom, parent, level).
 *
 * Failure mode is "you forgot to update the other file"; the test message
 * tells you which side has the extra / different row.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const MIGRATION_PATH = resolve(
  REPO_ROOT,
  'supabase/migrations/20260508000001_seed_industry_coa_codes.sql',
);
const SEED_PATH = resolve(REPO_ROOT, 'scripts/seed/index.ts');

type CoaRow = {
  prime: string;
  code: string;
  description: string;
  parent: string | null;
  level: number;
  uom: string;
  base_rate: number;
  pf_adj: number;
};

function parseMigrationRows(sql: string): CoaRow[] {
  // Lines look like:
  //   ('01', '01410', 'Mass Excavation', '01', 2, 'CY', 0.0924, 1.1900),
  // The `values (…)` block is bounded by the keyword and the matching `as v(…)`.
  const start = sql.indexOf('values');
  const end = sql.indexOf(') as v(');
  if (start < 0 || end < 0) throw new Error('migration: values block not found');
  const block = sql.slice(start, end);
  const lineRe = /\(\s*('(?:[^']|'')*?'|null)\s*,\s*('(?:[^']|'')*?')\s*,\s*('(?:[^']|'')*?')\s*,\s*('(?:[^']|'')*?'|null)\s*,\s*(\d+)\s*,\s*('(?:[^']|'')*?')\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g;
  const rows: CoaRow[] = [];
  let m;
  while ((m = lineRe.exec(block)) !== null) {
    const unq = (s: string) => (s === 'null' ? null : s.slice(1, -1).replace(/''/g, "'"));
    rows.push({
      prime: unq(m[1]!) ?? '',
      code: unq(m[2]!) ?? '',
      description: unq(m[3]!) ?? '',
      parent: unq(m[4]!),
      level: parseInt(m[5]!, 10),
      uom: unq(m[6]!) ?? '',
      base_rate: parseFloat(m[7]!),
      pf_adj: parseFloat(m[8]!),
    });
  }
  return rows;
}

function parseSeedRows(ts: string): CoaRow[] {
  // Lines look like:
  //   { prime: '01', code: '01000', description: 'Temporary Facilities',
  //     parent: '01', level: 2, uom: 'EA', base_rate: 0.0, pf_adj: 1.19 },
  //
  // Each row is one line in this codebase. Use a forgiving regex that
  // extracts each field by key — order is consistent.
  const rows: CoaRow[] = [];
  const lineRe = /\{\s*prime:\s*'([^']*)',\s*code:\s*'([^']*)',\s*description:\s*'((?:[^'\\]|\\.)*)',\s*parent:\s*(?:'([^']*)'|null),\s*level:\s*(\d+),\s*uom:\s*'([^']*)',\s*base_rate:\s*([\d.]+),\s*pf_adj:\s*([\d.]+)\s*\}/g;
  let m;
  while ((m = lineRe.exec(ts)) !== null) {
    rows.push({
      prime: m[1]!,
      code: m[2]!,
      description: m[3]!.replace(/\\'/g, "'").replace(/\\"/g, '"'),
      parent: m[4] ?? null,
      level: parseInt(m[5]!, 10),
      uom: m[6]!,
      base_rate: parseFloat(m[7]!),
      pf_adj: parseFloat(m[8]!),
    });
  }
  return rows;
}

function keyed(rows: CoaRow[]): Map<string, CoaRow> {
  const out = new Map<string, CoaRow>();
  for (const r of rows) out.set(r.code, r);
  return out;
}

describe('industry COA seed parity', () => {
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  const seedTs = readFileSync(SEED_PATH, 'utf8');

  const migrationRows = parseMigrationRows(migrationSql);
  const seedRows = parseSeedRows(seedTs);

  it('parses ≥ 80 rows from each source (sanity check the regex)', () => {
    expect(migrationRows.length).toBeGreaterThanOrEqual(80);
    expect(seedRows.length).toBeGreaterThanOrEqual(80);
  });

  it('has the same row count in both files', () => {
    expect(seedRows.length).toBe(migrationRows.length);
  });

  it('has the same set of codes in both files', () => {
    const m = new Set(migrationRows.map((r) => r.code));
    const s = new Set(seedRows.map((r) => r.code));
    const onlyInMigration = [...m].filter((c) => !s.has(c));
    const onlyInSeed = [...s].filter((c) => !m.has(c));
    expect({ onlyInMigration, onlyInSeed }).toEqual({ onlyInMigration: [], onlyInSeed: [] });
  });

  it('has the same description, rate, uom, parent, level on every code', () => {
    const m = keyed(migrationRows);
    const s = keyed(seedRows);
    const drift: { code: string; field: string; migration: unknown; seed: unknown }[] = [];
    for (const [code, mRow] of m) {
      const sRow = s.get(code)!;
      const fields: (keyof CoaRow)[] = ['prime', 'description', 'parent', 'level', 'uom', 'base_rate', 'pf_adj'];
      for (const f of fields) {
        const mv = mRow[f];
        const sv = sRow[f];
        if (typeof mv === 'number' && typeof sv === 'number') {
          if (Math.abs(mv - sv) > 0.0001) drift.push({ code, field: f, migration: mv, seed: sv });
        } else if (mv !== sv) {
          drift.push({ code, field: f, migration: mv, seed: sv });
        }
      }
    }
    expect(drift).toEqual([]);
  });
});
