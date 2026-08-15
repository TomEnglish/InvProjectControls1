import {
  type ExistingProgressRecord,
  type ImportedRecordIdentity,
  matchImportedRecords,
} from "./importMatch.ts";

function assertEqual<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("matches a weekly Pipe upload to the existing baseline row by discipline and DWG", () => {
  const incoming: ImportedRecordIdentity[] = [{
    disciplineId: "pipe-discipline",
    sourceRow: 1,
    dwg: "120-DR-590-SHT01",
    tagNo: null,
    spoolFr: "120-DR-590-SHT01-1",
  }];
  const existing: ExistingProgressRecord[] = [{
    id: "baseline-pipe-row",
    discipline_id: "pipe-discipline",
    source_row: 77,
    dwg: "120-DR-590-SHT01",
    tag_no: null,
    spool_fr: "120-DR-590-SHT01-1",
    source_type: "baseline",
  }];

  assertEqual(matchImportedRecords(incoming, existing), ["baseline-pipe-row"]);
});

Deno.test("does not match an identical identifier from another discipline", () => {
  const incoming: ImportedRecordIdentity[] = [{
    disciplineId: "pipe-discipline",
    sourceRow: 1,
    dwg: "SHARED-DWG-001",
    tagNo: null,
    spoolFr: null,
  }];
  const existing: ExistingProgressRecord[] = [{
    id: "civil-row",
    discipline_id: "civil-discipline",
    source_row: 1,
    dwg: "SHARED-DWG-001",
    tag_no: null,
    spool_fr: null,
    source_type: "baseline",
  }];

  assertEqual(matchImportedRecords(incoming, existing), [null]);
});
