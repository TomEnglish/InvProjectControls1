-- Replace the discipline-keyed ROC template system with a finer-grained
-- work-types library, conforming to the senior SME's Unified Audit
-- Workbook (2026-05-11). Excerpt from the SME's design:
--
--   "WORK_TYPE — Work type code - drives milestone descriptions and weights
--    via XLOOKUP to Milestone Reference sheet"
--
-- Differences from the old roc_templates approach:
--   * Previously one ROC template per discipline (8 milestones each).
--   * Now per-discipline there can be multiple work types (e.g., Civil has
--     CIV-PIER / CIV-FDN / CIV-COMP), each with a distinct milestone set of
--     1-8 entries that may differ in count and weight.
--   * Each progress_record links to a specific work_type via work_type_id.
--   * Earned-value math joins through work_type_milestones rather than
--     roc_milestones.
--   * Fallback: if a record's work_type_id is null, the project_discipline's
--     default_work_type_id supplies the template.
--
-- Migration order within this file:
--   1. New tables (work_types, work_type_milestones) with RLS
--   2. Seed 20 canonical work types + 100 milestones from the MR sheet
--   3. New columns on progress_records (work_type_id, tag_no, spool_fr,
--      service, discipline_label)
--   4. New column on project_disciplines (default_work_type_id) + backfill
--   5. Backfill progress_records.work_type_id from discipline default
--   6. Rewrite v_progress_record_ev to use work_type_milestones with fallback
--   7. Drop legacy roc_templates / roc_milestones (and the
--      project_disciplines.roc_template_id FK column)

-- ============================================================================
-- 1. Tables
-- ============================================================================

create table projectcontrols.work_types (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references projectcontrols.tenants(id) on delete restrict,
  work_type_code  text not null,
  discipline_code projectcontrols.discipline_code not null,
  description     text not null,
  is_default      boolean not null default false,
  version         smallint not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint wt_unique_code unique (tenant_id, work_type_code)
);
create index on projectcontrols.work_types(tenant_id);
create index on projectcontrols.work_types(discipline_code);
alter table projectcontrols.work_types enable row level security;

create policy "wt_tenant_read" on projectcontrols.work_types
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "wt_admin_write" on projectcontrols.work_types
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'));

-- One is_default work_type per (tenant, discipline). Enforced as a partial
-- unique index so non-default rows are unconstrained.
create unique index work_types_one_default_per_discipline
  on projectcontrols.work_types(tenant_id, discipline_code)
  where is_default;

create table projectcontrols.work_type_milestones (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references projectcontrols.tenants(id) on delete restrict,
  work_type_id  uuid not null references projectcontrols.work_types(id) on delete cascade,
  seq           smallint not null check (seq between 1 and 8),
  label         text not null,
  weight        numeric(8, 6) not null check (weight >= 0 and weight <= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint wtm_unique unique (work_type_id, seq)
);
create index on projectcontrols.work_type_milestones(tenant_id);
create index on projectcontrols.work_type_milestones(work_type_id);
alter table projectcontrols.work_type_milestones enable row level security;

create policy "wtm_tenant_read" on projectcontrols.work_type_milestones
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "wtm_admin_write" on projectcontrols.work_type_milestones
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'));

-- ============================================================================
-- 2. Seed work types + milestones (per-tenant loop for idempotency)
-- ============================================================================

do $$
declare
  t_id uuid;
  wt_rec record;
  wtm_rec record;
  inserted_wt_id uuid;
begin
  for t_id in select id from projectcontrols.tenants loop

    -- Work types
    for wt_rec in select * from (values
      ('CIV-PIER',  'CIVIL',       'Drilled Piers',                       false),
      ('CIV-FDN',   'CIVIL',       'Foundations (w/ Excavation)',         true),
      ('CIV-COMP',  'CIVIL',       'Simple Completion',                   false),
      ('PIPE-STD',  'PIPE',        'Standard Pipe',                       true),
      ('PIPE-JT',   'PIPE',        'Pipe w/ Jeep/Trace',                  false),
      ('STL-STD',   'STEEL',       'Standard Structural Steel',           true),
      ('ELEC-UG',   'ELEC',        'Underground / Ductbank',              false),
      ('ELEC-LTG',  'ELEC',        'Lighting',                            false),
      ('ELEC-COND', 'ELEC',        'Conduit',                             false),
      ('ELEC-TRAY', 'ELEC',        'Cable Tray',                          false),
      ('ELEC-PULL', 'ELEC',        'Cable Pull / Termination',            false),
      ('ELEC-SEAL', 'ELEC',        'Conduit w/ Seals',                    false),
      ('ELEC-INST', 'ELEC',        'Electrical Install (General)',        true),
      ('MECH-ROT',  'MECH',        'Rotating Equipment',                  false),
      ('MECH-VES',  'MECH',        'Vessels / Static Equipment',          false),
      ('MECH-MISC', 'MECH',        'Mechanical Install (General)',        true),
      ('INST-STD',  'INST',        'Standard Instrumentation',            true),
      ('INST-MISC', 'INST',        'Instrumentation Install (General)',   false),
      ('SITE-COMP', 'SITE',        'Site Work Completion',                true),
      ('FDN-STD',   'FOUNDATIONS', 'Standard Foundations',                true)
    ) as v(code, disc, desc_, is_def)
    loop
      insert into projectcontrols.work_types (
        tenant_id, work_type_code, discipline_code, description, is_default
      )
      values (
        t_id, wt_rec.code, wt_rec.disc::projectcontrols.discipline_code,
        wt_rec.desc_, wt_rec.is_def
      )
      on conflict (tenant_id, work_type_code) do update set
        discipline_code = excluded.discipline_code,
        description     = excluded.description,
        is_default      = excluded.is_default,
        updated_at      = now()
      returning id into inserted_wt_id;

      -- Wipe any existing milestones so the seed is idempotent — the next
      -- block re-inserts the canonical set.
      delete from projectcontrols.work_type_milestones where work_type_id = inserted_wt_id;
    end loop;

    -- Milestones: insert all by joining back to the freshly-inserted work_type.
    for wtm_rec in select * from (values
      ('CIV-PIER',  1, 'Drill',                 0.300000),
      ('CIV-PIER',  2, 'Rebar',                 0.250000),
      ('CIV-PIER',  3, 'Formwork',              0.300000),
      ('CIV-PIER',  4, 'Concrete',              0.050000),
      ('CIV-PIER',  5, 'Strip Form',            0.050000),
      ('CIV-PIER',  6, 'Rub/Patch',             0.050000),
      ('CIV-FDN',   1, 'Excavation',            0.050000),
      ('CIV-FDN',   2, 'Formwork',              0.300000),
      ('CIV-FDN',   3, 'Rebar',                 0.250000),
      ('CIV-FDN',   4, 'Concrete Placement',    0.100000),
      ('CIV-FDN',   5, 'Strip Forms',           0.100000),
      ('CIV-FDN',   6, 'Rub/Patch',             0.100000),
      ('CIV-FDN',   7, 'Backfill/Compact',      0.100000),
      ('CIV-COMP',  1, 'Complete',              1.000000),
      ('PIPE-STD',  1, 'Receive',               0.020000),
      ('PIPE-STD',  2, 'Stage',                 0.030000),
      ('PIPE-STD',  3, 'Erect',                 0.200000),
      ('PIPE-STD',  4, 'Connect',               0.300000),
      ('PIPE-STD',  5, 'Support',               0.100000),
      ('PIPE-STD',  6, 'Punch',                 0.100000),
      ('PIPE-STD',  7, 'Test',                  0.150000),
      ('PIPE-STD',  8, 'Post',                  0.100000),
      ('PIPE-JT',   1, 'Receive',               0.020000),
      ('PIPE-JT',   2, 'Stage',                 0.030000),
      ('PIPE-JT',   3, 'Erect',                 0.200000),
      ('PIPE-JT',   4, 'Connect',               0.300000),
      ('PIPE-JT',   5, 'Jeep/Trace',            0.100000),
      ('PIPE-JT',   6, 'Punch',                 0.100000),
      ('PIPE-JT',   7, 'Test',                  0.150000),
      ('PIPE-JT',   8, 'Post',                  0.100000),
      ('STL-STD',   1, 'Receive',               0.050000),
      ('STL-STD',   2, 'Shake Out',             0.050000),
      ('STL-STD',   3, 'PreAssemble',           0.150000),
      ('STL-STD',   4, 'Erect',                 0.200000),
      ('STL-STD',   5, 'Bolt Up',               0.200000),
      ('STL-STD',   6, 'Impact',                0.200000),
      ('STL-STD',   7, 'Punch',                 0.100000),
      ('STL-STD',   8, 'Sell Off',              0.050000),
      ('ELEC-UG',   1, 'Trenching',             0.300000),
      ('ELEC-UG',   2, 'Install Wire',          0.500000),
      ('ELEC-UG',   3, 'Backfill',              0.200000),
      ('ELEC-LTG',  1, 'Install Supports',      0.150000),
      ('ELEC-LTG',  2, 'Install Fixtures',      0.550000),
      ('ELEC-LTG',  3, 'Test',                  0.100000),
      ('ELEC-LTG',  4, 'Sell Off',              0.200000),
      ('ELEC-COND', 1, 'Receive Materials',     0.300000),
      ('ELEC-COND', 2, 'Run Conduit',           0.700000),
      ('ELEC-TRAY', 1, 'Receive Materials',     0.050000),
      ('ELEC-TRAY', 2, 'Install Supports',      0.300000),
      ('ELEC-TRAY', 3, 'Install Cable Tray',    0.550000),
      ('ELEC-TRAY', 4, 'Sell Off',              0.100000),
      ('ELEC-PULL', 1, 'Set Up',                0.050000),
      ('ELEC-PULL', 2, 'Pull Cable',            0.550000),
      ('ELEC-PULL', 3, 'Tie Wrap',              0.200000),
      ('ELEC-PULL', 4, 'Tail In',               0.150000),
      ('ELEC-PULL', 5, 'Test',                  0.050000),
      ('ELEC-SEAL', 1, 'Install Supports',      0.250000),
      ('ELEC-SEAL', 2, 'Run Conduit',           0.700000),
      ('ELEC-SEAL', 3, 'Pour Seals',            0.050000),
      ('ELEC-INST', 1, 'Receive',               0.050000),
      ('ELEC-INST', 2, 'Supports',              0.550000),
      ('ELEC-INST', 3, 'Install',               0.200000),
      ('ELEC-INST', 4, 'Testing',               0.150000),
      ('ELEC-INST', 5, 'Sell Off',              0.050000),
      ('MECH-ROT',  1, 'Prep FDN',              0.050000),
      ('MECH-ROT',  2, 'Receive',               0.050000),
      ('MECH-ROT',  3, 'Set',                   0.150000),
      ('MECH-ROT',  4, 'Pre Align',             0.250000),
      ('MECH-ROT',  5, 'Pipe Align',            0.100000),
      ('MECH-ROT',  6, 'Final Align',           0.250000),
      ('MECH-ROT',  7, 'Run-In',                0.100000),
      ('MECH-ROT',  8, 'Sell Off',              0.050000),
      ('MECH-VES',  1, 'Prep FDN',              0.050000),
      ('MECH-VES',  2, 'Receive',               0.100000),
      ('MECH-VES',  3, 'Set',                   0.250000),
      ('MECH-VES',  4, 'Internals/S-C',         0.250000),
      ('MECH-VES',  5, 'Inspect/Button Up',     0.250000),
      ('MECH-VES',  6, 'Sell Off',              0.100000),
      ('MECH-MISC', 1, 'Receive',               0.050000),
      ('MECH-MISC', 2, 'Support',               0.200000),
      ('MECH-MISC', 3, 'Install',               0.600000),
      ('MECH-MISC', 4, 'Testing',               0.100000),
      ('MECH-MISC', 5, 'Sell Off',              0.050000),
      ('INST-STD',  1, 'Receive',               0.050000),
      ('INST-STD',  2, 'Calibrate/Spec Check',  0.100000),
      ('INST-STD',  3, 'Stand',                 0.150000),
      ('INST-STD',  4, 'Install Device',        0.300000),
      ('INST-STD',  5, 'Tray and Tube',         0.300000),
      ('INST-STD',  6, 'Process Connection',    0.100000),
      ('INST-MISC', 1, 'Support',               0.450000),
      ('INST-MISC', 2, 'Install',               0.450000),
      ('INST-MISC', 3, 'Test',                  0.100000),
      ('SITE-COMP', 1, 'Complete',              1.000000),
      ('FDN-STD',   1, 'Excavation',            0.050000),
      ('FDN-STD',   2, 'Formwork',              0.300000),
      ('FDN-STD',   3, 'Rebar',                 0.250000),
      ('FDN-STD',   4, 'Concrete Placement',    0.100000),
      ('FDN-STD',   5, 'Strip Forms',           0.100000),
      ('FDN-STD',   6, 'Rub/Patch',             0.100000),
      ('FDN-STD',   7, 'Backfill/Compact',      0.100000)
    ) as v(code, seq, label_, weight_)
    loop
      insert into projectcontrols.work_type_milestones (
        tenant_id, work_type_id, seq, label, weight
      )
      select
        t_id,
        wt.id,
        wtm_rec.seq::smallint,
        wtm_rec.label_,
        wtm_rec.weight_::numeric(8, 6)
      from projectcontrols.work_types wt
      where wt.tenant_id = t_id and wt.work_type_code = wtm_rec.code;
    end loop;

  end loop;
end$$;

-- ============================================================================
-- 3. New columns on progress_records
-- ============================================================================

alter table projectcontrols.progress_records
  add column if not exists work_type_id     uuid references projectcontrols.work_types(id) on delete set null,
  add column if not exists tag_no           text,
  add column if not exists spool_fr         text,
  add column if not exists service          text,
  add column if not exists discipline_label text;

create index if not exists progress_records_project_work_type_idx
  on projectcontrols.progress_records(project_id, work_type_id);

-- ============================================================================
-- 4. New column on project_disciplines + backfill from is_default work_type
-- ============================================================================

alter table projectcontrols.project_disciplines
  add column if not exists default_work_type_id uuid
    references projectcontrols.work_types(id) on delete set null;

create index if not exists project_disciplines_default_work_type_idx
  on projectcontrols.project_disciplines(default_work_type_id);

-- For each existing project_discipline, point its default_work_type_id at
-- the is_default work_type for its discipline_code in the same tenant.
update projectcontrols.project_disciplines pd
   set default_work_type_id = wt.id
  from projectcontrols.work_types wt
 where wt.tenant_id = pd.tenant_id
   and wt.discipline_code = pd.discipline_code
   and wt.is_default
   and pd.default_work_type_id is null;

-- ============================================================================
-- 5. Backfill progress_records.work_type_id from the discipline default
-- ============================================================================

update projectcontrols.progress_records pr
   set work_type_id = pd.default_work_type_id
  from projectcontrols.project_disciplines pd
 where pd.id = pr.discipline_id
   and pr.work_type_id is null
   and pd.default_work_type_id is not null;

-- ============================================================================
-- 6. Rewrite v_progress_record_ev: join through work_types
-- ============================================================================

-- The view picks up the record's work_type_id, falling back to the
-- discipline's default_work_type_id. From there it joins to the
-- work_type_milestones library to get the milestone weights, and pairs
-- each weight with the per-record `value` from progress_record_milestones.
-- Earned percent = Σ (value × weight) / 100.
--
-- Records with no work_type and no discipline default (orphans) fall back
-- to the row's `percent_complete` column — same semantics as the previous
-- ROC-based view.

-- CREATE OR REPLACE can't reorder or add columns in an existing view (PG
-- 42P16). The new column shape includes work_type_id between discipline_id
-- and budget_qty, so drop-and-recreate.
drop view if exists projectcontrols.v_progress_record_ev;

create view projectcontrols.v_progress_record_ev as
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
  ) as earn_whrs
from projectcontrols.progress_records r
left join projectcontrols.project_disciplines pd on pd.id = r.discipline_id
left join projectcontrols.work_type_milestones wtm
  on wtm.work_type_id = coalesce(r.work_type_id, pd.default_work_type_id)
left join projectcontrols.progress_record_milestones m
  on m.progress_record_id = r.id and m.seq = wtm.seq
group by r.id;

grant select on projectcontrols.v_progress_record_ev to authenticated;

-- ============================================================================
-- 7. Drop legacy roc_templates + roc_milestones (and the FK column)
-- ============================================================================

-- progress_record_milestones used to FK to roc_milestones(id) ON DELETE SET
-- NULL — drop the column entirely. The label is denormalized on each row, so
-- the per-record milestone progress survives the schema change.
alter table projectcontrols.progress_record_milestones
  drop column if exists roc_milestone_id;

-- Detach project_disciplines from roc_templates before dropping the latter.
alter table projectcontrols.project_disciplines
  drop column if exists roc_template_id;

drop table if exists projectcontrols.roc_milestones;
drop table if exists projectcontrols.roc_templates;

-- The old roc_template_set RPC referenced the now-dropped tables.
drop function if exists projectcontrols.roc_template_set(uuid, jsonb);
