import {
  resolveActualHoursRows,
  type ActualHoursImportItem,
} from "./importActualHours.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const disciplines = [{ id: "pipe-discipline", discipline_code: "PIPE" }];
const baseline = [{
  id: "baseline-pipe-row",
  discipline_id: "pipe-discipline",
  source_row: 77,
  dwg: "120-DR-590-SHT01",
  tag_no: null,
  spool_fr: "120-DR-590-SHT01-1",
  attr_spec: "01HDPE",
  source_type: "baseline",
}];

const item: ActualHoursImportItem = {
  discipline_label: "Pipe",
  dwg: "120-DR-590-SHT01",
  tag_no: undefined,
  spool_fr: "120-DR-590-SHT01-1",
  attr_spec: "01HDPE",
  hours: 12.5,
};

Deno.test("resolves actual hours to the matched baseline record", () => {
  const result = resolveActualHoursRows([item], disciplines, baseline);
  assert(result.issues.length === 0, "matching actual hours should have no issues");
  assert(result.rows[0]?.recordId === "baseline-pipe-row", "hours should target the baseline record");
  assert(result.rows[0]?.hours === 12.5, "hours should be preserved");
});

Deno.test("rejects actual hours that do not match the baseline", () => {
  const result = resolveActualHoursRows([{ ...item, attr_spec: "01CS150" }], disciplines, baseline);
  assert(result.rows.length === 0, "unmatched hours must not be prepared for insert");
  assert(result.issues[0]?.code === "unmatched", "unmatched hours should be reported");
});
