-- pgTAP — trigger-based audit logging for direct PostgREST table writes
-- (20260610000000_audit_triggers.sql).
--
-- Shape checks confirm the recorder function + all eight triggers exist and
-- the function is SECURITY DEFINER (audit_log has no insert policy, so an
-- invoker-rights trigger would fail under RLS for exactly the frontend
-- writes it exists to cover).
--
-- Behavioral checks run as the migration owner (RLS-bypassing), which is
-- fine: the subject under test is the trigger, not the policies — RLS on
-- the base tables is covered elsewhere. auth.uid() is null here, so
-- actor_id logs null, same as a service-role write.
--
-- Run locally with:
--   supabase test db

begin;

select plan(30);

-- ─────────────────────────────────────────────────────────────────────
-- 1. Recorder function exists and is SECURITY DEFINER.
-- ─────────────────────────────────────────────────────────────────────
select has_function('projectcontrols', 'audit_row_change', array[]::text[],
  'audit_row_change trigger function exists');
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.audit_row_change()'::regprocedure),
  true,
  'audit_row_change is SECURITY DEFINER'
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Every direct-write table carries the audit trigger.
-- ─────────────────────────────────────────────────────────────────────
select has_trigger('projectcontrols', 'projects', 'audit_projects',
  'projects has audit trigger');
select has_trigger('projectcontrols', 'project_disciplines', 'audit_project_disciplines',
  'project_disciplines has audit trigger');
select has_trigger('projectcontrols', 'project_coa_codes', 'audit_project_coa_codes',
  'project_coa_codes has audit trigger');
select has_trigger('projectcontrols', 'project_discipline_weights', 'audit_project_discipline_weights',
  'project_discipline_weights has audit trigger');
select has_trigger('projectcontrols', 'foreman_aliases', 'audit_foreman_aliases',
  'foreman_aliases has audit trigger');
select has_trigger('projectcontrols', 'progress_records', 'audit_progress_records',
  'progress_records has audit trigger');
select has_trigger('projectcontrols', 'progress_record_milestones', 'audit_progress_record_milestones',
  'progress_record_milestones has audit trigger');
select has_trigger('projectcontrols', 'attachments', 'audit_attachments',
  'attachments has audit trigger');

-- ─────────────────────────────────────────────────────────────────────
-- 3. Behavior — insert / update / no-op update / delete on projects.
--    Fixture rows live only inside this transaction (rollback below).
-- ─────────────────────────────────────────────────────────────────────
insert into projectcontrols.tenants (id, name)
values ('00000000-0000-0000-0000-00000000a001', 'audit-trigger-test-tenant');

insert into projectcontrols.projects
  (id, tenant_id, project_code, name, client, start_date, end_date)
values
  ('00000000-0000-0000-0000-00000000b001',
   '00000000-0000-0000-0000-00000000a001',
   'AT-1', 'Audit Trigger Test', 'pgTAP', '2026-01-01', '2026-12-31');

select is(
  (select count(*)::int from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'insert'),
  1,
  'projects insert writes one audit_log row'
);
select is(
  (select after_json ->> 'name' from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'insert'),
  'Audit Trigger Test',
  'insert audit row captures after_json'
);
select is(
  (select before_json from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'insert'),
  null,
  'insert audit row has null before_json'
);
select is(
  (select tenant_id from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'insert'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'audit row tenant_id comes from the mutated row'
);

update projectcontrols.projects
  set name = 'Audit Trigger Test v2'
  where id = '00000000-0000-0000-0000-00000000b001';

select is(
  (select count(*)::int from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'update'),
  1,
  'projects update writes one audit_log row'
);
select is(
  (select before_json ->> 'name' from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'update'),
  'Audit Trigger Test',
  'update audit row captures before_json'
);
select is(
  (select after_json ->> 'name' from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'update'),
  'Audit Trigger Test v2',
  'update audit row captures after_json'
);

-- A no-op update (identical row, the PostgREST-upsert shape) must not log.
update projectcontrols.projects
  set name = 'Audit Trigger Test v2'
  where id = '00000000-0000-0000-0000-00000000b001';

select is(
  (select count(*)::int from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'update'),
  1,
  'no-op update writes no audit_log row'
);

delete from projectcontrols.projects
  where id = '00000000-0000-0000-0000-00000000b001';

select is(
  (select count(*)::int from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'delete'),
  1,
  'projects delete writes one audit_log row'
);
select is(
  (select before_json ->> 'name' from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'delete'),
  'Audit Trigger Test v2',
  'delete audit row captures before_json'
);
select is(
  (select after_json from projectcontrols.audit_log
    where entity = 'projects'
      and entity_id = '00000000-0000-0000-0000-00000000b001'
      and action = 'delete'),
  null,
  'delete audit row has null after_json'
);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Behavior — composite-PK table (project_discipline_weights):
--    entity_id is null, key columns live in the JSON payloads.
--    Needs a fresh project + discipline (the one above was deleted).
-- ─────────────────────────────────────────────────────────────────────
insert into projectcontrols.projects
  (id, tenant_id, project_code, name, client, start_date, end_date)
values
  ('00000000-0000-0000-0000-00000000b002',
   '00000000-0000-0000-0000-00000000a001',
   'AT-2', 'Audit Trigger Test 2', 'pgTAP', '2026-01-01', '2026-12-31');

insert into projectcontrols.project_disciplines
  (id, tenant_id, project_id, discipline_code, display_name)
values
  ('00000000-0000-0000-0000-00000000c001',
   '00000000-0000-0000-0000-00000000a001',
   '00000000-0000-0000-0000-00000000b002',
   'CIVIL', 'Civil');

select is(
  (select count(*)::int from projectcontrols.audit_log
    where entity = 'project_disciplines'
      and entity_id = '00000000-0000-0000-0000-00000000c001'
      and action = 'insert'),
  1,
  'project_disciplines insert writes one audit_log row'
);

insert into projectcontrols.project_discipline_weights
  (tenant_id, project_id, discipline_id, weight)
values
  ('00000000-0000-0000-0000-00000000a001',
   '00000000-0000-0000-0000-00000000b002',
   '00000000-0000-0000-0000-00000000c001',
   0.5);

select is(
  (select count(*)::int from projectcontrols.audit_log
    where entity = 'project_discipline_weights'
      and action = 'insert'
      and tenant_id = '00000000-0000-0000-0000-00000000a001'),
  1,
  'project_discipline_weights insert writes one audit_log row'
);
select is(
  (select entity_id from projectcontrols.audit_log
    where entity = 'project_discipline_weights'
      and action = 'insert'
      and tenant_id = '00000000-0000-0000-0000-00000000a001'),
  null,
  'composite-PK audit row has null entity_id'
);
select is(
  (select after_json ->> 'discipline_id' from projectcontrols.audit_log
    where entity = 'project_discipline_weights'
      and action = 'insert'
      and tenant_id = '00000000-0000-0000-0000-00000000a001'),
  '00000000-0000-0000-0000-00000000c001',
  'composite-PK audit row carries its key columns in after_json'
);
select is(
  (select (after_json ->> 'weight')::numeric from projectcontrols.audit_log
    where entity = 'project_discipline_weights'
      and action = 'insert'
      and tenant_id = '00000000-0000-0000-0000-00000000a001'),
  0.5::numeric,
  'composite-PK audit row carries the payload in after_json'
);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Behavior — progress_records: NewRecordModal's direct-insert path.
--    Generated EV columns must appear in after_json (AFTER trigger sees
--    stored generated values).
-- ─────────────────────────────────────────────────────────────────────
insert into projectcontrols.progress_records
  (id, tenant_id, project_id, description, budget_hrs, percent_complete)
values
  ('00000000-0000-0000-0000-00000000d001',
   '00000000-0000-0000-0000-00000000a001',
   '00000000-0000-0000-0000-00000000b002',
   'pgTAP record', 100, 25);

select is(
  (select count(*)::int from projectcontrols.audit_log
    where entity = 'progress_records'
      and entity_id = '00000000-0000-0000-0000-00000000d001'
      and action = 'insert'),
  1,
  'progress_records insert writes one audit_log row'
);
select is(
  (select (after_json ->> 'earned_hrs')::numeric from projectcontrols.audit_log
    where entity = 'progress_records'
      and entity_id = '00000000-0000-0000-0000-00000000d001'
      and action = 'insert'),
  25::numeric,
  'progress_records audit row includes stored generated columns'
);

insert into projectcontrols.progress_record_milestones
  (id, tenant_id, progress_record_id, seq, label, value)
values
  ('00000000-0000-0000-0000-00000000e001',
   '00000000-0000-0000-0000-00000000a001',
   '00000000-0000-0000-0000-00000000d001',
   1, 'MS1', 25);

select is(
  (select count(*)::int from projectcontrols.audit_log
    where entity = 'progress_record_milestones'
      and entity_id = '00000000-0000-0000-0000-00000000e001'
      and action = 'insert'),
  1,
  'progress_record_milestones insert writes one audit_log row'
);

-- RecordDetail's upsert path: update the milestone value.
update projectcontrols.progress_record_milestones
  set value = 50
  where id = '00000000-0000-0000-0000-00000000e001';

select is(
  (select (before_json ->> 'value')::numeric from projectcontrols.audit_log
    where entity = 'progress_record_milestones'
      and entity_id = '00000000-0000-0000-0000-00000000e001'
      and action = 'update'),
  25::numeric,
  'milestone update audit row captures the before value'
);

select * from finish();

rollback;
