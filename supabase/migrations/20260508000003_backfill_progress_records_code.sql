-- Backfill projectcontrols.progress_records.code for existing rows.
--
-- The column was added in 20260508000002_progress_records_coa_code.sql; new
-- uploads / new-record submissions populate it, but pre-existing rows are
-- still null which leaves the QMR report empty for tenants with historical
-- data (e.g. Sandra's UAT seed).
--
-- Strategy: assign a default cost code per record based on the discipline,
-- with keyword refinements from the description / attr_size so common items
-- (pumps, transmitters, foundations, cable trays, etc.) land on the right
-- code rather than the discipline-default catch-all. Only updates rows where
-- code IS NULL, so explicitly set codes are preserved.
--
-- This is a best-effort heuristic — admins can refine individual records
-- via the New Record modal once they spot misclassifications. The mapping
-- mirrors the choices made in scripts/seed/index.ts so re-seeded demo data
-- and backfilled UAT data end up with the same shape.

update projectcontrols.progress_records pr
set code = sub.code
from (
  select
    r.id,
    case
      -- ─── CIVIL ─────────────────────────────────────────────
      when pd.discipline_code = 'CIVIL' then case
        when r.description ilike '%backfill%'                            then '01420'
        when r.description ilike '%excav%' or r.description ilike '%dig%' then '01410'
        when r.description ilike '%paving%' or r.description ilike '%paveme%' then '04210'
        when r.description ilike '%wall%' or r.description ilike '%structur%' then '04500'
        when r.description ilike '%epox%'                                then '04620'
        when r.description ilike '%grout%'                               then '04630'
        when r.description ilike '%seal slab%' or r.description ilike '%seal-slab%' then '04700'
        when r.description ilike '%road%'                                then '04220'
        else '04130'  -- default: foundations / pads
      end
      -- ─── PIPE ──────────────────────────────────────────────
      when pd.discipline_code = 'PIPE' then case
        when r.description ilike '%alloy%' or r.description ilike '%stainless%' or r.attr_spec ilike 'A312%' then case
          when r.attr_size in ('1"', '1-1/2"', '2"', '2.5"') then '08221'
          when r.attr_size in ('12"', '14"', '16"', '18"', '20"', '24"') then '08223'
          else '08222'
        end
        when r.description ilike '%underground%' or r.description ilike '%u/g%' or r.description ilike '%ug %' then '08331'
        when r.attr_size in ('1"', '1-1/2"', '2"', '2.5"') then '08211'
        when r.attr_size in ('12"', '14"', '16"', '18"', '20"', '24"') then '08213'
        else '08212'  -- default: 3-10" CS field-run
      end
      -- ─── STEEL ─────────────────────────────────────────────
      when pd.discipline_code = 'STEEL' then case
        when r.description ilike '%piperack%' or r.description ilike '%pipe rack%' or r.description ilike '%cable tray%' then '05220'
        when r.description ilike '%handrail%' or r.description ilike '%stair%'
          or r.description ilike '%ladder%' or r.description ilike '%grate%'
          or r.description ilike '%platform%' or r.description ilike '%checker%'
          or r.description ilike '%plate%' or r.description ilike '%tread%' then '05230'
        else '05210'  -- default: major framing
      end
      -- ─── ELEC ──────────────────────────────────────────────
      when pd.discipline_code = 'ELEC' then case
        when r.description ilike '%tray%'                                then '09320'
        when r.description ilike '%duct bank%' or r.description ilike '%ductbank%' then '09210'
        when r.description ilike '%underground%conduit%' or r.description ilike '%u/g conduit%' then '09220'
        when r.description ilike '%conduit%'                             then '09310'
        when r.description ilike '%fiber%'                               then '09450'
        when r.description ilike '%lighting%' or r.description ilike '%light fixture%' then '09610'
        when r.description ilike '%mcc%' or r.description ilike '%motor control%' then '09550'
        when r.description ilike '%transformer%'                         then '09520'
        when r.description ilike '%breaker panel%' or r.description ilike '%panel%' then '09530'
        when r.description ilike '%junction box%' or r.description ilike '%pull box%' or r.description ilike '%terminal box%' then '09340'
        when r.description ilike '%ground%'                              then '09100'
        else '09420'  -- default: wire and cable
      end
      -- ─── MECH ──────────────────────────────────────────────
      when pd.discipline_code = 'MECH' then case
        when r.description ilike '%pump%'                                then '07140'
        when r.description ilike '%compressor%' or r.description ilike '%expander%' then '07130'
        when r.description ilike '%vessel%' or r.description ilike '%tank%' then '07120'
        when r.description ilike '%heat exchanger%' or r.description ilike '%exchanger%' then '07110'
        when r.description ilike '%cooling tower%'                       then '07185'
        when r.description ilike '%filter%'                              then '07160'
        when r.description ilike '%turbine%' or r.description ilike '%generator%' then '07410'
        else '07140'  -- default: pumps and drive
      end
      -- ─── INST ──────────────────────────────────────────────
      when pd.discipline_code = 'INST' then case
        when r.description ilike '%control valve%' or r.description ilike '%cv-%' or r.description ilike '%valve%' then '10210'
        when r.description ilike '%level%' or r.description ilike '%lt-%' or r.description ilike '%lg-%' or r.description ilike '%sight glass%' then '10220'
        when r.description ilike '%gas detect%'                          then '10420'
        when r.description ilike '%analy%' or r.description ilike '%analyzer%' then '10410'
        when r.description ilike '%air supply%' or r.description ilike '%tubing%' then '10550'
        when r.description ilike '%control panel%'                       then '10600'
        when r.description ilike '%calibrat%'                            then '10830'
        else '10110'  -- default: field-mounted instrument devices
      end
      -- ─── SITE ──────────────────────────────────────────────
      when pd.discipline_code = 'SITE' then case
        when r.description ilike '%crushed%' or r.description ilike '%rock%' then '01530'
        when r.description ilike '%drain%' or r.description ilike '%ditch%' or r.description ilike '%culvert%' then '01510'
        when r.description ilike '%backfill%'                            then '01420'
        when r.description ilike '%excav%'                               then '01410'
        when r.description ilike '%paving%' or r.description ilike '%pavement%' then '04210'
        when r.description ilike '%temp%' or r.description ilike '%survey%' or r.description ilike '%landscap%' then '01000'
        else '01530'  -- default: crushed rock / generic sitework
      end
      else null  -- no discipline → leave null
    end as code
  from projectcontrols.progress_records r
  left join projectcontrols.project_disciplines pd on pd.id = r.discipline_id
  where r.code is null
) sub
where pr.id = sub.id
  and sub.code is not null;
