-- 0000_schema.sql
-- Create the dedicated `projectcontrols` Postgres schema. All ProjectControls
-- domain tables, types, views, and RPCs live here — isolated from the
-- ProgressTracker app that shares this Supabase project.

create schema if not exists projectcontrols;

-- Expose the schema to the API roles. RLS enforces per-row access; these grants
-- only open the door for authenticated callers to attempt reads/writes.
grant usage on schema projectcontrols to anon, authenticated, service_role;

-- Future tables / sequences / functions inherit these defaults.
alter default privileges in schema projectcontrols
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema projectcontrols
  grant usage on sequences to authenticated;
alter default privileges in schema projectcontrols
  grant execute on functions to authenticated;

-- service_role bypasses RLS; keep it unconstrained.
alter default privileges in schema projectcontrols
  grant all on tables to service_role;
alter default privileges in schema projectcontrols
  grant all on sequences to service_role;
alter default privileges in schema projectcontrols
  grant all on functions to service_role;
