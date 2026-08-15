# Actual Hours and Progress Uploads

## Objective

Keep two related but distinct inputs separate:

- A progress audit describes observed physical progress. It updates the existing baseline record's milestone values, record progress, and earned quantity/hours.
- An actual-hours upload describes labor hours for one open project period. It writes period actuals to `actual_hours` and does not change milestones or baseline budget fields.

Both uploads must match the project's locked baseline. An audit or actual-hours file must never create new project-scope records.

## Contract

### Progress audit

- Existing `/progress/upload` and the clerk queue remain the audit entry points.
- A project must contain baseline records before an audit can be applied.
- Each audit row must match exactly one baseline row using the discipline-aware identity fields. For Pipe, the required identity is `DISCIPLINE + DWG + SPOOL_FR + SPEC`; other disciplines may use `TAG_NO` in place of `SPOOL_FR`.
- `REC_NO` is retained as a source-row reference and is not a matching key.
- Unmatched, duplicate, or conflicting rows block the whole import.
- The import updates milestones and sets `percent_complete` to the weighted milestone result so generated `earned_qty` and `earned_hrs` stay aligned with the Progress page.
- Baseline budget quantity/hours and identity fields are not overwritten by weekly audit values.

### Actual hours

The first supported workbook format is a one-sheet table with these headers:

```text
DISCIPLINE, DWG, TAG_NO, SPOOL_FR, SPEC, ACTUAL_HRS
```

`ACTUAL_HRS` is the non-negative number of hours for the selected period. Each row must contain `DISCIPLINE`, `DWG`, `SPEC`, and at least one of `TAG_NO` or `SPOOL_FR`.

- The user selects an open project period before submitting.
- Rows match baseline records using the same identity rules as progress audits.
- Actual hours are upserted once per `(project, period, baseline record)` through the `actual_hours` ledger.
- Re-submitting the same period replaces the prior actual-hours upload values for those records instead of adding duplicates.
- Actual-hours uploads do not modify milestone values, earned values, budget values, or project scope.

## Data flow

```text
Audit workbook
  -> strict parse and identity validation
  -> baseline row match
  -> update progress_record_milestones + percent_complete
  -> generated earned_qty / earned_hrs update
  -> Progress page and weekly snapshot

Actual-hours workbook
  -> strict parse and identity validation
  -> baseline row match
  -> selected open progress_period
  -> actual_hours ledger upsert
  -> per-record actual totals + project/discipline CPI
```

## API contract

Actual-hours import accepts:

```ts
type ActualHoursImportRequest = {
  projectId: string;
  periodId: string;
  sourceFilename?: string;
  items: Array<{
    disciplineLabel: string;
    dwg: string;
    tagNo?: string;
    spoolFr?: string;
    spec: string;
    hours: number;
  }>;
};
```

Success returns the number of applied rows and the selected period. Validation failures return row-level messages and write no rows.

## Testing strategy

- Parser tests cover one sheet, exact required headers, numeric hours, missing identity, duplicates, and nonsensical values.
- Shared matching tests cover discipline isolation, Pipe identity, duplicate baseline keys, and unmatched rows.
- Import tests verify audit milestone updates and actual-hours ledger upserts against existing baseline record IDs.
- Frontend tests cover the route/page contract through existing Vitest coverage; typecheck, lint, and production build remain required.

## Assumptions and boundaries

- Actual-hours uploads are period amounts, not cumulative-to-date amounts.
- Only `pc_reviewer` and higher roles can use the direct Actual Hours page; the existing clerk audit queue is unchanged in this slice.
- No new project-scope records are created by either upload type.
- A future change can add cumulative-hours mode or a clerk review queue without changing the baseline matching contract.
