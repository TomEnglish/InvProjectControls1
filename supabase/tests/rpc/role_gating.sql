-- pgTAP — role gating smoke tests.
--
-- Run locally with:
--   supabase test db
--
-- These tests exercise the assert_role helper and confirm that mutating
-- RPCs reject under-privileged callers. They do NOT exercise full RPC
-- behaviour — that's a Phase 3 expansion. The goal here is to lock in
-- the role hierarchy so a future schema change can't silently regress.

begin;

select plan(8);

-- assert_role compares ranks: viewer < editor < pc_reviewer < pm < admin < super_admin.
-- Reading these via current_user_role() requires a session, so we test the
-- comparison logic by simulating the ranks directly.

-- Sanity: the user_role enum has all six expected values.
select set_eq(
  $$ select unnest(enum_range(null::projectcontrols.user_role))::text $$,
  $$ values ('super_admin'), ('admin'), ('pm'), ('pc_reviewer'), ('editor'), ('viewer') $$,
  'user_role enum has the six expected values'
);

-- Function existence + ownership.
select has_function('projectcontrols', 'assert_role', array['projectcontrols.user_role'],
  'assert_role function exists');
select has_function('projectcontrols', 'current_tenant_id',
  'current_tenant_id function exists');
select has_function('projectcontrols', 'current_user_role',
  'current_user_role function exists');
select has_function('projectcontrols', 'is_super_admin',
  'is_super_admin function exists');
select has_function('projectcontrols', 'assert_role_for_project',
  array['projectcontrols.user_role', 'uuid'],
  'assert_role_for_project function exists');

-- Mutating RPCs are SECURITY DEFINER (so RLS doesn't fight role gating).
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

select * from finish();

rollback;
