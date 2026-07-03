-- project_clear_baseline v2 — also reset lock remnants.
--
-- UAT found a draft project still showing "Baseline Locked 5/6/2026" on
-- Project Setup: during earlier testing it had been locked, then manually
-- reset to draft without clearing projects.baseline_locked_at /
-- baseline_locked_by or the frozen baselines snapshot. A draft project
-- carrying lock remnants is incoherent — the stamp reads as locked while
-- every draft-only action works, and the phantom snapshot sits alongside
-- whatever a future lock freezes ((project_id, locked_at) is unique, so
-- re-lock doesn't collide — it just leaves two "baselines").
--
-- Clearing a baseline now also wipes those remnants. Only reachable in
-- draft (guard unchanged), so it can never touch a genuinely locked
-- project's stamp or snapshot.

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
  snapshots_deleted int;
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

  -- Lock remnants: stale snapshots + the locked-at stamp. Only possible on
  -- a draft project via out-of-band status resets; harmless no-op otherwise.
  delete from projectcontrols.baselines
  where project_id = p_project_id and tenant_id = tid;
  get diagnostics snapshots_deleted = row_count;

  update projectcontrols.projects
  set baseline_locked_at = null, baseline_locked_by = null
  where id = p_project_id and tenant_id = tid;

  result := jsonb_build_object(
    'records_deleted', records_deleted,
    'manifests_deleted', manifests_deleted,
    'iwps_deleted', iwps_deleted,
    'snapshots_deleted', snapshots_deleted
  );

  perform projectcontrols.write_audit_log(
    'projects', p_project_id, 'clear_baseline', null, result
  );

  return result;
end
$$;

grant execute on function projectcontrols.project_clear_baseline(uuid) to authenticated;
