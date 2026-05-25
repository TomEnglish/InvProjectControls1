-- ELL-49 — Retire `editor` at the assignment layer (physical enum drop deferred).
--
-- A full enum swap (rename type, recreate without `editor`, rebind every RPC
-- and RLS policy) is not safe on a live schema: Postgres refuses to drop
-- projectcontrols.current_user_role() while policies depend on it, and
-- dozens of other functions bind to projectcontrols.user_role.
--
-- ELL-62 (20260521000000) already:
--   • migrated all editor rows → pc_reviewer
--   • removed editor from RLS role lists
--   • blocked admin_set_user_role(..., 'editor')
--
-- This migration re-applies the CHECK guards idempotently and documents the
-- deprecated enum label. The ghost `editor` value may remain in the type until
-- a future maintenance window can recreate all dependents.

alter table projectcontrols.app_users
  drop constraint if exists app_users_role_not_editor;

alter table projectcontrols.app_users
  add constraint app_users_role_not_editor
  check (role::text <> 'editor');

alter table projectcontrols.project_members
  drop constraint if exists project_members_role_not_editor;

alter table projectcontrols.project_members
  add constraint project_members_role_not_editor
  check (project_role::text <> 'editor');

comment on type projectcontrols.user_role is
  'Role ladder: viewer < clerk < pc_reviewer < pm < admin < super_admin. '
  'Legacy label `editor` is deprecated and blocked at assignment; '
  'physical enum drop deferred due to Postgres dependency graph.';
