-- baseline_quality_checks v3 — FLD_QTY / FLD_WHRS presence on numbered rows.
--
-- Replaces the generic "zero/null budget hours" gate with two sharper checks
-- requested after UAT: a numbered row (one with a REC_NO / source_row) must
-- carry both a field quantity and field work-hours. Zero or null in either is
-- a data-entry error that zeroes out the row's earned value.
--
--   FLD_WHRS → budget_hrs   FLD_QTY → budget_qty   (parser mappings)
--
-- Scoped to source_row IS NOT NULL: a row with no REC_NO is a separate problem
-- already flagged by the REC_NO sequence check, so it isn't double-counted
-- here. Everything else is identical to v2 (20260707000004).

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
      -- FLD_WHRS / FLD_QTY must be present (non-zero, non-null) on any row
      -- that carries a REC_NO.
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
    'unassigned_count', (select count(*) from recs where discipline_id is null)
  )
  into result;

  return result;
end
$$;

grant execute on function projectcontrols.baseline_quality_checks(uuid) to authenticated;
