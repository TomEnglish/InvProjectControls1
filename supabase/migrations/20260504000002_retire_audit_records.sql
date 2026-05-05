-- Phase 5: Retire the legacy audit_records surface.
--
-- Phase 4 swapped every UI consumer to canonical progress_records. This
-- migration removes the dead surface from the database, rewrites the two
-- live RPCs that still referenced audit_records (period_close,
-- project_lock_baseline) onto progress_records, repoints the one
-- remaining FK (actual_hours.record_id), and drops three orphan RPCs
-- that have no frontend callers (project_summary, record_update_milestones,
-- record_bulk_upsert).
--
-- One transaction. If any step fails the whole thing rolls back. (Supabase
-- db push wraps each migration in a transaction implicitly.)

-- ---------------------------------------------------------------------------
-- 1. Pre-flight: null out actual_hours.record_id values that point at audit
--    UUIDs with no progress_records counterpart. Without this the FK
--    repoint in step 5 would fail.
-- ---------------------------------------------------------------------------
update projectcontrols.actual_hours
   set record_id = null
 where record_id is not null
   and record_id not in (select id from projectcontrols.progress_records);

-- ---------------------------------------------------------------------------
-- 2. Drop orphan RPCs (no frontend callers; superseded by canonical equivalents).
-- ---------------------------------------------------------------------------
drop function if exists projectcontrols.project_summary(uuid);
drop function if exists projectcontrols.record_update_milestones(uuid, jsonb);
drop function if exists projectcontrols.record_bulk_upsert(uuid, jsonb);

-- ---------------------------------------------------------------------------
-- 3. Rewrite period_close to read BCWP from v_progress_record_ev.
--    Same earn_whrs shape and units, so this is a one-line swap.
-- ---------------------------------------------------------------------------
create or replace function projectcontrols.period_close(
  p_project_id uuid,
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  period record;
  v_bcwp numeric;
  v_acwp numeric;
  v_max_period_no int;
  v_next_start date;
  v_next_end date;
  v_next_id uuid;
begin
  perform projectcontrols.assert_role('pm');

  select id, period_number, start_date, end_date, locked_at, bcws_hrs, project_id, tenant_id
  into period
  from projectcontrols.progress_periods
  where id = p_period_id and project_id = p_project_id and tenant_id = tid
  for update;

  if period.id is null then
    raise exception 'period not found' using errcode = 'P0001';
  end if;
  if period.locked_at is not null then
    raise exception 'period already closed' using errcode = '22023';
  end if;

  -- BCWP — cumulative earned hours across the project (from canonical view).
  select coalesce(sum(v.earn_whrs), 0)
  into v_bcwp
  from projectcontrols.v_progress_record_ev v
  where v.project_id = p_project_id and v.tenant_id = tid;

  select coalesce(sum(hours), 0)
  into v_acwp
  from projectcontrols.actual_hours
  where project_id = p_project_id and period_id = p_period_id and tenant_id = tid;

  update projectcontrols.progress_periods
     set bcwp_hrs = v_bcwp,
         acwp_hrs = v_acwp,
         locked_at = now()
   where id = p_period_id;

  select max(period_number) into v_max_period_no
  from projectcontrols.progress_periods
  where project_id = p_project_id;

  if v_max_period_no = period.period_number then
    v_next_start := period.end_date + interval '1 day';
    v_next_end := (period.end_date + interval '1 month')::date;
    insert into projectcontrols.progress_periods (
      tenant_id, project_id, period_number, start_date, end_date,
      bcws_hrs, bcwp_hrs, acwp_hrs
    ) values (
      tid, p_project_id, period.period_number + 1, v_next_start, v_next_end,
      0, 0, 0
    )
    returning id into v_next_id;
  end if;

  perform projectcontrols.write_audit_log(
    'progress_periods', p_period_id, 'close',
    null,
    jsonb_build_object(
      'bcwp_hrs', v_bcwp,
      'acwp_hrs', v_acwp,
      'next_period_id', v_next_id
    )
  );

  return jsonb_build_object(
    'closed_period_id', p_period_id,
    'bcwp_hrs', v_bcwp,
    'acwp_hrs', v_acwp,
    'next_period_id', v_next_id
  );
end
$$;

revoke all on function projectcontrols.period_close(uuid, uuid) from public;
grant execute on function projectcontrols.period_close(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Rewrite project_lock_baseline to snapshot progress_records (and its
--    milestones) instead of the dropped audit_records.
-- ---------------------------------------------------------------------------
create or replace function projectcontrols.project_lock_baseline(
  p_project_id uuid,
  p_lock_date timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
  snapshot jsonb;
  baseline_id uuid;
begin
  perform projectcontrols.assert_role('admin');

  select to_jsonb(p) into before from projectcontrols.projects p where id = p_project_id and tenant_id = tid;
  if before is null then
    raise exception 'project not found' using errcode = 'P0001';
  end if;
  if (before->>'status') <> 'draft' then
    raise exception 'project must be in draft state to lock baseline' using errcode = '22023';
  end if;

  snapshot := jsonb_build_object(
    'project', before,
    'disciplines', (select jsonb_agg(to_jsonb(pd)) from projectcontrols.project_disciplines pd where project_id = p_project_id),
    'coa_codes', (select jsonb_agg(to_jsonb(c)) from projectcontrols.coa_codes c where tenant_id = tid),
    'roc_templates', (select jsonb_agg(jsonb_build_object(
      'template', to_jsonb(t),
      'milestones', (select jsonb_agg(to_jsonb(m) order by m.seq) from projectcontrols.roc_milestones m where template_id = t.id)
    )) from projectcontrols.roc_templates t where tenant_id = tid),
    'progress_records', (select jsonb_agg(to_jsonb(r)) from projectcontrols.progress_records r where project_id = p_project_id),
    'progress_record_milestones', (
      select jsonb_agg(to_jsonb(m))
      from projectcontrols.progress_record_milestones m
      where m.progress_record_id in (
        select id from projectcontrols.progress_records where project_id = p_project_id
      )
    )
  );

  insert into projectcontrols.baselines (tenant_id, project_id, locked_at, locked_by, snapshot)
  values (tid, p_project_id, p_lock_date, auth.uid(), snapshot)
  returning id into baseline_id;

  update projectcontrols.projects
     set status = 'active',
         baseline_locked_at = p_lock_date,
         baseline_locked_by = auth.uid(),
         updated_at = now()
   where id = p_project_id;

  perform projectcontrols.write_audit_log('projects', p_project_id, 'lock_baseline', before, to_jsonb((select p from projectcontrols.projects p where p.id = p_project_id)));

  return baseline_id;
end
$$;

revoke all on function projectcontrols.project_lock_baseline(uuid, timestamptz) from public;
grant execute on function projectcontrols.project_lock_baseline(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Repoint actual_hours.record_id from audit_records to progress_records.
--    Drop the constraint by lookup (auto-named in 0005 but a manual hotfix
--    might have renamed it). Add the new one with the canonical name.
-- ---------------------------------------------------------------------------
do $$
declare
  fk_name text;
begin
  select conname into fk_name
  from pg_constraint
  where conrelid = 'projectcontrols.actual_hours'::regclass
    and conkey = (
      select array_agg(attnum)
      from pg_attribute
      where attrelid = 'projectcontrols.actual_hours'::regclass
        and attname = 'record_id'
    )
    and contype = 'f';
  if fk_name is not null then
    execute format('alter table projectcontrols.actual_hours drop constraint %I', fk_name);
  end if;
end $$;

alter table projectcontrols.actual_hours
  add constraint actual_hours_record_id_fkey
  foreign key (record_id) references projectcontrols.progress_records(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 6. Drop the view, the seed-milestones trigger + function, and the policies.
-- ---------------------------------------------------------------------------
drop view if exists projectcontrols.v_audit_record_ev;

drop trigger if exists audit_records_seed_ms on projectcontrols.audit_records;
drop function if exists projectcontrols.seed_audit_record_milestones();

drop policy if exists "ar_tenant_read" on projectcontrols.audit_records;
drop policy if exists "ar_editor_write" on projectcontrols.audit_records;
drop policy if exists "arm_tenant_read" on projectcontrols.audit_record_milestones;
drop policy if exists "arm_editor_write" on projectcontrols.audit_record_milestones;

-- ---------------------------------------------------------------------------
-- 7. Drop the tables. Milestones first (FK to records).
-- ---------------------------------------------------------------------------
drop table if exists projectcontrols.audit_record_milestones;
drop table if exists projectcontrols.audit_records;
