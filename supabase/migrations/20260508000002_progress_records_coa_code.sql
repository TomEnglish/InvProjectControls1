-- Add a `code` column to progress_records so each row carries the COA cost
-- code it was budgeted under (e.g. '04130' = FDN 30-200 CY).
--
-- Why now: the QMR report (Sandra's UAT priority #2) rolls progress up by
-- COA code, and the per-discipline audit templates in
-- ProgressDocs/InputExamples/ all carry a CODE column on every row. Until
-- we persist it, that information is dropped on import.
--
-- Why no FK: codes are tenant-scoped on coa_codes. A FK would force admins
-- to pre-create every code before any record can reference it, which is
-- friction during baseline upload. Validation happens in the COA library
-- separately; orphan codes show up in the QMR report as their own bucket
-- and prompt the admin to either add the missing code or fix the data.

alter table projectcontrols.progress_records
  add column if not exists code text;

create index if not exists progress_records_project_code_idx
  on projectcontrols.progress_records(project_id, code);
