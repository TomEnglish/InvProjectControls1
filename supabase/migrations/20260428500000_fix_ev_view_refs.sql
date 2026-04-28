-- Fix references to a non-existent `audit_record_ev` table in
-- record_bulk_upsert and period_close.
--
-- The schema has `v_audit_record_ev` as a VIEW (0004_audit_records.sql line 64),
-- not a table — earned values are computed live from milestones × ROC weights.
-- Two RPCs introduced in 20260428200000 / 20260428400000 referenced the bare
-- name and would 42P01 ("relation does not exist") on every call.
--
-- This migration re-creates both RPCs using the view, and drops the redundant
-- "seed audit_record_ev" insert from record_bulk_upsert (the view computes
-- the row implicitly the moment milestones exist).

create or replace function projectcontrols.record_bulk_upsert(
  p_project_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  proj record;
  row jsonb;
  v_record_id uuid;
  v_discipline_id uuid;
  v_coa_id uuid;
  v_rec_no int;
  v_existed boolean;
  inserted_count int := 0;
  updated_count int := 0;
  error_rows jsonb := '[]'::jsonb;
begin
  perform projectcontrols.assert_role('editor');

  select id, status, tenant_id into proj
  from projectcontrols.projects
  where id = p_project_id and tenant_id = tid;

  if proj.id is null then
    raise exception 'project not found in this tenant' using errcode = 'P0001';
  end if;
  if proj.status not in ('draft', 'active') then
    raise exception 'project must be in draft or active state to import (status=%)', proj.status
      using errcode = '22023';
  end if;

  for row in select * from jsonb_array_elements(p_rows) loop
    select id into v_discipline_id
    from projectcontrols.project_disciplines
    where project_id = p_project_id
      and discipline_code = (row->>'discipline_code')::projectcontrols.discipline_code
      and is_active = true;

    if v_discipline_id is null then
      error_rows := error_rows || jsonb_build_object(
        'rec_no', row->>'rec_no',
        'error', format('discipline %s not configured for this project', row->>'discipline_code')
      );
      continue;
    end if;

    select id into v_coa_id
    from projectcontrols.coa_codes
    where tenant_id = tid and code = row->>'coa_code';

    if v_coa_id is null then
      error_rows := error_rows || jsonb_build_object(
        'rec_no', row->>'rec_no',
        'error', format('coa_code %s not in library', row->>'coa_code')
      );
      continue;
    end if;

    v_rec_no := (row->>'rec_no')::int;
    if v_rec_no is null then
      error_rows := error_rows || jsonb_build_object(
        'rec_no', null,
        'error', 'rec_no is required'
      );
      continue;
    end if;

    select id, true into v_record_id, v_existed
    from projectcontrols.audit_records
    where project_id = p_project_id and rec_no = v_rec_no;

    if v_record_id is null then
      v_existed := false;
    end if;

    insert into projectcontrols.audit_records (
      tenant_id, project_id, discipline_id, coa_code_id, rec_no,
      dwg, rev, description, uom, fld_qty, fld_whrs, status
    ) values (
      tid, p_project_id, v_discipline_id, v_coa_id, v_rec_no,
      row->>'dwg',
      row->>'rev',
      row->>'description',
      (row->>'uom')::projectcontrols.uom_code,
      (row->>'fld_qty')::numeric,
      coalesce((row->>'fld_whrs')::numeric,
               (row->>'fld_qty')::numeric * (select pf_rate from projectcontrols.coa_codes where id = v_coa_id)),
      coalesce((row->>'record_status')::projectcontrols.record_status, 'active')
    )
    on conflict (project_id, rec_no) do update set
      discipline_id = excluded.discipline_id,
      coa_code_id = excluded.coa_code_id,
      dwg = excluded.dwg,
      rev = excluded.rev,
      description = excluded.description,
      uom = excluded.uom,
      fld_qty = excluded.fld_qty,
      fld_whrs = excluded.fld_whrs,
      status = excluded.status,
      updated_at = now()
    returning id into v_record_id;

    -- audit_record_milestones is seeded for new records by the
    -- audit_records_seed_ms trigger (0004_audit_records.sql). No need to
    -- insert manually. v_audit_record_ev is a view that derives earn_pct/
    -- ern_qty/earn_whrs from milestones — also nothing to insert.

    if v_existed then
      updated_count := updated_count + 1;
    else
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  if jsonb_array_length(error_rows) > 0 then
    raise exception 'import failed: %', error_rows::text using errcode = '22023';
  end if;

  perform projectcontrols.write_audit_log(
    'audit_records', p_project_id, 'bulk_upsert', null,
    jsonb_build_object(
      'inserted', inserted_count,
      'updated', updated_count,
      'total', inserted_count + updated_count
    )
  );

  return jsonb_build_object(
    'inserted', inserted_count,
    'updated', updated_count,
    'errors', error_rows
  );
end
$$;

revoke all on function projectcontrols.record_bulk_upsert(uuid, jsonb) from public;
grant execute on function projectcontrols.record_bulk_upsert(uuid, jsonb) to authenticated;


-- period_close — same rename, audit_record_ev → v_audit_record_ev.

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

  -- BCWP — cumulative earned hours across the project (from the view).
  select coalesce(sum(v.earn_whrs), 0)
  into v_bcwp
  from projectcontrols.v_audit_record_ev v
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
