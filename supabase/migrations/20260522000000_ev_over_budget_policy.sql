-- ELL-46 / ELL-59 — EV over-budget policy (build contract:
-- ProgressDocs/proposals/2026-05-24-ev-over-budget-policy-spec.md)
--
-- * Earned hours capped at current budget (baseline + approved COs).
-- * Remaining hours never negative in RPC/view output.
-- * project_metrics.total_budget_hrs = current budget (not baseline).
-- * Buffer / unbudgeted actuals exposed for Reports tiles.

-- ============================================================================
-- Helpers — current budget with approved CO roll-up
-- ============================================================================

create or replace function projectcontrols.discipline_approved_co_hrs(p_discipline_id uuid)
returns numeric
language sql
stable
security definer
set search_path = projectcontrols
as $$
  with pd as (
    select id, project_id, tenant_id, budget_hrs as baseline
    from projectcontrols.project_disciplines
    where id = p_discipline_id
  ),
  direct as (
    select coalesce(sum(co.hrs_impact), 0) as hrs
    from projectcontrols.change_orders co
    join pd on pd.project_id = co.project_id and pd.tenant_id = co.tenant_id
    where co.discipline_id = p_discipline_id
      and co.status = 'approved'
  ),
  project_level as (
    select coalesce(sum(co.hrs_impact), 0) as hrs
    from projectcontrols.change_orders co
    join pd on pd.project_id = co.project_id and pd.tenant_id = co.tenant_id
    where co.discipline_id is null
      and co.status = 'approved'
  ),
  project_baseline as (
    select coalesce(sum(d.budget_hrs), 0) as total
    from projectcontrols.project_disciplines d
    join pd on pd.project_id = d.project_id
    where d.is_active
  )
  select
    (select hrs from direct)
    + case
        when (select total from project_baseline) > 0
          then (select hrs from project_level)
               * pd.baseline
               / (select total from project_baseline)
        else 0
      end
  from pd;
$$;

grant execute on function projectcontrols.discipline_approved_co_hrs(uuid) to authenticated;

create or replace function projectcontrols.discipline_current_budget_hrs(p_discipline_id uuid)
returns numeric
language sql
stable
security definer
set search_path = projectcontrols
as $$
  select pd.budget_hrs + projectcontrols.discipline_approved_co_hrs(p_discipline_id)
  from projectcontrols.project_disciplines pd
  where pd.id = p_discipline_id;
$$;

grant execute on function projectcontrols.discipline_current_budget_hrs(uuid) to authenticated;

create or replace function projectcontrols.record_current_budget_hrs(p_record_id uuid)
returns numeric
language sql
stable
security definer
set search_path = projectcontrols
as $$
  with r as (
    select
      pr.id,
      pr.budget_hrs,
      pr.discipline_id,
      pd.budget_hrs as disc_baseline
    from projectcontrols.progress_records pr
    left join projectcontrols.project_disciplines pd on pd.id = pr.discipline_id
    where pr.id = p_record_id
  )
  select case
    when r.discipline_id is null then r.budget_hrs
    when coalesce(r.disc_baseline, 0) > 0 then
      r.budget_hrs
      / r.disc_baseline
      * projectcontrols.discipline_current_budget_hrs(r.discipline_id)
    else r.budget_hrs
  end
  from r;
$$;

grant execute on function projectcontrols.record_current_budget_hrs(uuid) to authenticated;

-- ============================================================================
-- v_progress_record_ev — capped earned + remaining
-- ============================================================================

drop view if exists projectcontrols.v_progress_record_ev;

create view projectcontrols.v_progress_record_ev as
with raw as (
  select
    r.id          as record_id,
    r.tenant_id,
    r.project_id,
    r.discipline_id,
    r.work_type_id,
    r.budget_qty,
    r.budget_hrs,
    coalesce(
      sum(m.value * wtm.weight) / 100.0,
      r.percent_complete / 100.0,
      0
    ) as earn_pct,
    coalesce(r.budget_qty, 0) * coalesce(
      sum(m.value * wtm.weight) / 100.0,
      r.percent_complete / 100.0,
      0
    ) as ern_qty,
    r.budget_hrs * coalesce(
      sum(m.value * wtm.weight) / 100.0,
      r.percent_complete / 100.0,
      0
    ) as raw_earn_whrs
  from projectcontrols.progress_records r
  left join projectcontrols.project_disciplines pd on pd.id = r.discipline_id
  left join projectcontrols.work_type_milestones wtm
    on wtm.work_type_id = coalesce(r.work_type_id, pd.default_work_type_id)
  left join projectcontrols.progress_record_milestones m
    on m.progress_record_id = r.id and m.seq = wtm.seq
  group by r.id
)
select
  raw.record_id,
  raw.tenant_id,
  raw.project_id,
  raw.discipline_id,
  raw.work_type_id,
  raw.budget_qty,
  raw.budget_hrs,
  raw.earn_pct,
  raw.ern_qty,
  raw.raw_earn_whrs,
  projectcontrols.record_current_budget_hrs(raw.record_id) as current_budget_hrs,
  least(
    raw.raw_earn_whrs,
    projectcontrols.record_current_budget_hrs(raw.record_id)
  ) as earn_whrs,
  greatest(
    0,
    projectcontrols.record_current_budget_hrs(raw.record_id)
    - least(
        raw.raw_earn_whrs,
        projectcontrols.record_current_budget_hrs(raw.record_id)
      )
  ) as remaining_hrs
from raw;

grant select on projectcontrols.v_progress_record_ev to authenticated;

-- ============================================================================
-- project_metrics — current budget denominator + buffer fields
-- ============================================================================

drop function if exists projectcontrols.project_metrics(uuid);

create function projectcontrols.project_metrics(p_project_id uuid)
returns table (
  project_id uuid,
  total_records int,
  baseline_budget_hrs numeric,
  total_budget_hrs numeric,
  total_earned_hrs numeric,
  total_remaining_hrs numeric,
  total_actual_hrs numeric,
  percent_complete numeric,
  cpi numeric,
  spi numeric,
  sv numeric,
  cv numeric,
  buffer_remaining numeric,
  unbudgeted_actuals numeric
)
language sql
stable
security definer
set search_path = projectcontrols
as $$
  with totals as (
    select
      p_project_id::uuid as proj_id,
      (select count(*)::int
         from projectcontrols.progress_records pr
        where pr.project_id = p_project_id) as n_records,
      coalesce((
        select sum(pd.budget_hrs)
          from projectcontrols.project_disciplines pd
         where pd.project_id = p_project_id and pd.is_active
      ), 0) as baseline_hrs,
      coalesce((
        select sum(projectcontrols.discipline_current_budget_hrs(pd.id))
          from projectcontrols.project_disciplines pd
         where pd.project_id = p_project_id and pd.is_active
      ), 0) as current_hrs,
      coalesce((
        select sum(v.earn_whrs)
          from projectcontrols.v_progress_record_ev v
         where v.project_id = p_project_id
      ), 0) as earned_hrs,
      coalesce((
        select sum(v.remaining_hrs)
          from projectcontrols.v_progress_record_ev v
         where v.project_id = p_project_id
      ), 0) as remaining_hrs,
      coalesce((
        select sum(a.hours)
          from projectcontrols.actual_hours a
         where a.project_id = p_project_id
      ), 0) as actual_hrs
  )
  select
    proj_id,
    n_records,
    baseline_hrs,
    current_hrs,
    earned_hrs,
    remaining_hrs,
    actual_hrs,
    case when current_hrs > 0 then earned_hrs / current_hrs * 100 else 0 end,
    case when actual_hrs > 0 then earned_hrs / actual_hrs else null end,
    case when current_hrs > 0 then earned_hrs / current_hrs else null end,
    earned_hrs - current_hrs,
    earned_hrs - actual_hrs,
    greatest(0, earned_hrs - actual_hrs),
    greatest(0, actual_hrs - earned_hrs)
  from totals;
$$;

grant execute on function projectcontrols.project_metrics(uuid) to authenticated;

-- ============================================================================
-- discipline_metrics — current budget + remaining
-- ============================================================================

drop function if exists projectcontrols.discipline_metrics(uuid);

create function projectcontrols.discipline_metrics(p_project_id uuid)
returns table (
  discipline_id uuid,
  discipline_code text,
  display_name text,
  records int,
  budget_hrs numeric,
  current_budget_hrs numeric,
  earned_hrs numeric,
  remaining_hrs numeric,
  actual_hrs numeric,
  earned_pct numeric,
  cpi numeric
)
language sql
stable
security definer
set search_path = projectcontrols
as $$
  select
    pd.id as discipline_id,
    pd.discipline_code::text,
    pd.display_name,
    coalesce(rec.cnt, 0)::int as records,
    pd.budget_hrs,
    projectcontrols.discipline_current_budget_hrs(pd.id) as current_budget_hrs,
    coalesce(rec.earned_hrs, 0) as earned_hrs,
    greatest(
      0,
      projectcontrols.discipline_current_budget_hrs(pd.id)
      - coalesce(rec.earned_hrs, 0)
    ) as remaining_hrs,
    coalesce(ah.actual_hrs, 0) as actual_hrs,
    case
      when projectcontrols.discipline_current_budget_hrs(pd.id) > 0
        then coalesce(rec.earned_hrs, 0)
             / projectcontrols.discipline_current_budget_hrs(pd.id) * 100
      else 0
    end as earned_pct,
    case
      when coalesce(ah.actual_hrs, 0) > 0
        then coalesce(rec.earned_hrs, 0) / ah.actual_hrs
      else null
    end as cpi
  from projectcontrols.project_disciplines pd
  left join lateral (
    select count(*)::int as cnt, sum(v.earn_whrs) as earned_hrs
    from projectcontrols.progress_records r
    left join projectcontrols.v_progress_record_ev v on v.record_id = r.id
    where r.discipline_id = pd.id
  ) rec on true
  left join lateral (
    select sum(a.hours) as actual_hrs
    from projectcontrols.actual_hours a
    where a.discipline_id = pd.id and a.project_id = p_project_id
  ) ah on true
  where pd.project_id = p_project_id and pd.is_active
  order by pd.discipline_code;
$$;

grant execute on function projectcontrols.discipline_metrics(uuid) to authenticated;

-- ============================================================================
-- period_comparison — auto-order A earlier / B later; positive drift magnitudes
-- ============================================================================

create or replace function projectcontrols.period_comparison(
  p_project_id uuid,
  p_snapshot_a uuid,
  p_snapshot_b uuid
)
returns table (
  progress_record_id uuid,
  dwg text,
  description text,
  pct_a numeric,
  pct_b numeric,
  delta_pct numeric,
  earned_hrs_a numeric,
  earned_hrs_b numeric,
  delta_earned_hrs numeric
)
language plpgsql
stable
security definer
set search_path = projectcontrols
as $$
declare
  v_a uuid := p_snapshot_a;
  v_b uuid := p_snapshot_b;
  v_date_a date;
  v_date_b date;
begin
  select coalesce(s.week_ending, s.snapshot_date)
    into v_date_a
    from projectcontrols.progress_snapshots s
   where s.id = p_snapshot_a;

  select coalesce(s.week_ending, s.snapshot_date)
    into v_date_b
    from projectcontrols.progress_snapshots s
   where s.id = p_snapshot_b;

  if v_date_a is not null and v_date_b is not null and v_date_a > v_date_b then
    v_a := p_snapshot_b;
    v_b := p_snapshot_a;
  end if;

  return query
  select
    r.id as progress_record_id,
    r.dwg,
    r.description,
    coalesce(a.percent_complete, 0) as pct_a,
    coalesce(b.percent_complete, 0) as pct_b,
    abs(coalesce(b.percent_complete, 0) - coalesce(a.percent_complete, 0)) as delta_pct,
    coalesce(a.earned_hrs, 0) as earned_hrs_a,
    coalesce(b.earned_hrs, 0) as earned_hrs_b,
    abs(coalesce(b.earned_hrs, 0) - coalesce(a.earned_hrs, 0)) as delta_earned_hrs
  from projectcontrols.progress_records r
  left join projectcontrols.progress_snapshot_items a
    on a.progress_record_id = r.id and a.snapshot_id = v_a
  left join projectcontrols.progress_snapshot_items b
    on b.progress_record_id = r.id and b.snapshot_id = v_b
  where r.project_id = p_project_id
    and (a.progress_record_id is not null or b.progress_record_id is not null)
  order by r.dwg nulls last, r.description;
end;
$$;

grant execute on function projectcontrols.period_comparison(uuid, uuid, uuid) to authenticated;
