-- Data Check: semantic baseline-quality checks.
--
-- The reconciliation + REC_NO/DWG checks confirm the file loaded intact. These
-- catch data that loaded perfectly but produces WRONG earned value:
--
--   Library (per work type used by the baseline):
--     * milestone weights sum to ~100% — a work type whose weights sum to 90%
--       or 110% mis-earns every record that uses it. Tolerance ±0.5pp, so a
--       33.3+33.3+33.3 = 99.9% split passes.
--
--   Per audit tab (discipline):
--     * zero/null budget hours — invisible to hours-weighted EV.
--     * no milestones on a mapped record — can't earn progressively.
--     * unmapped work type — falls back to the discipline default.
--     * COA code out of project scope — won't roll up in cost.
--     * unit-hours outlier — budget_hrs/budget_qty >10× or <1/10× the
--       discipline median; catches a localized unit-scale error a sum
--       checksum nets out.
--
--   Project:
--     * records with no discipline — won't roll into any discipline report.
--
-- Read-only, tenant-scoped, same SECURITY DEFINER pattern as
-- baseline_ingestion_stats / baseline_recno_dwg_check.

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
    -- COA codes in the project's active scope.
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
    -- Records that carry at least one milestone row.
    select distinct m.progress_record_id
    from projectcontrols.progress_record_milestones m
    where m.progress_record_id in (select id from recs)
  ),
  med as (
    -- Median unit-hours (hrs/qty) per discipline, for outlier detection.
    -- Non-positive ratios (zero-budget rows) are excluded — they're their own
    -- check and would otherwise both skew the median and self-flag.
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
      count(*) filter (where r.budget_hrs is null or r.budget_hrs = 0) as zero_budget_count,
      count(*) filter (
        where r.work_type_id is not null
          and not exists (select 1 from ms where ms.progress_record_id = r.id)
      ) as no_milestone_count,
      count(*) filter (where r.work_type_id is null) as unmapped_work_type_count,
      count(*) filter (
        where r.code is not null and btrim(r.code) <> ''
          and not exists (select 1 from scope s where s.code = r.code)
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
    -- Milestone weight sum per work type actually used by this baseline.
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
            -- weight is a 0..1 fraction; ±0.005 = ±0.5 percentage points.
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
            'zero_budget_count', zero_budget_count,
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
