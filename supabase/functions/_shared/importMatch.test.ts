import {
  matchBaselineRecords,
  type ExistingProgressRecord,
  type ImportedRecordIdentity,
} from "./importMatch.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pipeIdentity(spec = "01HDPE"): ImportedRecordIdentity {
  return {
    disciplineId: "pipe-discipline",
    sourceRow: 1,
    dwg: "120-DR-590-SHT01",
    tagNo: null,
    spoolFr: "120-DR-590-SHT01-1",
    attrSpec: spec,
  };
}

function pipeBaseline(id: string, spec = "01HDPE"): ExistingProgressRecord {
  return {
    id,
    discipline_id: "pipe-discipline",
    source_row: 77,
    dwg: "120-DR-590-SHT01",
    tag_no: null,
    spool_fr: "120-DR-590-SHT01-1",
    attr_spec: spec,
    source_type: "baseline",
  };
}

Deno.test("matches a Pipe upload to the existing baseline row by strict identity", () => {
  const result = matchBaselineRecords([pipeIdentity()], [pipeBaseline("baseline-pipe-row")]);
  assert(result.issues.length === 0, "strict identity should match without issues");
  assert(result.ids[0] === "baseline-pipe-row", "Pipe upload should match the baseline row");
});

Deno.test("does not match an identical identifier from another discipline", () => {
  const result = matchBaselineRecords(
    [{ ...pipeIdentity(), disciplineId: "pipe-discipline" }],
    [{ ...pipeBaseline("civil-row"), discipline_id: "civil-discipline" }],
  );
  assert(result.ids[0] === null, "cross-discipline rows must never match");
  assert(result.issues[0]?.code === "unmatched", "unmatched rows should be reported");
});

Deno.test("blocks a baseline row when the specification changes", () => {
  const result = matchBaselineRecords([pipeIdentity("01CS150")], [pipeBaseline("baseline-pipe-row")]);
  assert(result.ids[0] === null, "changed specification must not match silently");
  assert(result.issues[0]?.code === "unmatched", "spec drift should be reported as unmatched");
});

Deno.test("rejects duplicate baseline identity keys", () => {
  const result = matchBaselineRecords(
    [pipeIdentity()],
    [pipeBaseline("baseline-pipe-row-1"), pipeBaseline("baseline-pipe-row-2")],
  );
  assert(result.ids[0] === null, "ambiguous baseline rows must not be selected");
  assert(result.issues[0]?.code === "ambiguous", "ambiguous keys should be reported");
});
