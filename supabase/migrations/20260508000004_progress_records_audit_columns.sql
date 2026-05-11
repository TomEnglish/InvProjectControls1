-- Reconcile progress_records with the full per-discipline audit-file shape
-- (ProgressDocs/InputExamples/*.xlsx). The 2026-05-11 decision doc
-- (Sandra-audit-template-decisions.docx) locks in the following:
--
--   1. SYSTEM, CAREA, LINE_AREA, VAR_AREA — kept as four distinct dimensions
--      (LINE_AREA already exists; SYSTEM was added at the same time as CAREA
--      and VAR_AREA below).
--   2. ERN_QTY → new earned_qty_imported (do not overload actual_qty, which
--      tracks booked / installed quantity separately).
--   3. EARN_WHRS → new earn_whrs_imported (for reconciliation against the
--      milestone-driven computed earned_hrs; never authoritative).
--   4. PSLIP — stored as text; semantics still pending confirmation from
--      Sandra (steel files carry decimal weights here, others null).
--   5. M1..M8 bare weights — handled in the parser as an inferred ROC-weight
--      warning, not stored per-record.
--   6. SCHED_ID placeholders (*C, *S, N/A) — normalized to NULL in the parser.
--   7. WHRS_UNIT — generated column from budget_hrs / budget_qty.
--   8. TA_BANK / TA_BAY / TA_LEVEL "N/A" strings — normalized to NULL in the parser.
--
-- Indexed where filtering / grouping is expected (CWP and TEST_PKG are
-- common report dimensions). Other columns are display-only.

alter table projectcontrols.progress_records
  -- Schedule / package linkage
  add column if not exists sched_id            text,
  add column if not exists system              text,
  add column if not exists carea               text,
  add column if not exists var_area            text,
  add column if not exists test_pkg            text,
  add column if not exists cwp                 text,
  add column if not exists spl_cnt             int,
  -- Foreman (general foreman lives above the IWP foreman)
  add column if not exists gen_foreman_name    text,
  -- Discipline-specific spec triplet
  add column if not exists paint_spec          text,
  add column if not exists insu_spec           text,
  add column if not exists heat_trace_spec     text,
  -- Turnaround location (only used on TA / shutdown projects)
  add column if not exists ta_bank             text,
  add column if not exists ta_bay              text,
  add column if not exists ta_level            text,
  add column if not exists pslip               text,
  -- Imported earned values, preserved for reconciliation only. Never used in
  -- live EV math — that always comes from milestones × budget_hrs/qty.
  add column if not exists earned_qty_imported numeric(14, 3),
  add column if not exists earn_whrs_imported  numeric(14, 3);

-- Hours-per-unit: trivially computable, generated so it always tracks the
-- live budget columns rather than drifting from an imported value. Null
-- when the row has no budget_qty (would divide by zero / be meaningless).
alter table projectcontrols.progress_records
  add column if not exists whrs_unit numeric(14, 4)
    generated always as (
      case
        when budget_qty is null or budget_qty = 0 then null
        else round((budget_hrs / budget_qty)::numeric, 4)
      end
    ) stored;

create index if not exists progress_records_project_cwp_idx
  on projectcontrols.progress_records(project_id, cwp);
create index if not exists progress_records_project_test_pkg_idx
  on projectcontrols.progress_records(project_id, test_pkg);
