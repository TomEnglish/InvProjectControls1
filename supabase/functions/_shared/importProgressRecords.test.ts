import {
  type ImportedItem,
  importProgressRecords,
} from "./importProgressRecords.ts";

type Call = {
  table: string;
  operation: "insert" | "update" | "upsert";
  payload: unknown;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createFakeAdmin() {
  const calls: Call[] = [];
  const readData: Record<string, unknown> = {
    iwps: [],
    foreman_aliases: [],
    work_types: [{ id: "pipe-work-type", work_type_code: "PIPE-STD" }],
    project_disciplines: [{ id: "pipe-discipline", discipline_code: "PIPE" }],
    max_record: { record_no: 10 },
    existing_records: [{
      id: "baseline-pipe-row",
      discipline_id: "pipe-discipline",
      source_row: 99,
      dwg: "120-DR-590-SHT01",
      tag_no: null,
      spool_fr: "120-DR-590-SHT01-1",
      source_type: "baseline",
    }],
  };

  const query = (table: string) => {
    let operation: Call["operation"] | null = null;
    let payload: unknown;
    const chain = {
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: table === "progress_records" ? readData.max_record : null,
          error: null,
        });
      },
      single() {
        return Promise.resolve({ data: { id: "snapshot-1" }, error: null });
      },
      insert(rows: unknown) {
        operation = "insert";
        payload = rows;
        calls.push({ table, operation, payload });
        return chain;
      },
      update(row: unknown) {
        operation = "update";
        payload = row;
        calls.push({ table, operation, payload });
        return chain;
      },
      upsert(rows: unknown) {
        operation = "upsert";
        payload = rows;
        calls.push({ table, operation, payload });
        return chain;
      },
      then(
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) {
        if (operation === "insert" && table === "progress_records") {
          const rows = payload as unknown[];
          return Promise.resolve({
            data: rows.map((_, index) => ({ id: `new-row-${index + 1}` })),
            error: null,
          }).then(resolve, reject);
        }
        if (!operation) {
          const data = table === "progress_records"
            ? readData.existing_records
            : readData[table] ?? [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(
          resolve,
          reject,
        );
      },
    };
    return chain;
  };

  return {
    calls,
    from(table: string) {
      return query(table);
    },
  };
}

Deno.test("weekly Pipe import updates the existing record and its milestones", async () => {
  const admin = createFakeAdmin();
  const item: ImportedItem = {
    discipline_label: "Pipe",
    source_row: 1,
    dwg: "120-DR-590-SHT01",
    spool_fr: "120-DR-590-SHT01-1",
    unit: "LF",
    budget_qty: 136,
    budget_hrs: 584.8,
    actual_hrs: 42,
    percent_complete: 42,
    work_type: "PIPE-STD",
    milestones: [
      { name: "Receive", pct: 100 },
      { name: "Stage", pct: 40 },
    ],
  };

  const result = await importProgressRecords({
    admin: admin as never,
    tenantId: "tenant-1",
    projectId: "project-1",
    callerId: "reviewer-1",
    declaredDiscipline: "PIPE",
    items: [item],
  });

  assert(result.ok, "import should succeed");
  assert(
    result.inserted === 1,
    "one uploaded record should be reported as applied",
  );

  const recordUpdates = admin.calls.filter(
    (call) => call.table === "progress_records" && call.operation === "update",
  );
  assert(recordUpdates.length === 1, "existing Pipe record should be updated");
  const update = recordUpdates[0]!.payload as Record<string, unknown>;
  assert(update.percent_complete === 42, "record percent should be updated");
  assert(
    !("budget_hrs" in update),
    "weekly progress must not replace baseline budget hours",
  );

  const recordInserts = admin.calls.filter(
    (call) => call.table === "progress_records" && call.operation === "insert",
  );
  assert(
    recordInserts.length === 0,
    "matching weekly row must not create a duplicate record",
  );

  const milestoneCall = admin.calls.find(
    (call) =>
      call.table === "progress_record_milestones" &&
      call.operation === "upsert",
  );
  assert(milestoneCall, "milestones should be upserted");
  const milestones = milestoneCall.payload as Array<Record<string, unknown>>;
  assert(
    milestones[0]!.progress_record_id === "baseline-pipe-row",
    "milestones must target the existing record",
  );
  assert(
    milestones[0]!.value === 100 && milestones[1]!.value === 40,
    "uploaded milestone values must be persisted",
  );

  const snapshotCall = admin.calls.find(
    (call) =>
      call.table === "progress_snapshot_items" && call.operation === "insert",
  );
  assert(snapshotCall, "snapshot items should be written");
  const snapshotItem =
    (snapshotCall.payload as Array<Record<string, unknown>>)[0]!;
  assert(
    snapshotItem.progress_record_id === "baseline-pipe-row",
    "snapshot must point to the existing record",
  );
});
