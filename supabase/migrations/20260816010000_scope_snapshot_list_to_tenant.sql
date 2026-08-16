-- Keep snapshot history scoped to the caller's tenant when exposed through
-- the security-definer list RPC.

create or replace function projectcontrols.list_snapshots(p_project_id uuid)
returns table (
  id uuid,
  kind text,
  snapshot_date date,
  week_ending date,
  label text,
  source_filename text,
  total_budget_hrs numeric,
  total_earned_hrs numeric,
  total_actual_hrs numeric,
  cpi numeric,
  spi numeric,
  record_count bigint,
  reversible boolean
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
    s.source_filename,
    s.total_budget_hrs,
    s.total_earned_hrs,
    s.total_actual_hrs,
    s.cpi,
    s.spi,
    count(psi.progress_record_id)::bigint as record_count,
    count(psi.progress_record_id) > 0
      and count(psi.progress_record_id) = count(psi.progress_record_id)
        filter (where psi.before_percent_complete is not null and psi.before_milestones is not null)
      as reversible
  from projectcontrols.progress_snapshots s
  left join projectcontrols.progress_snapshot_items psi on psi.snapshot_id = s.id
  where s.project_id = p_project_id
    and s.tenant_id = projectcontrols.current_tenant_id()
  group by s.id
  order by s.snapshot_date desc, s.created_at desc;
$$;

grant execute on function projectcontrols.list_snapshots(uuid) to authenticated;
