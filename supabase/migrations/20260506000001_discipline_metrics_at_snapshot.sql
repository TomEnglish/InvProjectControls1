-- Per-discipline metrics computed against a frozen snapshot. Lets the
-- Reports page show "Budget vs Earned vs Actual as of last week" by
-- referencing a progress_snapshot rather than the live state.
--
-- Design choice: no project_metrics_at_snapshot RPC. The progress_snapshots
-- table already stores total_budget_hrs / total_earned_hrs / total_actual_hrs /
-- cpi / spi per snapshot, so the project-level pane reads them directly.
-- This RPC fills the gap for the per-discipline rollup that's NOT
-- pre-computed in the snapshot row.

create or replace function projectcontrols.discipline_metrics_at_snapshot(p_snapshot_id uuid)
returns table (
  discipline_id   uuid,
  discipline_code text,
  display_name    text,
  records         int,
  budget_hrs      numeric,
  earned_hrs      numeric,
  actual_hrs      numeric,
  earned_pct      numeric,
  cpi             numeric
)
language plpgsql
stable
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
begin
  perform projectcontrols.assert_role('viewer');

  if not exists (
    select 1 from projectcontrols.progress_snapshots s
    where s.id = p_snapshot_id and s.tenant_id = tid
  ) then
    raise exception 'snapshot not found in this tenant' using errcode = 'P0001';
  end if;

  return query
  select
    pd.id::uuid                     as discipline_id,
    pd.discipline_code::text        as discipline_code,
    pd.display_name::text           as display_name,
    count(*)::int                   as records,
    coalesce(sum(pr.budget_hrs), 0)::numeric  as budget_hrs,
    coalesce(sum(psi.earned_hrs), 0)::numeric as earned_hrs,
    coalesce(sum(psi.actual_hrs), 0)::numeric as actual_hrs,
    (case
       when coalesce(sum(pr.budget_hrs), 0) > 0
         then (coalesce(sum(psi.earned_hrs), 0) / sum(pr.budget_hrs)) * 100
       else 0
     end)::numeric                  as earned_pct,
    (case
       when coalesce(sum(psi.actual_hrs), 0) > 0
         then sum(psi.earned_hrs) / sum(psi.actual_hrs)
       else null
     end)::numeric                  as cpi
  from projectcontrols.progress_snapshot_items psi
  join projectcontrols.progress_records pr        on pr.id = psi.progress_record_id
  join projectcontrols.project_disciplines pd     on pd.id = pr.discipline_id
  where psi.snapshot_id = p_snapshot_id
    and psi.tenant_id   = tid
  group by pd.id, pd.discipline_code, pd.display_name
  order by pd.discipline_code;
end
$$;

revoke all on function projectcontrols.discipline_metrics_at_snapshot(uuid) from public;
grant execute on function projectcontrols.discipline_metrics_at_snapshot(uuid) to authenticated;
