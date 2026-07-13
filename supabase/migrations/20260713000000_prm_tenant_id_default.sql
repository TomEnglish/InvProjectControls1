-- progress_record_milestones.tenant_id — default to current_tenant_id().
--
-- RecordDetail saves milestone edits with a PostgREST upsert that omits
-- tenant_id, expecting the server to fill it (the code has said so since
-- the milestone editor shipped). But the column never had a default, and
-- INSERT ... ON CONFLICT checks NOT NULL on the proposed row *before*
-- conflict resolution — so every milestone save from the UI fails with
-- 23502, even when the row already exists and only the value changes.
-- Same fix as 20260703000005 applied to import_manifests.

alter table projectcontrols.progress_record_milestones
  alter column tenant_id set default projectcontrols.current_tenant_id();
