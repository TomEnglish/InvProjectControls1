import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A20 Wave 2 — guard against silent drift between the frontend's
// progressParser.ts and the edge-fn copy at
// supabase/functions/_shared/progressParser.ts.
//
// Both files SHOULD be byte-identical except for:
//   - the edge-fn header comment (a multi-line block at the top)
//   - the `import * as XLSX from ...` line (Vite uses bare 'xlsx',
//     Deno uses 'npm:xlsx@0.18.5')
//
// We normalize by stripping the leading import line + comment header
// down to the first non-comment line of code, then comparing the rest.
//
// If this test fails, you have two options:
//   (1) you intentionally changed one file and forgot the other → copy
//       the change across and rerun
//   (2) you intentionally diverged the implementations → update the
//       normalization in this file and add a comment explaining why

function normalize(source: string): string {
  // Walk past leading comment / blank lines until the first real `import`
  // statement, then drop that import line and start emitting.
  const lines = source.split('\n');
  let i = 0;
  // Skip leading // comment lines + blank lines.
  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '' || trimmed.startsWith('//')) {
      i++;
      continue;
    }
    break;
  }
  // The first non-comment line MUST be an xlsx import. Skip it.
  const first = lines[i]?.trim() ?? '';
  if (!first.startsWith('import') || !first.includes('XLSX') || !first.includes('xlsx')) {
    throw new Error(
      `parity test expected first non-comment line to be an xlsx import; got: ${first}`,
    );
  }
  i++;
  return lines.slice(i).join('\n').trimStart();
}

describe('progressParser parity (frontend vs edge-fn _shared)', () => {
  it('frontend and edge-fn parser bodies match line-for-line', () => {
    const frontendPath = resolve(__dirname, 'progressParser.ts');
    const sharedPath = resolve(
      __dirname,
      '../../../supabase/functions/_shared/progressParser.ts',
    );
    const front = readFileSync(frontendPath, 'utf8');
    const shared = readFileSync(sharedPath, 'utf8');
    expect(normalize(shared)).toBe(normalize(front));
  });
});
