-- period_close + actuals_bulk_upsert RPCs.
--
-- period_close snapshots BCWP (sum of audit_record_ev.earn_whrs) and ACWP
-- (sum of actual_hours.hours for the period) onto progress_periods, locks
-- the row, and seeds the next period (if one isn't already open).
-- BCWS is left at whatever the row carried at close time — time-phased
-- planning is a Phase 3 input.
--
-- actuals_bulk_upsert inserts actual_hours rows from the timecard import
-- path. Insert-only — re-running an import duplicates rows, which the
-- operator must clean up manually. This is acceptable for v1 timecards
-- (one-shot per period). Idempotent upsert can layer on later when the
-- import flow has a stable dedupe key.

create or replace function projectcontrols.actuals_bulk_upsert(
  p_project_id uuid,
  p_period_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  period record;
  row jsonb;
  v_discipline_id uuid;
  v_record_id uuid;
  inserted int := 0;
begin
  perform projectcontrols.assert_role('editor');

  -- Lock the period row to coordinate with concurrent period_close calls.
  select id, locked_at, project_id, tenant_id into period
  from projectcontrols.progress_periods
  where id = p_period_id and project_id = p_project_id and tenant_id = tid
  for update;

  if period.id is null then
    raise exception 'period not found in this tenant/project' using errcode = 'P0001';
  end if;
  if period.locked_at is not null then
    raise exception 'period_already_locked' using errcode = '22023';
  end if;

  for row in select * from jsonb_array_elements(p_rows) loop
    select id into v_discipline_id
    from projectcontrols.project_disciplines
    where project_id = p_project_id
      and discipline_code = (row->>'discipline_code')::projectcontrols.discipline_code
      and is_active = true;

    if v_discipline_id is null then
      raise exception 'discipline % not configured', row->>'discipline_code' using errcode = '22023';
    end if;

    v_record_id := nullif(row->>'record_id', '')::uuid;

    insert into projectcontrols.actual_hours (
      tenant_id, project_id, period_id, discipline_id, record_id, hours, source
    ) values (
      tid, p_project_id, p_period_id, v_discipline_id, v_record_id,
      (row->>'hours')::numeric,
      coalesce(row->>'source', 'manual')
    );
    inserted := inserted + 1;
  end loop;

  perform projectcontrols.write_audit_log(
    'actual_hours', p_period_id, 'bulk_upsert',
    null,
    jsonb_build_object('inserted', inserted)
  );

  return jsonb_build_object('inserted', inserted);
end
$$;

revoke all on function projectcontrols.actuals_bulk_upsert(uuid, uuid, jsonb) from public;
grant execute on function projectcontrols.actuals_bulk_upsert(uuid, uuid, jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- period_close
-- ─────────────────────────────────────────────────────────────────────
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

  -- BCWP — cumulative earned hours across the project.
  select coalesce(sum(ev.earn_whrs), 0)
  into v_bcwp
  from projectcontrols.audit_record_ev ev
  join projectcontrols.audit_records r on r.id = ev.record_id
  where r.project_id = p_project_id and r.tenant_id = tid;

  -- ACWP — actual hours booked against this period.
  select coalesce(sum(hours), 0)
  into v_acwp
  from projectcontrols.actual_hours
  where project_id = p_project_id and period_id = p_period_id and tenant_id = tid;

  update projectcontrols.progress_periods
     set bcwp_hrs = v_bcwp,
         acwp_hrs = v_acwp,
         locked_at = now()
   where id = p_period_id;

  -- Seed the next period if there isn't already one.
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
