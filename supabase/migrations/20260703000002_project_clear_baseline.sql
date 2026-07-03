-- project_clear_baseline — wipe a draft project's baseline so it can be
-- reloaded from scratch.
--
-- Motivating UAT case: the first QMR workbook upload loaded 4 of 7 tabs
-- (the other 3 failed on UOM enum rejections, since fixed). With no dedupe
-- on re-upload, the only recovery was hand-deleting rows. This RPC gives
-- Project Setup a supported "clear before load" path.
--
-- Deletes, for the caller's tenant + the given project:
--   * baseline progress_records (milestones cascade via FK)
--   * import_manifests (the Data Check answer key — stale after a clear)
--   * IWPs left orphaned by the record delete (auto-created at import; kept
--     if any surviving record still references them)
-- Keeps project_disciplines: they carry manual edits (budget_hrs, default
-- work type) and are idempotently reused by the next import.
--
-- Guards: pm+ role, project in caller's tenant, status='draft'. Once the
-- baseline is locked, scope changes go through Change Orders — same rule
-- as import-baseline-records.

create or replace function projectcontrols.project_clear_baseline(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  proj_status text;
  records_deleted int;
  manifests_deleted int;
  iwps_deleted int;
  result jsonb;
begin
  perform projectcontrols.assert_role('pm');

  select status::text into proj_status
  from projectcontrols.projects
  where id = p_project_id and tenant_id = tid;
  if proj_status is null then
    raise exception 'project not found in your tenant' using errcode = '42501';
  end if;
  if proj_status <> 'draft' then
    raise exception 'baseline is locked (project status "%") — clearing is only allowed in draft', proj_status
      using errcode = '55000';
  end if;

  delete from projectcontrols.progress_records
  where project_id = p_project_id and tenant_id = tid and source_type = 'baseline';
  get diagnostics records_deleted = row_count;

  delete from projectcontrols.import_manifests
  where project_id = p_project_id and tenant_id = tid;
  get diagnostics manifests_deleted = row_count;

  delete from projectcontrols.iwps i
  where i.project_id = p_project_id
    and i.tenant_id = tid
    and not exists (
      select 1 from projectcontrols.progress_records r where r.iwp_id = i.id
    );
  get diagnostics iwps_deleted = row_count;

  result := jsonb_build_object(
    'records_deleted', records_deleted,
    'manifests_deleted', manifests_deleted,
    'iwps_deleted', iwps_deleted
  );

  perform projectcontrols.write_audit_log(
    'projects', p_project_id, 'clear_baseline', null, result
  );

  return result;
end
$$;

grant execute on function projectcontrols.project_clear_baseline(uuid) to authenticated;
