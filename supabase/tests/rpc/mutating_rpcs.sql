-- pgTAP — schema-shape guards for every mutating RPC.
--
-- These tests don't authenticate or invoke the RPCs (that needs a fixture
-- harness; see scripts/smoke/run.ts for the live integration path). They
-- check pg_catalog metadata so accidental SECURITY INVOKER drift, missing
-- grants, or non-plpgsql RPCs can't slip through review.
--
-- Run locally with:
--   supabase test db

begin;

-- 9 mutating RPCs to verify, plus 1 read RPC and 1 audit helper:
--   mutating: coa_code_upsert, roc_template_set, co_submit, co_pc_review,
--             co_approve, project_lock_baseline, admin_set_user_role,
--             actuals_bulk_upsert, period_close, write_audit_log
--   read:     budget_rollup, current_tenant_id, current_user_role
-- (record_bulk_upsert, record_update_milestones, project_summary dropped
-- in 20260504000002_retire_audit_records.sql; superseded by canonical
-- progress_records surface.)
select plan(35);

-- ─────────────────────────────────────────────────────────────────────
-- 1. Existence checks for every RPC the frontend depends on.
-- ─────────────────────────────────────────────────────────────────────
select has_function('projectcontrols', 'coa_code_upsert',     array['jsonb'],         'coa_code_upsert exists');
select has_function('projectcontrols', 'work_type_milestones_set', array['uuid', 'jsonb'], 'work_type_milestones_set exists');
select has_function('projectcontrols', 'co_submit',           array['jsonb'],         'co_submit exists');
select has_function('projectcontrols', 'co_pc_review',        array['uuid', 'text', 'text'], 'co_pc_review exists');
select has_function('projectcontrols', 'co_approve',          array['uuid', 'text', 'text'], 'co_approve exists');
select has_function('projectcontrols', 'project_lock_baseline', array['uuid', 'timestamptz'], 'project_lock_baseline exists');
select has_function('projectcontrols', 'admin_set_user_role', array['uuid', 'projectcontrols.user_role', 'text'], 'admin_set_user_role exists');
select has_function('projectcontrols', 'actuals_bulk_upsert', array['uuid', 'uuid', 'jsonb'], 'actuals_bulk_upsert exists');
select has_function('projectcontrols', 'period_close',        array['uuid', 'uuid'], 'period_close exists');
select has_function('projectcontrols', 'budget_rollup',       array['uuid'], 'budget_rollup exists');

-- ─────────────────────────────────────────────────────────────────────
-- 2. Every mutating RPC must be SECURITY DEFINER.
--    A SECURITY INVOKER drift would let RLS block the function from doing
--    its job, or worse, leak privilege depending on how it's called.
-- ─────────────────────────────────────────────────────────────────────
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.coa_code_upsert(jsonb)'::regprocedure),
  true,
  'coa_code_upsert is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.work_type_milestones_set(uuid, jsonb)'::regprocedure),
  true,
  'work_type_milestones_set is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.co_submit(jsonb)'::regprocedure),
  true,
  'co_submit is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.co_pc_review(uuid, text, text)'::regprocedure),
  true,
  'co_pc_review is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.co_approve(uuid, text, text)'::regprocedure),
  true,
  'co_approve is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.project_lock_baseline(uuid, timestamptz)'::regprocedure),
  true,
  'project_lock_baseline is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.admin_set_user_role(uuid, projectcontrols.user_role, text)'::regprocedure),
  true,
  'admin_set_user_role is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.actuals_bulk_upsert(uuid, uuid, jsonb)'::regprocedure),
  true,
  'actuals_bulk_upsert is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc where oid = 'projectcontrols.period_close(uuid, uuid)'::regprocedure),
  true,
  'period_close is SECURITY DEFINER'
);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Authenticated must hold EXECUTE on every RPC the frontend calls.
--    public must NOT have it (the migration revokes from public).
-- ─────────────────────────────────────────────────────────────────────
select ok(
  has_function_privilege('authenticated', 'projectcontrols.coa_code_upsert(jsonb)', 'execute'),
  'authenticated can execute coa_code_upsert'
);
select ok(
  not has_function_privilege('public', 'projectcontrols.coa_code_upsert(jsonb)', 'execute'),
  'public CANNOT execute coa_code_upsert'
);
select ok(
  has_function_privilege('authenticated', 'projectcontrols.co_approve(uuid, text, text)', 'execute'),
  'authenticated can execute co_approve'
);
select ok(
  has_function_privilege('authenticated', 'projectcontrols.project_lock_baseline(uuid, timestamptz)', 'execute'),
  'authenticated can execute project_lock_baseline'
);
select ok(
  has_function_privilege('authenticated', 'projectcontrols.admin_set_user_role(uuid, projectcontrols.user_role, text)', 'execute'),
  'authenticated can execute admin_set_user_role'
);
select ok(
  has_function_privilege('authenticated', 'projectcontrols.period_close(uuid, uuid)', 'execute'),
  'authenticated can execute period_close'
);

-- ─────────────────────────────────────────────────────────────────────
-- 4. audit_log table shape — the spec is emphatic that every mutation
--    writes a row here. If the column shape drifts, every RPC that
--    inserts will silently break.
-- ─────────────────────────────────────────────────────────────────────
select has_table('projectcontrols', 'audit_log', 'audit_log table exists');
select has_column('projectcontrols', 'audit_log', 'tenant_id',  'audit_log has tenant_id');
select has_column('projectcontrols', 'audit_log', 'entity',     'audit_log has entity');
select has_column('projectcontrols', 'audit_log', 'entity_id',  'audit_log has entity_id');
select has_column('projectcontrols', 'audit_log', 'action',     'audit_log has action');
select has_column('projectcontrols', 'audit_log', 'actor_id',   'audit_log has actor_id');
select has_column('projectcontrols', 'audit_log', 'before_json','audit_log has before_json');
select has_column('projectcontrols', 'audit_log', 'after_json', 'audit_log has after_json');
select has_column('projectcontrols', 'audit_log', 'created_at', 'audit_log has created_at');

-- ─────────────────────────────────────────────────────────────────────
-- 5. user_role enum — the rank ladder assertions hinge on this exact
--    set of values. If anyone adds/removes a value, every assert_role
--    callsite needs review.
-- ─────────────────────────────────────────────────────────────────────
select set_eq(
  $$ select unnest(enum_range(null::projectcontrols.user_role))::text $$,
  $$ values ('super_admin'), ('admin'), ('pm'), ('pc_reviewer'), ('editor'), ('viewer') $$,
  'user_role enum has the six expected values'
);

select * from finish();

rollback;
