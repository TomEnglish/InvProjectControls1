-- Ingestion Data Check (post-QMR-import verification).
--
-- Two halves:
--   1. import_manifests — the "answer key" captured at import time. The QMR
--      baseline card computes per-tab aggregates (row count, per-column
--      non-null counts, numeric sums/ranges, milestone entries, work-type
--      pivot) from the exact payload it sent to import-baseline-records and
--      persists them here. History is kept (no upsert); the Data Check page
--      reads the latest manifest per (project, sheet) — so a duplicate
--      re-import shows up as DB > manifest rather than being papered over.
--   2. baseline_ingestion_stats(project) — recomputes the same aggregates
--      from progress_records / progress_record_milestones, grouped by
--      discipline, in one call. The Data Check page diffs the two sides.

create table projectcontrols.import_manifests (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id       uuid not null references projectcontrols.projects(id) on delete cascade,
  source_filename  text,
  sheet_name       text not null,
  discipline_code  projectcontrols.discipline_code,
  -- Row counts along the chain: rows in the file's tab → rows the parser
  -- accepted → (DB side comes from baseline_ingestion_stats at read time).
  sheet_row_count  int not null,
  parsed_row_count int not null,
  -- Aggregates over the sent payload. Shape mirrors the per-discipline
  -- objects returned by baseline_ingestion_stats so the frontend can diff
  -- key-for-key: { columns: {col: nonNullCount}, sums: {...},
  -- numeric_ranges: {...}, budget_hrs_nonzero, milestone_entries,
  -- work_types: {code: count} }.
  stats            jsonb not null,
  created_by       uuid references projectcontrols.app_users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index on projectcontrols.import_manifests(tenant_id);
create index on projectcontrols.import_manifests(project_id, sheet_name, created_at desc);
alter table projectcontrols.import_manifests enable row level security;

create policy "im_tenant_read" on projectcontrols.import_manifests
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

-- Insert-only for the roles allowed to load baselines (mirrors the
-- import-baseline-records edge fn's ALLOWED_ROLES). No update/delete —
-- manifests are an immutable audit trail of what was sent.
create policy "im_baseline_loader_insert" on projectcontrols.import_manifests
  for insert to authenticated
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm')
  );

-- ============================================================================
-- baseline_ingestion_stats — DB-side aggregates for the Data Check page.
-- ============================================================================
-- Returns one object per discipline (plus '(unassigned)' for records without
-- a discipline_id) over the project's baseline records. Column keys match
-- the manifest's stats.columns keys; iwp_name→iwp_id and work_type→the
-- work_types pivot are the only renames (documented on the Data Check page).

create or replace function projectcontrols.baseline_ingestion_stats(p_project_id uuid)
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

  with recs as (
    select r.*,
           coalesce(pd.discipline_code::text, '(unassigned)') as dcode,
           coalesce(pd.display_name, 'Unassigned') as dname
    from projectcontrols.progress_records r
    left join projectcontrols.project_disciplines pd on pd.id = r.discipline_id
    where r.project_id = p_project_id
      and r.tenant_id = tid
      and r.source_type = 'baseline'
  ),
  ms_counts as (
    select recs.dcode, count(*) as milestone_rows
    from recs
    join projectcontrols.progress_record_milestones m
      on m.progress_record_id = recs.id
    group by recs.dcode
  ),
  wt_pivot as (
    select g.dcode,
           jsonb_object_agg(coalesce(w.work_type_code, '(none)'), g.cnt) as work_types
    from (
      select dcode, work_type_id, count(*) as cnt
      from recs
      group by dcode, work_type_id
    ) g
    left join projectcontrols.work_types w on w.id = g.work_type_id
    group by g.dcode
  ),
  agg as (
    select
      dcode,
      max(dname) as dname,
      count(*) as row_count,
      jsonb_build_object(
        'dwg', count(dwg), 'rev', count(rev), 'code', count(code),
        'tag_no', count(tag_no), 'spool_fr', count(spool_fr),
        'sched_id', count(sched_id), 'system', count(system),
        'carea', count(carea), 'line_area', count(line_area),
        'var_area', count(var_area), 'test_pkg', count(test_pkg),
        'cwp', count(cwp), 'foreman_name', count(foreman_name),
        'gen_foreman_name', count(gen_foreman_name),
        'attr_type', count(attr_type), 'attr_size', count(attr_size),
        'attr_spec', count(attr_spec), 'paint_spec', count(paint_spec),
        'insu_spec', count(insu_spec), 'heat_trace_spec', count(heat_trace_spec),
        'service', count(service), 'ta_bank', count(ta_bank),
        'ta_bay', count(ta_bay), 'ta_level', count(ta_level),
        'pslip', count(pslip), 'discipline_label', count(discipline_label),
        'budget_qty', count(budget_qty), 'spl_cnt', count(spl_cnt),
        'source_row', count(source_row), 'iwp_id', count(iwp_id),
        'work_type_id', count(work_type_id)
      ) as columns,
      jsonb_build_object(
        'budget_qty', coalesce(sum(budget_qty), 0),
        'budget_hrs', coalesce(sum(budget_hrs), 0),
        'spl_cnt', coalesce(sum(spl_cnt), 0)
      ) as sums,
      jsonb_build_object(
        'budget_qty', jsonb_build_object('min', min(budget_qty), 'max', max(budget_qty)),
        'budget_hrs', jsonb_build_object('min', min(budget_hrs), 'max', max(budget_hrs)),
        'source_row', jsonb_build_object('min', min(source_row), 'max', max(source_row))
      ) as numeric_ranges,
      count(*) filter (where budget_hrs <> 0) as budget_hrs_nonzero
    from recs
    group by dcode
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'discipline_code', agg.dcode,
        'display_name', agg.dname,
        'row_count', agg.row_count,
        'milestone_entries', coalesce(ms_counts.milestone_rows, 0),
        'columns', agg.columns,
        'sums', agg.sums,
        'numeric_ranges', agg.numeric_ranges,
        'budget_hrs_nonzero', agg.budget_hrs_nonzero,
        'work_types', coalesce(wt_pivot.work_types, '{}'::jsonb)
      )
      order by agg.dcode
    ),
    '[]'::jsonb
  )
  into result
  from agg
  left join ms_counts on ms_counts.dcode = agg.dcode
  left join wt_pivot on wt_pivot.dcode = agg.dcode;

  return jsonb_build_object('disciplines', result);
end
$$;

grant execute on function projectcontrols.baseline_ingestion_stats(uuid) to authenticated;
