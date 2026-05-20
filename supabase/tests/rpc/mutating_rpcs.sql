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
--
-- A20 Wave 1 additions:
--   mutating: clerk_crafts_set, upload_queue_submit,
--             upload_queue_state_transition, upload_queue_llm_update
--   user_role enum gains 'clerk' (rank 2, between viewer and editor)
--
-- A20 Wave 2 additions:
--   table: llm_invocation_log (rate-limit + cost tracking for the async
--          LLM consistency scan). No RPCs — scan logic lives in app code.
--
-- Wave A (A2/A18/A21) additions:
--   mutating: project_coa_pf_set (admin-only per-project PF override
--             with audit log; the picker-card RPC adds an "admin can
--             change U/R per job" capability Sandra called out in UAT
--             item 2).
--
-- CO routing additions (20260520):
--   table: project_co_reviewers (per-project, per-discipline default
--          assignment of PC reviewer + PM)
--   mutating: project_co_reviewer_set (admin/pm setter, audit-logged)
--   change_orders gains assigned_pc_reviewer_id + assigned_pm_id columns
--   co_pc_review signature changed to admit a re-assignment parameter
select plan(63);

-- ─────────────────────────────────────────────────────────────────────
-- 1. Existence checks for every RPC the frontend depends on.
-- ─────────────────────────────────────────────────────────────────────
select has_function('projectcontrols', 'coa_code_upsert',     array['jsonb'],         'coa_code_upsert exists');
select has_function('projectcontrols', 'work_type_milestones_set', array['uuid', 'jsonb'], 'work_type_milestones_set exists');
select has_function('projectcontrols', 'co_submit',           array['jsonb'],         'co_submit exists');
-- co_pc_review v3 added a 4th uuid parameter (p_reassign_pm_id) so a
-- PC reviewer can override the assigned PM at forward time. The
-- 3-argument signature was dropped in 20260520000002.
select has_function('projectcontrols', 'co_pc_review',        array['uuid', 'text', 'text', 'uuid'], 'co_pc_review v3 exists');
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
  (select prosecdef from pg_proc where oid = 'projectcontrols.co_pc_review(uuid, text, text, uuid)'::regprocedure),
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
  $$ values ('super_admin'), ('admin'), ('pm'), ('pc_reviewer'), ('editor'), ('clerk'), ('viewer') $$,
  'user_role enum has the seven expected values (clerk added in A20 Wave 1)'
);

-- ─────────────────────────────────────────────────────────────────────
-- 6. A20 Wave 1 — clerk_crafts_set + upload_queue RPC surface.
--    All four RPCs must exist with the right signatures, be SECURITY
--    DEFINER, and have execute granted to the appropriate roles. The
--    LLM-update RPC's grant goes to service_role (NOT authenticated) —
--    only the queue-llm-check edge fn (which holds the service-role key)
--    should be able to spoof an LLM scan result.
-- ─────────────────────────────────────────────────────────────────────
select has_function('projectcontrols', 'clerk_crafts_set',
  array['uuid', 'uuid', 'projectcontrols.discipline_code[]'],
  'clerk_crafts_set exists');
select has_function('projectcontrols', 'upload_queue_submit',
  array['uuid', 'projectcontrols.discipline_code', 'text', 'text', 'text',
        'bigint', 'jsonb', 'jsonb', 'boolean', 'date', 'text'],
  'upload_queue_submit exists');
select has_function('projectcontrols', 'upload_queue_state_transition',
  array['uuid', 'text', 'uuid', 'text'],
  'upload_queue_state_transition exists');
select has_function('projectcontrols', 'upload_queue_llm_update',
  array['uuid', 'jsonb', 'text'],
  'upload_queue_llm_update exists');

select is(
  (select prosecdef from pg_proc
     where oid = 'projectcontrols.clerk_crafts_set(uuid, uuid, projectcontrols.discipline_code[])'::regprocedure),
  true,
  'clerk_crafts_set is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc
     where oid = 'projectcontrols.upload_queue_submit(uuid, projectcontrols.discipline_code, text, text, text, bigint, jsonb, jsonb, boolean, date, text)'::regprocedure),
  true,
  'upload_queue_submit is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc
     where oid = 'projectcontrols.upload_queue_state_transition(uuid, text, uuid, text)'::regprocedure),
  true,
  'upload_queue_state_transition is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc
     where oid = 'projectcontrols.upload_queue_llm_update(uuid, jsonb, text)'::regprocedure),
  true,
  'upload_queue_llm_update is SECURITY DEFINER'
);

select ok(
  has_function_privilege('authenticated', 'projectcontrols.clerk_crafts_set(uuid, uuid, projectcontrols.discipline_code[])', 'execute'),
  'authenticated can execute clerk_crafts_set'
);
select ok(
  has_function_privilege('authenticated', 'projectcontrols.upload_queue_submit(uuid, projectcontrols.discipline_code, text, text, text, bigint, jsonb, jsonb, boolean, date, text)', 'execute'),
  'authenticated can execute upload_queue_submit'
);
select ok(
  has_function_privilege('authenticated', 'projectcontrols.upload_queue_state_transition(uuid, text, uuid, text)', 'execute'),
  'authenticated can execute upload_queue_state_transition'
);
select ok(
  has_function_privilege('service_role', 'projectcontrols.upload_queue_llm_update(uuid, jsonb, text)', 'execute'),
  'service_role can execute upload_queue_llm_update'
);
select ok(
  not has_function_privilege('authenticated', 'projectcontrols.upload_queue_llm_update(uuid, jsonb, text)', 'execute'),
  'authenticated CANNOT execute upload_queue_llm_update (service-role only)'
);

-- ─────────────────────────────────────────────────────────────────────
-- 6b. Wave A — project_coa_pf_set RPC existence + SECURITY DEFINER +
--     grant. Admin-only per Sandra's tight scoping; the function's own
--     assert_role('admin') is the actual gate, but the grant + secdef
--     shape is checked here so accidental SECURITY INVOKER / public
--     execute drift can't slip through.
-- ─────────────────────────────────────────────────────────────────────
select has_function('projectcontrols', 'project_coa_pf_set',
  array['uuid', 'uuid', 'numeric'],
  'project_coa_pf_set exists');
select is(
  (select prosecdef from pg_proc
     where oid = 'projectcontrols.project_coa_pf_set(uuid, uuid, numeric)'::regprocedure),
  true,
  'project_coa_pf_set is SECURITY DEFINER'
);
select ok(
  has_function_privilege('authenticated', 'projectcontrols.project_coa_pf_set(uuid, uuid, numeric)', 'execute'),
  'authenticated can execute project_coa_pf_set (admin gate inside the body)'
);

-- ─────────────────────────────────────────────────────────────────────
-- 7. A20 Wave 2 — llm_invocation_log table shape.
--    The async LLM scan pre-INSERTs a row before calling Anthropic so
--    concurrent submissions are counted toward the per-user rate limit.
--    The shape feeds (a) the rate-limit count query, (b) admin cost
--    audits. Any column drift here breaks the queue-llm-check edge fn.
-- ─────────────────────────────────────────────────────────────────────
select has_table('projectcontrols', 'llm_invocation_log', 'llm_invocation_log table exists');
select has_column('projectcontrols', 'llm_invocation_log', 'tenant_id', 'llm_invocation_log has tenant_id');
select has_column('projectcontrols', 'llm_invocation_log', 'user_id', 'llm_invocation_log has user_id');
select has_column('projectcontrols', 'llm_invocation_log', 'queue_id', 'llm_invocation_log has queue_id');
select has_column('projectcontrols', 'llm_invocation_log', 'invoked_at', 'llm_invocation_log has invoked_at');
select has_column('projectcontrols', 'llm_invocation_log', 'ok', 'llm_invocation_log has ok');

-- ─────────────────────────────────────────────────────────────────────
-- 8. CO routing — project_co_reviewers table + setter RPC + the new
--    assigned_pc_reviewer_id / assigned_pm_id columns on change_orders.
--    These power Sandra's "submitter picks the reviewer" workflow so
--    each CO routes to a specific person rather than broadcasting to
--    every role-holder.
-- ─────────────────────────────────────────────────────────────────────
select has_table('projectcontrols', 'project_co_reviewers', 'project_co_reviewers table exists');
select has_column('projectcontrols', 'project_co_reviewers', 'pc_reviewer_id',
  'project_co_reviewers has pc_reviewer_id');
select has_column('projectcontrols', 'project_co_reviewers', 'pm_id',
  'project_co_reviewers has pm_id');
select has_column('projectcontrols', 'change_orders', 'assigned_pc_reviewer_id',
  'change_orders has assigned_pc_reviewer_id');
select has_column('projectcontrols', 'change_orders', 'assigned_pm_id',
  'change_orders has assigned_pm_id');
select has_function('projectcontrols', 'project_co_reviewer_set',
  array['uuid', 'uuid', 'uuid', 'uuid'],
  'project_co_reviewer_set exists');

select * from finish();

rollback;
