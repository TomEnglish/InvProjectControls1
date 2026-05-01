-- Phase 1.1: Add `super_admin` to the user_role enum.
--
-- Postgres requires `ALTER TYPE ... ADD VALUE` to commit before the new value
-- can be referenced, so this migration does ONLY the enum extension. The
-- helpers in 20260501000001_role_helpers_v2.sql update assert_role to know
-- about the new value, and the policy migrations after that grant super_admin
-- the same write access admin already has (plus tenant-wide reach).

alter type projectcontrols.user_role add value if not exists 'super_admin';
