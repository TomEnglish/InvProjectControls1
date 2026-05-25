-- ELL-63 — Non-discipline progress streams (procurement, engineering)
-- and extended project_qty_rollup for Field vs Overall composite KPIs.

create table if not exists projectcontrols.project_progress_streams (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references projectcontrols.tenants(id) on delete cascade,
  project_id         uuid not null references projectcontrols.projects(id) on delete cascade,
  stream_code        text not null,
  display_name       text not null,
  percent_complete   numeric not null default 0
                     check (percent_complete >= 0 and percent_complete <= 100),
  rollup_weight      numeric check (rollup_weight is null or rollup_weight >= 0),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  unique (project_id, stream_code)
);

create index if not exists project_progress_streams_tenant_idx
  on projectcontrols.project_progress_streams(tenant_id);
create index if not exists project_progress_streams_project_idx
  on projectcontrols.project_progress_streams(project_id);

alter table projectcontrols.project_progress_streams enable row level security;

create policy "pps_tenant_read" on projectcontrols.project_progress_streams
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

create policy "pps_reviewer_write" on projectcontrols.project_progress_streams
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  );

comment on table projectcontrols.project_progress_streams is
  'Manual non-discipline progress (procurement, engineering). Auditors update weekly %; streams participate in custom-weight composite roll-up.';

-- Seed default streams for all existing projects.
insert into projectcontrols.project_progress_streams (tenant_id, project_id, stream_code, display_name)
select p.tenant_id, p.id, v.stream_code, v.display_name
from projectcontrols.projects p
cross join (
  values
    ('procurement', 'Procurement'),
    ('engineering', 'Engineering')
) as v(stream_code, display_name)
on conflict (project_id, stream_code) do nothing;

-- Ensure streams exist when a project is created going forward.
create or replace function projectcontrols.project_progress_streams_seed(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid;
begin
  select tenant_id into tid from projectcontrols.projects where id = p_project_id;
  if tid is null then
    raise exception 'project not found';
  end if;

  insert into projectcontrols.project_progress_streams (tenant_id, project_id, stream_code, display_name)
  values
    (tid, p_project_id, 'procurement', 'Procurement'),
    (tid, p_project_id, 'engineering', 'Engineering')
  on conflict (project_id, stream_code) do nothing;
end;
$$;

revoke all on function projectcontrols.project_progress_streams_seed(uuid) from public;
grant execute on function projectcontrols.project_progress_streams_seed(uuid) to authenticated;

-- Batch save from Project Setup UI (pc_reviewer+ via RLS).
create or replace function projectcontrols.project_progress_streams_set(
  p_project_id uuid,
  p_streams jsonb
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  caller_role projectcontrols.user_role := projectcontrols.current_user_role();
  item jsonb;
  before jsonb;
  after jsonb;
  sid uuid;
begin
  if caller_role not in ('super_admin', 'admin', 'pm', 'pc_reviewer') then
    raise exception 'insufficient role' using errcode = '42501';
  end if;

  perform projectcontrols.project_progress_streams_seed(p_project_id);

  for item in select * from jsonb_array_elements(p_streams)
  loop
    select to_jsonb(s) into before
    from projectcontrols.project_progress_streams s
    where s.project_id = p_project_id
      and s.stream_code = item->>'stream_code';

    update projectcontrols.project_progress_streams
       set percent_complete = coalesce((item->>'percent_complete')::numeric, percent_complete),
           rollup_weight = case
             when item ? 'rollup_weight' then nullif(item->>'rollup_weight', '')::numeric
             else rollup_weight
           end,
           updated_at = now(),
           updated_by = auth.uid()
     where project_id = p_project_id
       and stream_code = item->>'stream_code'
     returning id into sid;

    if sid is not null then
      select to_jsonb(s) into after
      from projectcontrols.project_progress_streams s
      where s.id = sid;

      perform projectcontrols.write_audit_log(
        'project_progress_streams',
        sid,
        'update',
        before,
        after
      );
    end if;
  end loop;
end;
$$;

revoke all on function projectcontrols.project_progress_streams_set(uuid, jsonb) from public;
grant execute on function projectcontrols.project_progress_streams_set(uuid, jsonb) to authenticated;

-- Extended composite roll-up: field-only + overall (custom + streams).
-- Must drop first: Postgres rejects CREATE OR REPLACE when OUT params change.
drop function if exists projectcontrols.project_qty_rollup(uuid);

create or replace function projectcontrols.project_qty_rollup(p_project_id uuid)
returns table (
  composite_pct numeric,
  field_composite_pct numeric,
  mode text,
  includes_streams boolean
)
language sql
stable
security definer
set search_path = projectcontrols
as $$
  with proj as (
    select id, qty_rollup_mode from projectcontrols.projects where id = p_project_id
  ),
  disc as (
    select
      pd.id,
      pd.budget_hrs,
      coalesce((select sum(v.earn_whrs)
                  from projectcontrols.progress_records r
                  left join projectcontrols.v_progress_record_ev v on v.record_id = r.id
                  where r.discipline_id = pd.id), 0) as earned_hrs,
      pdw.weight as custom_weight
    from projectcontrols.project_disciplines pd
    left join projectcontrols.project_discipline_weights pdw
      on pdw.project_id = pd.project_id and pdw.discipline_id = pd.id
    where pd.project_id = p_project_id and pd.is_active
  ),
  streams as (
    select
      count(*) > 0 as has_streams,
      coalesce(sum(coalesce(rollup_weight, 0) * percent_complete / 100.0), 0) as stream_custom_sum,
      coalesce(sum(coalesce(rollup_weight, 0)), 0) as stream_weight_sum
    from projectcontrols.project_progress_streams
    where project_id = p_project_id
  ),
  totals as (
    select
      sum(earned_hrs) as total_earned,
      sum(budget_hrs) as total_budget,
      count(*) as n_disc,
      sum(case when budget_hrs > 0 then earned_hrs / budget_hrs else 0 end) as equal_sum,
      sum(coalesce(custom_weight, 0)
          * case when budget_hrs > 0 then earned_hrs / budget_hrs else 0 end) as custom_sum,
      coalesce((select sum(weight) from projectcontrols.project_discipline_weights
                where project_id = p_project_id), 0) as disc_weight_sum
    from disc
  )
  select
    case
      when proj.qty_rollup_mode = 'custom'
           and s.has_streams
           and abs(t.disc_weight_sum + s.stream_weight_sum - 1) < 0.01
        then (t.custom_sum + s.stream_custom_sum) * 100
      when proj.qty_rollup_mode = 'hours_weighted' then
        case when t.total_budget > 0 then t.total_earned / t.total_budget * 100 else 0 end
      when proj.qty_rollup_mode = 'equal' then
        case when t.n_disc > 0 then t.equal_sum / t.n_disc * 100 else 0 end
      when proj.qty_rollup_mode = 'custom' then t.custom_sum * 100
      else 0
    end as composite_pct,
    case proj.qty_rollup_mode
      when 'hours_weighted' then case when t.total_budget > 0 then t.total_earned / t.total_budget * 100 else 0 end
      when 'equal' then case when t.n_disc > 0 then t.equal_sum / t.n_disc * 100 else 0 end
      when 'custom' then t.custom_sum * 100
      else 0
    end as field_composite_pct,
    proj.qty_rollup_mode as mode,
    s.has_streams as includes_streams
  from proj
  cross join totals t
  cross join streams s;
$$;

grant execute on function projectcontrols.project_qty_rollup(uuid) to authenticated;
