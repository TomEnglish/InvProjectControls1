-- Clear audit-earned values left on baseline rows after legacy snapshot
-- history was deleted. New uploads should use Revert, which has saved
-- before-state; this RPC is only for the old no-before-state case.

create or replace function projectcontrols.clear_legacy_audit_progress(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  affected_ids uuid[] := '{}';
  snapshot_count int := 0;
  cleared_record_count int := 0;
  cleared_milestone_count int := 0;
  result jsonb;
begin
  perform projectcontrols.assert_role('pc_reviewer');

  if not exists (
    select 1
    from projectcontrols.projects
    where id = p_project_id and tenant_id = tid
  ) then
    raise exception 'project not found in your tenant' using errcode = '42501';
  end if;

  select count(*)::int into snapshot_count
  from projectcontrols.progress_snapshots
  where project_id = p_project_id and tenant_id = tid;

  if snapshot_count > 0 then
    raise exception 'delete or revert the remaining snapshots before clearing legacy audit progress'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(r.id), '{}')
  into affected_ids
  from projectcontrols.progress_records r
  where r.project_id = p_project_id
    and r.tenant_id = tid
    and r.source_type = 'baseline'
    and (r.earned_qty_imported is not null or r.earn_whrs_imported is not null);

  if coalesce(array_length(affected_ids, 1), 0) > 0 then
    update projectcontrols.progress_records
    set percent_complete = 0,
        earned_qty_imported = null,
        earn_whrs_imported = null,
        updated_at = now(),
        updated_by = auth.uid()
    where id = any(affected_ids)
      and project_id = p_project_id
      and tenant_id = tid;
    get diagnostics cleared_record_count = row_count;

    update projectcontrols.progress_record_milestones
    set value = 0,
        updated_at = now(),
        updated_by = auth.uid()
    where progress_record_id = any(affected_ids)
      and tenant_id = tid
      and value <> 0;
    get diagnostics cleared_milestone_count = row_count;
  end if;

  result := jsonb_build_object(
    'project_id', p_project_id,
    'cleared_record_count', cleared_record_count,
    'cleared_milestone_count', cleared_milestone_count,
    'actual_hours_touched', false
  );

  perform projectcontrols.write_audit_log(
    'projects', p_project_id, 'clear_legacy_audit_progress', null, result
  );

  return result;
end
$$;

revoke all on function projectcontrols.clear_legacy_audit_progress(uuid) from public;
grant execute on function projectcontrols.clear_legacy_audit_progress(uuid) to authenticated;
