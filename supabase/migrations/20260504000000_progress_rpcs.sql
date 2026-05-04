-- Phase 4.1: progress_records RPC surface + EV view.
--
-- New RPCs that drive the merged dashboard, EV, discipline, snapshot, and
-- comparison views — all reading the canonical progress_records / progress_*
-- tables added in 20260501000005. The existing audit_records-based RPCs
-- (project_summary, etc.) stay until Phase 5 so consumers can switch over
-- module-by-module without breaking running views.
--
-- Earned-percent semantics:
--   * progress_record_milestones.value is 0..100 (PT convention).
--   * roc_milestones.weight sums to 1.0 per template.
--   * earn_pct (as a fraction 0..1) = sum(value * weight) / 100.
--   * If a record has no milestones (e.g., manual rows or imports without
--     milestone columns), fall back to progress_records.percent_complete / 100.

-- ============================================================================
-- v_progress_record_ev — earned-value projection of progress_records
-- ============================================================================
create or replace view projectcontrols.v_progress_record_ev as
select
  r.id as record_id,
  r.tenant_id,
  r.project_id,
  r.discipline_id,
  r.budget_qty,
  r.budget_hrs,
  coalesce(
    sum(m.value * rm.weight) / 100.0,
    r.percent_complete / 100.0,
    0
  ) as earn_pct,
  coalesce(r.budget_qty, 0) * coalesce(
    sum(m.value * rm.weight) / 100.0,
    r.percent_complete / 100.0,
    0
  ) as ern_qty,
  r.budget_hrs * coalesce(
    sum(m.value * rm.weight) / 100.0,
    r.percent_complete / 100.0,
    0
  ) as earn_whrs
from projectcontrols.progress_records r
left join projectcontrols.project_disciplines pd on pd.id = r.discipline_id
left join projectcontrols.roc_milestones rm on rm.template_id = pd.roc_template_id
left join projectcontrols.progress_record_milestones m
  on m.progress_record_id = r.id and m.seq = rm.seq
group by r.id;

grant select on projectcontrols.v_progress_record_ev to authenticated;

-- ============================================================================
-- project_metrics — overall KPIs for the project Dashboard
-- ============================================================================
create or replace function projectcontrols.project_metrics(p_project_id uuid)
returns table (
  project_id uuid,
  total_records int,
  total_budget_hrs numeric,
  total_earned_hrs numeric,
  total_actual_hrs numeric,
  percent_complete numeric,
  cpi numeric,
  spi numeric,
  sv numeric
)
language sql
stable
security definer
set search_path = projectcontrols
as $$
  with totals as (
    select
      p_project_id::uuid as proj_id,
      (select count(*)::int from projectcontrols.progress_records pr where pr.project_id = p_project_id) as n_records,
      coalesce((select sum(r.budget_hrs)
                  from projectcontrols.progress_records r
                  where r.project_id = p_project_id), 0) as budget_hrs,
      coalesce((select sum(v.earn_whrs)
                  from projectcontrols.v_progress_record_ev v
                  where v.project_id = p_project_id), 0) as earned_hrs,
      coalesce((select sum(a.hours)
                  from projectcontrols.actual_hours a
                  where a.project_id = p_project_id), 0) as actual_hrs
  )
  select
    proj_id,
    n_records,
    budget_hrs,
    earned_hrs,
    actual_hrs,
    case when budget_hrs > 0 then earned_hrs / budget_hrs * 100 else 0 end as percent_complete,
    case when actual_hrs > 0 then earned_hrs / actual_hrs else null end as cpi,
    -- Without a time-phased BCWS baseline, SPI degenerates to earned/budget.
    -- Real SPI lands when progress_periods are time-phased (Phase 5).
    case when budget_hrs > 0 then earned_hrs / budget_hrs else null end as spi,
    earned_hrs - budget_hrs as sv
  from totals;
$$;

grant execute on function projectcontrols.project_metrics(uuid) to authenticated;

-- ============================================================================
-- discipline_metrics — per-discipline rollup
-- ============================================================================
create or replace function projectcontrols.discipline_metrics(p_project_id uuid)
returns table (
  discipline_id uuid,
  discipline_code text,
  display_name text,
  records int,
  budget_hrs numeric,
  earned_hrs numeric,
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
    coalesce(rec.earned_hrs, 0) as earned_hrs,
    coalesce(ah.actual_hrs, 0) as actual_hrs,
    case when pd.budget_hrs > 0 then coalesce(rec.earned_hrs, 0) / pd.budget_hrs * 100 else 0 end as earned_pct,
    case when coalesce(ah.actual_hrs, 0) > 0 then coalesce(rec.earned_hrs, 0) / ah.actual_hrs else null end as cpi
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
-- project_qty_rollup — composite % under hours_weighted / equal / custom
-- ============================================================================
create or replace function projectcontrols.project_qty_rollup(p_project_id uuid)
returns table (
  composite_pct numeric,
  mode text
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
  totals as (
    select
      sum(earned_hrs) as total_earned,
      sum(budget_hrs) as total_budget,
      count(*) as n_disc,
      sum(case when budget_hrs > 0 then earned_hrs / budget_hrs else 0 end) as equal_sum,
      sum(coalesce(custom_weight, 0)
          * case when budget_hrs > 0 then earned_hrs / budget_hrs else 0 end) as custom_sum
    from disc
  )
  select
    case proj.qty_rollup_mode
      when 'hours_weighted' then case when t.total_budget > 0 then t.total_earned / t.total_budget * 100 else 0 end
      when 'equal' then case when t.n_disc > 0 then t.equal_sum / t.n_disc * 100 else 0 end
      when 'custom' then t.custom_sum * 100
      else 0
    end as composite_pct,
    proj.qty_rollup_mode as mode
  from proj
  cross join totals t;
$$;

grant execute on function projectcontrols.project_qty_rollup(uuid) to authenticated;

-- ============================================================================
-- list_snapshots — period snapshot history for the comparison UI
-- ============================================================================
create or replace function projectcontrols.list_snapshots(p_project_id uuid)
returns table (
  id uuid,
  kind text,
  snapshot_date date,
  week_ending date,
  label text,
  total_budget_hrs numeric,
  total_earned_hrs numeric,
  total_actual_hrs numeric,
  cpi numeric,
  spi numeric
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
    s.total_budget_hrs,
    s.total_earned_hrs,
    s.total_actual_hrs,
    s.cpi,
    s.spi
  from projectcontrols.progress_snapshots s
  where s.project_id = p_project_id
  order by s.snapshot_date desc, s.created_at desc;
$$;

grant execute on function projectcontrols.list_snapshots(uuid) to authenticated;

-- ============================================================================
-- period_comparison — per-record drift between two snapshots
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
language sql
stable
security definer
set search_path = projectcontrols
as $$
  select
    r.id as progress_record_id,
    r.dwg,
    r.description,
    coalesce(a.percent_complete, 0) as pct_a,
    coalesce(b.percent_complete, 0) as pct_b,
    coalesce(b.percent_complete, 0) - coalesce(a.percent_complete, 0) as delta_pct,
    coalesce(a.earned_hrs, 0) as earned_hrs_a,
    coalesce(b.earned_hrs, 0) as earned_hrs_b,
    coalesce(b.earned_hrs, 0) - coalesce(a.earned_hrs, 0) as delta_earned_hrs
  from projectcontrols.progress_records r
  left join projectcontrols.progress_snapshot_items a
    on a.progress_record_id = r.id and a.snapshot_id = p_snapshot_a
  left join projectcontrols.progress_snapshot_items b
    on b.progress_record_id = r.id and b.snapshot_id = p_snapshot_b
  where r.project_id = p_project_id
    and (a.progress_record_id is not null or b.progress_record_id is not null)
  order by r.dwg nulls last, r.description;
$$;

grant execute on function projectcontrols.period_comparison(uuid, uuid, uuid) to authenticated;
