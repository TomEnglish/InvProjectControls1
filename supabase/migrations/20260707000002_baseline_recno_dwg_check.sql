-- Data Check additions: REC_NO sequence integrity + DWG presence.
--
-- Two per-discipline (= per audit tab) integrity checks over the baseline
-- records, requested after UAT found source workbooks with REC_NO errors:
--
--   1. REC_NO sequence — the file's REC_NO (stored as source_row) should run
--      1..N with no gaps and no duplicates, where N is the tab's row count.
--      A gap, a duplicate, a start ≠ 1, or a missing REC_NO all fail.
--   2. DWG presence — every row that carries a REC_NO must have a non-empty
--      DWG. A null/blank DWG on a numbered row fails.
--
-- Grouped by discipline_code because each QMR audit tab maps to one
-- discipline; the frontend renders one row per discipline. Samples of the
-- offending numbers are returned (capped) so a reviewer can jump straight to
-- the bad rows in the source file.

create or replace function projectcontrols.baseline_recno_dwg_check(p_project_id uuid)
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
    select
      coalesce(pd.discipline_code::text, '(unassigned)') as dcode,
      coalesce(pd.display_name, 'Unassigned') as dname,
      r.source_row,
      r.dwg
    from projectcontrols.progress_records r
    left join projectcontrols.project_disciplines pd on pd.id = r.discipline_id
    where r.project_id = p_project_id
      and r.tenant_id = tid
      and r.source_type = 'baseline'
  ),
  base as (
    select
      dcode,
      max(dname) as dname,
      count(*) as total_rows,
      count(source_row) as recno_present,
      count(*) - count(source_row) as recno_nulls,
      min(source_row) as recno_min,
      max(source_row) as recno_max,
      count(distinct source_row) as recno_distinct,
      count(*) filter (
        where source_row is not null and (dwg is null or btrim(dwg) = '')
      ) as dwg_null_count
    from recs
    group by dcode
  ),
  -- Missing numbers: expected sequence is 1..total_rows for the tab.
  missing as (
    select s.dcode, array_agg(s.g order by s.g) as missing_all
    from (
      select b.dcode, generate_series(1, b.total_rows::int) as g
      from base b
    ) s
    where not exists (
      select 1 from recs r where r.dcode = s.dcode and r.source_row = s.g
    )
    group by s.dcode
  ),
  -- Duplicated REC_NO values within the tab.
  dups as (
    select d.dcode, array_agg(d.source_row order by d.source_row) as dup_all
    from (
      select dcode, source_row
      from recs
      where source_row is not null
      group by dcode, source_row
      having count(*) > 1
    ) d
    group by d.dcode
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'discipline_code', b.dcode,
        'display_name', b.dname,
        'total_rows', b.total_rows,
        'recno_nulls', b.recno_nulls,
        'recno_min', b.recno_min,
        'recno_max', b.recno_max,
        'recno_distinct', b.recno_distinct,
        'missing_count', coalesce(array_length(m.missing_all, 1), 0),
        'missing_sample', to_jsonb(coalesce(m.missing_all[1:20], array[]::int[])),
        'duplicate_count', coalesce(array_length(d.dup_all, 1), 0),
        'duplicate_sample', to_jsonb(coalesce(d.dup_all[1:20], array[]::int[])),
        'dwg_null_count', b.dwg_null_count,
        -- Exactly 1..N iff no null REC_NO, starts at 1, tops out at N, and
        -- every value distinct (distinct = total ⇒ no duplicates and no gaps).
        'recno_ok', (
          b.recno_nulls = 0
          and b.recno_min = 1
          and b.recno_max = b.total_rows
          and b.recno_distinct = b.total_rows
        ),
        'dwg_ok', (b.dwg_null_count = 0)
      )
      order by b.dcode
    ),
    '[]'::jsonb
  )
  into result
  from base b
  left join missing m on m.dcode = b.dcode
  left join dups d on d.dcode = b.dcode;

  return jsonb_build_object('disciplines', result);
end
$$;

grant execute on function projectcontrols.baseline_recno_dwg_check(uuid) to authenticated;
