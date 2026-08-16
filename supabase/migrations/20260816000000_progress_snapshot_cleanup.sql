-- Progress snapshot cleanup and safe audit reversion.
--
-- Weekly audit imports update the locked baseline record in place. Store the
-- small set of earned-progress fields and milestone rows that existed before
-- each import so the newest audit can be reverted without touching the
-- separate actual-hours ledger.

alter table projectcontrols.progress_snapshot_items
  add column if not exists before_percent_complete numeric(5, 2),
  add column if not exists before_earned_qty_imported numeric(14, 3),
  add column if not exists before_earn_whrs_imported numeric(14, 3),
  add column if not exists before_work_type_id uuid,
  add column if not exists before_work_type_raw text,
  add column if not exists before_milestones jsonb;

-- The list function is an API boundary used by the Snapshots page. Recreate it
-- with additive metadata so the UI can distinguish reversible snapshots from
-- legacy history that was created before before-state was captured.
drop function if exists projectcontrols.list_snapshots(uuid);

create function projectcontrols.list_snapshots(p_project_id uuid)
returns table (
  id uuid,
  kind text,
  snapshot_date date,
  week_ending date,
  label text,
  source_filename text,
  total_budget_hrs numeric,
  total_earned_hrs numeric,
  total_actual_hrs numeric,
  cpi numeric,
  spi numeric,
  record_count bigint,
  reversible boolean
)
language sql
stable
security definer
set search_path = projectcontrols
as $$
  select
    s.id,
    s.kind,
    s.snapshot_date,
    s.week_ending,
    s.label,
    s.source_filename,
    s.total_budget_hrs,
    s.total_earned_hrs,
    s.total_actual_hrs,
    s.cpi,
    s.spi,
    count(psi.progress_record_id)::bigint as record_count,
    count(psi.progress_record_id) > 0
      and count(psi.progress_record_id) = count(psi.progress_record_id)
        filter (where psi.before_percent_complete is not null and psi.before_milestones is not null)
      as reversible
  from projectcontrols.progress_snapshots s
  left join projectcontrols.progress_snapshot_items psi on psi.snapshot_id = s.id
  where s.project_id = p_project_id
    and s.tenant_id = projectcontrols.current_tenant_id()
  group by s.id
  order by s.snapshot_date desc, s.created_at desc;
$$;

grant execute on function projectcontrols.list_snapshots(uuid) to authenticated;

-- Delete snapshot history. This never restores baseline progress. Legacy
-- source_type='import' rows belonging only to this snapshot are removed when
-- they have no actual-hours references; baseline rows are deliberately kept.
create or replace function projectcontrols.delete_progress_snapshot(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  snap record;
  item_count int := 0;
  import_count int := 0;
  deleted_import_count int := 0;
  preserved_import_count int := 0;
  import_ids uuid[] := '{}';
begin
  perform projectcontrols.assert_role('pc_reviewer');

  select * into snap
  from projectcontrols.progress_snapshots
  where id = p_snapshot_id and tenant_id = tid
  for update;

  if snap.id is null then
    raise exception 'snapshot not found in your tenant' using errcode = 'P0001';
  end if;
  if snap.kind <> 'weekly' then
    raise exception 'the first-audit baseline cannot be deleted' using errcode = '22023';
  end if;

  select
    count(*)::int,
    count(*) filter (where r.source_type = 'import')::int,
    coalesce(array_agg(psi.progress_record_id) filter (where r.source_type = 'import'), '{}')
  into item_count, import_count, import_ids
  from projectcontrols.progress_snapshot_items psi
  join projectcontrols.progress_records r on r.id = psi.progress_record_id
  where psi.snapshot_id = p_snapshot_id;

  -- Remove the snapshot first so its ON DELETE CASCADE clears the child items
  -- that otherwise restrict deletion of legacy imported records.
  delete from projectcontrols.progress_snapshots where id = p_snapshot_id;

  if coalesce(array_length(import_ids, 1), 0) > 0 then
    delete from projectcontrols.progress_records r
    where r.id = any(import_ids)
      and r.source_type = 'import'
      and not exists (
        select 1 from projectcontrols.actual_hours ah where ah.record_id = r.id
      );
    get diagnostics deleted_import_count = row_count;
  end if;
  preserved_import_count := greatest(import_count - deleted_import_count, 0);

  perform projectcontrols.write_audit_log(
    'progress_snapshots', p_snapshot_id, 'delete_history',
    jsonb_build_object(
      'project_id', snap.project_id,
      'label', snap.label,
      'source_filename', snap.source_filename,
      'item_count', item_count
    ),
    jsonb_build_object(
      'deleted_import_count', deleted_import_count,
      'preserved_import_count', preserved_import_count,
      'progress_reverted', false
    )
  );

  return jsonb_build_object(
    'snapshot_id', p_snapshot_id,
    'item_count', item_count,
    'deleted_import_count', deleted_import_count,
    'preserved_import_count', preserved_import_count,
    'progress_reverted', false
  );
end
$$;

revoke all on function projectcontrols.delete_progress_snapshot(uuid) from public;
grant execute on function projectcontrols.delete_progress_snapshot(uuid) to authenticated;

-- Revert the newest reversible weekly snapshot. Reverting newest-first avoids
-- overwriting a later audit's earned state. Actual-hours rows are untouched.
create or replace function projectcontrols.revert_progress_snapshot(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  snap record;
  item_count int := 0;
  restored_milestone_count int := 0;
begin
  perform projectcontrols.assert_role('pc_reviewer');

  select * into snap
  from projectcontrols.progress_snapshots
  where id = p_snapshot_id and tenant_id = tid
  for update;

  if snap.id is null then
    raise exception 'snapshot not found in your tenant' using errcode = 'P0001';
  end if;
  if snap.kind <> 'weekly' then
    raise exception 'the first-audit baseline cannot be reverted' using errcode = '22023';
  end if;
  if exists (
    select 1
    from projectcontrols.progress_snapshots newer
    where newer.project_id = snap.project_id
      and newer.kind = 'weekly'
      and newer.created_at > snap.created_at
  ) then
    raise exception 'revert weekly snapshots newest-first' using errcode = '22023';
  end if;

  select count(*)::int into item_count
  from projectcontrols.progress_snapshot_items
  where snapshot_id = p_snapshot_id;

  if item_count = 0 or exists (
    select 1
    from projectcontrols.progress_snapshot_items
    where snapshot_id = p_snapshot_id
      and (before_percent_complete is null or before_milestones is null)
  ) then
    raise exception 'this legacy snapshot has no saved before-state; delete history only or re-upload it' using errcode = '22023';
  end if;

  update projectcontrols.progress_records r
  set percent_complete = psi.before_percent_complete,
      earned_qty_imported = psi.before_earned_qty_imported,
      earn_whrs_imported = psi.before_earn_whrs_imported,
      work_type_id = psi.before_work_type_id,
      work_type_raw = psi.before_work_type_raw,
      updated_at = now()
  from projectcontrols.progress_snapshot_items psi
  where psi.snapshot_id = p_snapshot_id
    and r.id = psi.progress_record_id
    and r.project_id = snap.project_id;

  delete from projectcontrols.progress_record_milestones m
  where m.progress_record_id in (
    select progress_record_id
    from projectcontrols.progress_snapshot_items
    where snapshot_id = p_snapshot_id
  );

  insert into projectcontrols.progress_record_milestones (
    tenant_id, progress_record_id, roc_milestone_id, seq, label, value, updated_at, updated_by
  )
  select
    tid,
    psi.progress_record_id,
    restored.roc_milestone_id,
    restored.seq,
    restored.label,
    restored.value,
    now(),
    auth.uid()
  from projectcontrols.progress_snapshot_items psi
  cross join lateral jsonb_to_recordset(psi.before_milestones) as restored(
    seq smallint,
    roc_milestone_id uuid,
    label text,
    value numeric
  )
  where psi.snapshot_id = p_snapshot_id;
  get diagnostics restored_milestone_count = row_count;

  delete from projectcontrols.progress_snapshots where id = p_snapshot_id;

  perform projectcontrols.write_audit_log(
    'progress_snapshots', p_snapshot_id, 'revert',
    jsonb_build_object(
      'project_id', snap.project_id,
      'label', snap.label,
      'source_filename', snap.source_filename,
      'item_count', item_count
    ),
    jsonb_build_object(
      'restored_milestone_count', restored_milestone_count,
      'actual_hours_touched', false
    )
  );

  return jsonb_build_object(
    'snapshot_id', p_snapshot_id,
    'restored_record_count', item_count,
    'restored_milestone_count', restored_milestone_count,
    'actual_hours_touched', false
  );
end
$$;

revoke all on function projectcontrols.revert_progress_snapshot(uuid) from public;
grant execute on function projectcontrols.revert_progress_snapshot(uuid) to authenticated;
