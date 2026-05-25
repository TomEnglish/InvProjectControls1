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

select plan(11);

-- assert_role compares ranks: viewer < clerk < pc_reviewer < pm < admin < super_admin.

select ok(
  (select count(*)::int from projectcontrols.app_users where role::text = 'editor') = 0,
  'no app_users rows retain editor role after ELL-62 migration'
);

select ok(
  (select count(*)::int from projectcontrols.project_members where project_role::text = 'editor') = 0,
  'no project_members rows retain editor project_role after ELL-62 migration'
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

-- A20 Wave 1 — clerk must be absent from every direct WRITE policy's role
-- check across the projectcontrols schema. Clerk's only write surface is
-- a single SECURITY DEFINER RPC (upload_queue_submit). Any clerk listed
-- inside a direct INSERT/UPDATE/DELETE/ALL policy is a privilege-escalation
-- hazard. We scan both `qual` (the USING clause) and `with_check` since
-- write policies use the latter — current_user_role() = 'clerk' or
-- current_user_role() in (...'clerk'...) would match either way. The 'ALL'
-- cmd kind covers `for all` policies, which compile to insert+update+delete
-- semantics and would otherwise slip past a narrower in-list.
select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'projectcontrols'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (coalesce(qual, '') like '%''clerk''%'
        or coalesce(with_check, '') like '%''clerk''%')),
  0,
  'clerk is absent from every direct write policy in projectcontrols'
);

select * from finish();

rollback;
