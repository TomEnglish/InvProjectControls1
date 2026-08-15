-- Actual-hours upload contract.
--
-- Actual hours are period ledger entries, not progress-record fields and not
-- milestone values. The upload page resolves each row to a locked baseline
-- progress record, then this RPC applies the complete batch to one open
-- period. Re-uploading the same workbook for the same period replaces the
-- previous value for that record instead of double-counting it.

create unique index if not exists actual_hours_upload_unique
  on projectcontrols.actual_hours (project_id, period_id, record_id, source)
  where source = 'actual-hours-upload' and record_id is not null;

create or replace view projectcontrols.v_progress_record_actual_hours as
select
  ah.tenant_id,
  ah.project_id,
  ah.record_id,
  sum(ah.hours) as actual_hrs
from projectcontrols.actual_hours ah
join projectcontrols.progress_records r on r.id = ah.record_id
where ah.record_id is not null
group by ah.tenant_id, ah.project_id, ah.record_id;

grant select on projectcontrols.v_progress_record_actual_hours to authenticated;

create or replace function projectcontrols.actual_hours_upload_apply(
  p_project_id uuid,
  p_period_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  period record;
  row jsonb;
  v_record record;
  v_record_id uuid;
  v_hours numeric;
  applied int := 0;
begin
  perform projectcontrols.assert_role('pc_reviewer');

  if coalesce(jsonb_typeof(p_rows), '') <> 'array' then
    raise exception 'actual-hours rows required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'actual-hours rows required' using errcode = '22023';
  end if;

  select id, locked_at, project_id, tenant_id
    into period
  from projectcontrols.progress_periods
  where id = p_period_id
    and project_id = p_project_id
    and tenant_id = tid
  for update;

  if period.id is null then
    raise exception 'period not found in this tenant/project' using errcode = 'P0001';
  end if;
  if period.locked_at is not null then
    raise exception 'period_already_locked' using errcode = '22023';
  end if;

  for row in select * from jsonb_array_elements(p_rows) loop
    v_record := null;
    v_record_id := nullif(row->>'record_id', '')::uuid;
    v_hours := (row->>'hours')::numeric;

    if v_hours is null or v_hours < 0 then
      raise exception 'actual hours must be a non-negative number' using errcode = '22023';
    end if;

    select r.id, r.discipline_id
      into v_record
    from projectcontrols.progress_records r
    where r.id = v_record_id
      and r.tenant_id = tid
      and r.project_id = p_project_id
      and r.source_type = 'baseline';

    if v_record.id is null then
      raise exception 'record % is not a baseline record in this project', v_record_id
        using errcode = '22023';
    end if;

    insert into projectcontrols.actual_hours (
      tenant_id, project_id, period_id, discipline_id, record_id, hours, source
    ) values (
      tid, p_project_id, p_period_id, v_record.discipline_id, v_record.id,
      v_hours, 'actual-hours-upload'
    )
    on conflict (project_id, period_id, record_id, source)
      where source = 'actual-hours-upload' and record_id is not null
    do update set
      hours = excluded.hours,
      discipline_id = excluded.discipline_id;

    applied := applied + 1;
  end loop;

  perform projectcontrols.write_audit_log(
    'actual_hours', p_period_id, 'upload_apply',
    null,
    jsonb_build_object('project_id', p_project_id, 'applied', applied)
  );

  return jsonb_build_object('applied', applied, 'period_id', p_period_id);
end
$$;

revoke all on function projectcontrols.actual_hours_upload_apply(uuid, uuid, jsonb) from public;
grant execute on function projectcontrols.actual_hours_upload_apply(uuid, uuid, jsonb) to authenticated;
