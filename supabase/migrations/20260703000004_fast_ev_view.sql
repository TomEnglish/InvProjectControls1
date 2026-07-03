-- v_progress_record_ev — set-based rewrite (same columns, same math).
--
-- UAT with a real-size baseline (2,615 records) took project_metrics to
-- ~17.5s — past the API statement timeout, so Budget/Dashboard/EV pages
-- 500'd. Cause: the 20260522 view called record_current_budget_hrs()
-- THREE times per row, and each call cascades into
-- discipline_current_budget_hrs() → discipline_approved_co_hrs(), which
-- runs three aggregate subqueries. Tens of thousands of nested queries
-- per view scan.
--
-- This rewrite computes each discipline's CO-adjusted current budget ONCE
-- in a CTE (identical math to discipline_approved_co_hrs: direct approved
-- COs + the discipline's baseline-weighted share of project-level approved
-- COs over ACTIVE disciplines) and scales per-record budgets with a join.
-- Output column list is unchanged, so `create or replace` keeps dependent
-- functions intact. The scalar helper functions stay for their remaining
-- per-discipline call sites (project_metrics/discipline_metrics tiles),
-- where a handful of calls is fine.

create or replace view projectcontrols.v_progress_record_ev as
with co_direct as (
  select co.project_id, co.discipline_id, sum(co.hrs_impact) as hrs
  from projectcontrols.change_orders co
  where co.status = 'approved' and co.discipline_id is not null
  group by co.project_id, co.discipline_id
),
co_project as (
  select co.project_id, sum(co.hrs_impact) as hrs
  from projectcontrols.change_orders co
  where co.status = 'approved' and co.discipline_id is null
  group by co.project_id
),
active_baseline as (
  select d.project_id, sum(d.budget_hrs) as total
  from projectcontrols.project_disciplines d
  where d.is_active
  group by d.project_id
),
disc_current as (
  select
    pd.id as discipline_id,
    pd.budget_hrs as baseline_hrs,
    pd.budget_hrs
      + coalesce(cd.hrs, 0)
      + case when coalesce(ab.total, 0) > 0
             then coalesce(cp.hrs, 0) * pd.budget_hrs / ab.total
             else 0
        end as current_hrs
  from projectcontrols.project_disciplines pd
  left join co_direct cd
    on cd.project_id = pd.project_id and cd.discipline_id = pd.id
  left join co_project cp on cp.project_id = pd.project_id
  left join active_baseline ab on ab.project_id = pd.project_id
),
raw as (
  select
    r.id          as record_id,
    r.tenant_id,
    r.project_id,
    r.discipline_id,
    r.work_type_id,
    r.budget_qty,
    r.budget_hrs,
    dc.baseline_hrs as disc_baseline_hrs,
    dc.current_hrs  as disc_current_hrs,
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
  left join disc_current dc on dc.discipline_id = r.discipline_id
  left join projectcontrols.work_type_milestones wtm
    on wtm.work_type_id = coalesce(r.work_type_id, pd.default_work_type_id)
  left join projectcontrols.progress_record_milestones m
    on m.progress_record_id = r.id and m.seq = wtm.seq
  group by r.id, dc.baseline_hrs, dc.current_hrs
),
scaled as (
  select
    raw.*,
    -- Mirrors record_current_budget_hrs(): unassigned records keep their
    -- own budget; zero-baseline disciplines can't be scaled; otherwise
    -- scale by the discipline's current/baseline ratio.
    case
      when raw.discipline_id is null then raw.budget_hrs
      when coalesce(raw.disc_baseline_hrs, 0) > 0
        then raw.budget_hrs / raw.disc_baseline_hrs * raw.disc_current_hrs
      else raw.budget_hrs
    end as current_budget_hrs
  from raw
)
select
  scaled.record_id,
  scaled.tenant_id,
  scaled.project_id,
  scaled.discipline_id,
  scaled.work_type_id,
  scaled.budget_qty,
  scaled.budget_hrs,
  scaled.earn_pct,
  scaled.ern_qty,
  scaled.raw_earn_whrs,
  scaled.current_budget_hrs,
  least(scaled.raw_earn_whrs, scaled.current_budget_hrs) as earn_whrs,
  greatest(
    0,
    scaled.current_budget_hrs - least(scaled.raw_earn_whrs, scaled.current_budget_hrs)
  ) as remaining_hrs
from scaled;

grant select on projectcontrols.v_progress_record_ev to authenticated;
