-- The 20260508000003 backfill predates the FOUNDATIONS discipline added in
-- 20260511000000. New Foundations records created via the New Record modal
-- need a default cost code so the QMR rollup picks them up — same heuristic
-- the parity test (frontend/src/lib/disciplineDefaultsSync.test.ts) checks.
--
-- This migration just brings the case-when chain on the backfill RPC up to
-- date with the modal's DEFAULT_CODE_BY_DISCIPLINE map. There's no actual
-- backfill to do for existing rows — Foundations records didn't exist when
-- the original backfill ran, so this is a no-op against the data.

-- The original backfill was a one-shot update, not a function. We don't
-- replay it here; the parity test reads the case-when text from
-- 20260508000003 plus this extension. Append a FOUNDATIONS clause via a
-- second one-shot update so the SQL text now contains the FOUNDATIONS
-- branch alongside the others.

update projectcontrols.progress_records pr
set code = sub.code
from (
  select
    r.id,
    case
      when pd.discipline_code = 'FOUNDATIONS' then case
        when r.description ilike '%backfill%' then '01420'
        when r.description ilike '%excav%' or r.description ilike '%dig%' then '01410'
        when r.description ilike '%paving%' then '04210'
        when r.description ilike '%epox%' then '04620'
        when r.description ilike '%grout%' then '04630'
        else '04130'  -- default: foundations (same as Civil — FDN-STD shares CIV-FDN milestone set)
      end
      else null
    end as code
  from projectcontrols.progress_records r
  left join projectcontrols.project_disciplines pd on pd.id = r.discipline_id
  where r.code is null
) sub
where pr.id = sub.id
  and sub.code is not null;
