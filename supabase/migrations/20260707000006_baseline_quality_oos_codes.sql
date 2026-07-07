-- baseline_quality_checks v4 — list the actual out-of-scope COA codes.
--
-- The COA-scope check counted offending rows but not WHICH codes were out of
-- scope, so a reviewer couldn't act on it. Add a project-level list of the
-- distinct out-of-scope codes with their record counts (top 100 by count), so
-- they can be added to the project COA scope or corrected in the data.
--
-- Only the returned object gains `coa_out_of_scope_codes`; all check logic is
-- identical to v3 (20260707000005).

create or replace function projectcontrols.baseline_quality_checks(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  result jsonb;
begin
  if not exists (
    select 1 from projectcontrols.projects
    where id = p_project_id and tenant_id = tid
  ) then
    raise exception 'project not found in your tenant' using errcode = '42501';
  end if;

  with scope as (
    select c.code
    from projectcontrols.project_coa_codes pcc
    join projectcontrols.coa_codes c on c.id = pcc.coa_code_id
    where pcc.project_id = p_project_id
      and pcc.tenant_id = tid
      and pcc.enabled
  ),
  recs as (
    select
      r.id,
      r.discipline_id,
      coalesce(pd.discipline_code::text, '(unassigned)') as dcode,
      coalesce(pd.display_name, 'Unassigned') as dname,
      r.source_row,
      r.budget_hrs,
      r.budget_qty,
      r.work_type_id,
      r.code,
      case
        when r.budget_qty is not null and r.budget_qty <> 0 then r.budget_hrs / r.budget_qty
      end as unit_ratio
    from projectcontrols.progress_records r
    left join projectcontrols.project_disciplines pd on pd.id = r.discipline_id
    where r.project_id = p_project_id
      and r.tenant_id = tid
      and r.source_type = 'baseline'
  ),
  -- Rows whose COA code is out of scope (only once a scope exists).
  oos as (
    select btrim(r.code) as code
    from recs r
    where r.code is not null and btrim(r.code) <> ''
      and exists (select 1 from scope)
      and not exists (
        select 1 from scope s where lower(btrim(s.code)) = lower(btrim(r.code))
      )
  ),
  ms as (
    select distinct m.progress_record_id
    from projectcontrols.progress_record_milestones m
    where m.progress_record_id in (select id from recs)
  ),
  med as (
    select dcode, percentile_cont(0.5) within group (order by unit_ratio) as med_ratio
    from recs
    where unit_ratio is not null and unit_ratio > 0
    group by dcode
  ),
  disc_agg as (
    select
      r.dcode,
      max(r.dname) as dname,
      count(*) as total_rows,
      count(*) filter (
        where r.source_row is not null and (r.budget_hrs is null or r.budget_hrs = 0)
      ) as fld_whrs_missing_count,
      count(*) filter (
        where r.source_row is not null and (r.budget_qty is null or r.budget_qty = 0)
      ) as fld_qty_missing_count,
      count(*) filter (
        where r.work_type_id is not null
          and not exists (select 1 from ms where ms.progress_record_id = r.id)
      ) as no_milestone_count,
      count(*) filter (where r.work_type_id is null) as unmapped_work_type_count,
      count(*) filter (
        where r.code is not null and btrim(r.code) <> ''
          and exists (select 1 from scope)
          and not exists (
            select 1 from scope s where lower(btrim(s.code)) = lower(btrim(r.code))
          )
      ) as coa_out_of_scope_count,
      count(*) filter (
        where r.unit_ratio is not null and r.unit_ratio > 0
          and md.med_ratio is not null and md.med_ratio > 0
          and (r.unit_ratio > md.med_ratio * 10 or r.unit_ratio < md.med_ratio / 10)
      ) as unit_outlier_count
    from recs r
    left join med md on md.dcode = r.dcode
    group by r.dcode
  ),
  mw as (
    select
      w.work_type_code,
      count(m.*) as milestone_count,
      coalesce(sum(m.weight), 0) as weight_sum
    from projectcontrols.work_types w
    join projectcontrols.work_type_milestones m on m.work_type_id = w.id
    where w.tenant_id = tid
      and w.id in (select distinct work_type_id from recs where work_type_id is not null)
    group by w.id, w.work_type_code
  )
  select jsonb_build_object(
    'milestone_weights', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'work_type_code', work_type_code,
            'milestone_count', milestone_count,
            'weight_sum', weight_sum,
            'ok', abs(weight_sum - 1.0) <= 0.005
          )
          order by work_type_code
        ),
        '[]'::jsonb
      )
      from mw
    ),
    'disciplines', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'discipline_code', dcode,
            'display_name', dname,
            'total_rows', total_rows,
            'fld_whrs_missing_count', fld_whrs_missing_count,
            'fld_qty_missing_count', fld_qty_missing_count,
            'no_milestone_count', no_milestone_count,
            'unmapped_work_type_count', unmapped_work_type_count,
            'coa_out_of_scope_count', coa_out_of_scope_count,
            'unit_outlier_count', unit_outlier_count
          )
          order by dcode
        ),
        '[]'::jsonb
      )
      from disc_agg
    ),
    'coa_out_of_scope_codes', (
      select coalesce(
        jsonb_agg(jsonb_build_object('code', code, 'count', cnt) order by cnt desc, code),
        '[]'::jsonb
      )
      from (
        select code, count(*)::int as cnt
        from oos
        group by code
        order by cnt desc, code
        limit 100
      ) t
    ),
    'unassigned_count', (select count(*) from recs where discipline_id is null)
  )
  into result;

  return result;
end
$$;

grant execute on function projectcontrols.baseline_quality_checks(uuid) to authenticated;
