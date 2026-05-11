/**
 * Drift guard: the per-discipline default COA code mapping must match
 * between
 *   - frontend/src/components/progress/NewRecordModal.tsx
 *     (DEFAULT_CODE_BY_DISCIPLINE — drives auto-fill on the New Record form)
 *   - supabase/migrations/20260508000003_backfill_progress_records_code.sql
 *     (per-discipline default in the case-when chain, after all keyword
 *     matchers fail)
 *
 * Two independent copies would silently land manual and backfilled records
 * in different QMR buckets. This test parses both files and asserts the
 * mapping is identical.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const MODAL_PATH = resolve(
  REPO_ROOT,
  'frontend/src/components/progress/NewRecordModal.tsx',
);
const MIGRATION_PATH = resolve(
  REPO_ROOT,
  'supabase/migrations/20260508000003_backfill_progress_records_code.sql',
);

function parseModalDefaults(ts: string): Record<string, string> {
  // Look for the DEFAULT_CODE_BY_DISCIPLINE record literal:
  //   const DEFAULT_CODE_BY_DISCIPLINE: Record<string, string> = {
  //     CIVIL: '04130',
  //     ...
  //   };
  const start = ts.indexOf('DEFAULT_CODE_BY_DISCIPLINE');
  if (start < 0) throw new Error('DEFAULT_CODE_BY_DISCIPLINE not found in NewRecordModal');
  const braceOpen = ts.indexOf('{', start);
  const braceClose = ts.indexOf('};', braceOpen);
  if (braceOpen < 0 || braceClose < 0) throw new Error('malformed mapping literal');
  const body = ts.slice(braceOpen + 1, braceClose);
  const out: Record<string, string> = {};
  const re = /(\w+):\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

function parseMigrationDefaults(sql: string): Record<string, string> {
  // The migration uses nested `case` statements:
  //
  //   case
  //     when pd.discipline_code = 'PIPE' then case
  //       when r.description ilike '%alloy%' then case ... else '08222' end
  //       ...
  //       else '08212'
  //     end
  //     when pd.discipline_code = 'CIVIL' then case ... else '04130' end
  //   end
  //
  // A non-greedy regex over `case ... end` would stop at the INNER end. We
  // walk case/end token-by-token to balance the nesting, then take the LAST
  // `else 'CODE'` inside the discipline's outer block — that's the catch-all
  // default applied when all keyword refinements miss.
  const out: Record<string, string> = {};
  const startRe = /pd\.discipline_code\s*=\s*'([A-Z]+)'\s*then\s*case/g;
  let m;
  while ((m = startRe.exec(sql)) !== null) {
    const disc = m[1]!;
    const blockStart = m.index + m[0].length;

    const tokenRe = /\b(case|end)\b/g;
    tokenRe.lastIndex = blockStart;
    let depth = 1;
    let blockEnd = -1;
    let token;
    while ((token = tokenRe.exec(sql)) !== null) {
      if (token[1] === 'case') depth++;
      else {
        depth--;
        if (depth === 0) {
          blockEnd = token.index;
          break;
        }
      }
    }
    if (blockEnd < 0) continue;

    const block = sql.slice(blockStart, blockEnd);
    const elseMatches = [...block.matchAll(/else\s*'([^']+)'/g)];
    if (elseMatches.length === 0) continue;
    out[disc] = elseMatches[elseMatches.length - 1]![1]!;
  }
  return out;
}

describe('discipline default code parity', () => {
  const modalTs = readFileSync(MODAL_PATH, 'utf8');
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');

  const fromModal = parseModalDefaults(modalTs);
  const fromMigration = parseMigrationDefaults(migrationSql);

  it('extracts a non-empty map from each source (sanity check the regex)', () => {
    expect(Object.keys(fromModal).length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(fromMigration).length).toBeGreaterThanOrEqual(7);
  });

  it('covers the same discipline set', () => {
    expect(Object.keys(fromModal).sort()).toEqual(Object.keys(fromMigration).sort());
  });

  it('maps each discipline to the same default code', () => {
    expect(fromModal).toEqual(fromMigration);
  });
});
