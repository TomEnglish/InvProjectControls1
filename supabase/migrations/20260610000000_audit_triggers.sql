-- 20260610000000_audit_triggers.sql
-- Trigger-based audit logging for tables the frontend mutates directly via
-- PostgREST (no RPC, so no write_audit_log call). ARCHITECTURE.md §III says
-- every mutation lands in audit_log; RLS already gates tenant/role on these
-- writes, but until now they left no audit row.
--
-- Direct-write tables (frontend component in parentheses):
--   projects                    (ProjectSetup, RollupModeCard)
--   project_disciplines         (AddDisciplineModal)
--   project_coa_codes           (ProjectCoaPickerCard)
--   project_discipline_weights  (RollupModeCard)
--   foreman_aliases             (ForemanAliasesCard)
--   progress_records            (NewRecordModal)
--   progress_record_milestones  (RecordDetail)
--   attachments                 (AttachmentsList)
--
-- The triggers also fire for RPC writes to these tables (project_lock_baseline,
-- project_coa_pf_set, …), so those mutations now get a mechanical
-- insert/update/delete row alongside the RPC's semantic entry. The log is
-- append-only; the trigger row is the guarantee, the RPC row is the intent.

-- One generic row-change recorder. SECURITY DEFINER because audit_log has no
-- insert policy by design ("only SECURITY DEFINER RPCs may insert" —
-- 0006_audit_log.sql); the invoking user must not need one.
--
-- tenant_id comes from the row, not current_tenant_id(): every audited table
-- carries a not-null tenant_id, and service-role / migration writes have no
-- JWT to read a tenant claim from.
--
-- entity_id is the row's id when it has one; the composite-PK tables
-- (project_coa_codes, project_discipline_weights, foreman_aliases) log null
-- and their key columns live in before_json/after_json.
create or replace function projectcontrols.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_before := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_after := to_jsonb(new);
  end if;

  -- No-op updates (e.g. PostgREST upserts that rewrite an identical row)
  -- carry no information; skip them.
  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  insert into projectcontrols.audit_log
    (tenant_id, entity, entity_id, action, actor_id, before_json, after_json)
  values (
    coalesce((v_after ->> 'tenant_id')::uuid, (v_before ->> 'tenant_id')::uuid),
    tg_table_name,
    coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid),
    lower(tg_op),
    auth.uid(),
    v_before,
    v_after
  );

  return null;  -- AFTER trigger; return value is ignored
end
$$;

revoke all on function projectcontrols.audit_row_change() from public;

create trigger audit_projects
  after insert or update or delete on projectcontrols.projects
  for each row execute function projectcontrols.audit_row_change();

create trigger audit_project_disciplines
  after insert or update or delete on projectcontrols.project_disciplines
  for each row execute function projectcontrols.audit_row_change();

create trigger audit_project_coa_codes
  after insert or update or delete on projectcontrols.project_coa_codes
  for each row execute function projectcontrols.audit_row_change();

create trigger audit_project_discipline_weights
  after insert or update or delete on projectcontrols.project_discipline_weights
  for each row execute function projectcontrols.audit_row_change();

create trigger audit_foreman_aliases
  after insert or update or delete on projectcontrols.foreman_aliases
  for each row execute function projectcontrols.audit_row_change();

create trigger audit_progress_records
  after insert or update or delete on projectcontrols.progress_records
  for each row execute function projectcontrols.audit_row_change();

create trigger audit_progress_record_milestones
  after insert or update or delete on projectcontrols.progress_record_milestones
  for each row execute function projectcontrols.audit_row_change();

create trigger audit_attachments
  after insert or update or delete on projectcontrols.attachments
  for each row execute function projectcontrols.audit_row_change();
