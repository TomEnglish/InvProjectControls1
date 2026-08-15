type DisciplineRef = { id: string; discipline_code: string };

import { resolveDisciplineId } from './discipline.ts';

function assertEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test('resolves a queued upload to its declared discipline when rows have no label', () => {
  const disciplines: DisciplineRef[] = [{ id: 'pipe-id', discipline_code: 'PIPE' }];

  assertEqual(resolveDisciplineId(undefined, 'PIPE', disciplines), 'pipe-id');
});

Deno.test('uses a row discipline label so unified uploads land in their own discipline', () => {
  const disciplines: DisciplineRef[] = [
    { id: 'civil-id', discipline_code: 'CIVIL' },
    { id: 'pipe-id', discipline_code: 'PIPE' },
  ];

  assertEqual(resolveDisciplineId('Pipe', 'CIVIL', disciplines), 'pipe-id');
});
