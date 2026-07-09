-- project_clear_discipline_baseline — clear one discipline's baseline so it
-- can be reloaded without touching the other disciplines.
--
-- Now that the baseline loads one discipline at a time (the per-discipline
-- zones are the only loader), a full project_clear_baseline is too blunt for
-- fixing a single bad load. This clears just the given discipline's baseline
-- records + its import manifest, leaving every other discipline intact.
--
-- Same guards as project_clear_baseline: pm+, project in tenant, status
-- 'draft' (a locked baseline's scope changes go through Change Orders). The
-- project_disciplines row itself is kept (it carries budget_hrs / default work
-- type); only its records and manifest are removed.

create or replace function projectcontrols.project_clear_discipline_baseline(
  p_project_id uuid,
  p_discipline_code projectcontrols.discipline_code
)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  proj_status text;
  disc_id uuid;
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

  select id into disc_id
  from projectcontrols.project_disciplines
  where project_id = p_project_id and tenant_id = tid and discipline_code = p_discipline_code;

  -- Delete this discipline's baseline records. A null disc_id (discipline has
  -- no row yet) matches nothing — `discipline_id = null` is never true — so it
  -- can't accidentally wipe the unassigned bucket.
  delete from projectcontrols.progress_records
  where project_id = p_project_id
    and tenant_id = tid
    and source_type = 'baseline'
    and discipline_id = disc_id;
  get diagnostics records_deleted = row_count;

  delete from projectcontrols.import_manifests
  where project_id = p_project_id
    and tenant_id = tid
    and discipline_code = p_discipline_code;
  get diagnostics manifests_deleted = row_count;

  -- IWPs left unreferenced by ANY remaining record (across all disciplines).
  delete from projectcontrols.iwps i
  where i.project_id = p_project_id
    and i.tenant_id = tid
    and not exists (
      select 1 from projectcontrols.progress_records r where r.iwp_id = i.id
    );
  get diagnostics iwps_deleted = row_count;

  result := jsonb_build_object(
    'discipline_code', p_discipline_code,
    'records_deleted', records_deleted,
    'manifests_deleted', manifests_deleted,
    'iwps_deleted', iwps_deleted
  );

  perform projectcontrols.write_audit_log(
    'projects', p_project_id, 'clear_discipline_baseline', null, result
  );

  return result;
end
$$;

revoke all on function projectcontrols.project_clear_discipline_baseline(uuid, projectcontrols.discipline_code) from public;
grant execute on function projectcontrols.project_clear_discipline_baseline(uuid, projectcontrols.discipline_code) to authenticated;
