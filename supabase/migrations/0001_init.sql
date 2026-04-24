-- 0001_init.sql
-- Extensions, enum types, tenant + user model, handle_new_user trigger, tenancy helpers.
-- All objects live in the `projectcontrols` schema (see 0000_schema.sql).

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================================
-- Enum types
-- ============================================================================
create type projectcontrols.user_role as enum ('admin', 'pm', 'pc_reviewer', 'editor', 'viewer');
create type projectcontrols.project_status as enum ('draft', 'active', 'locked', 'closed');
create type projectcontrols.record_status as enum ('draft', 'active', 'complete', 'void');
create type projectcontrols.co_status as enum ('draft', 'pending', 'pc_reviewed', 'approved', 'rejected');
create type projectcontrols.co_type as enum ('scope_add', 'scope_reduction', 'ifc_update', 'design_change', 'client_directive');
create type projectcontrols.discipline_code as enum ('CIVIL', 'PIPE', 'STEEL', 'ELEC', 'MECH', 'INST', 'SITE');
create type projectcontrols.uom_code as enum ('LF', 'CY', 'EA', 'TONS', 'SF', 'HR', 'LS');
create type projectcontrols.nde_status as enum ('pending', 'complete', 'failed', 'n/a');

-- ============================================================================
-- tenants
-- ============================================================================
create table projectcontrols.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table projectcontrols.tenants enable row level security;

-- ============================================================================
-- app_users (bridged from auth.users — our own per-app registry, isolated from
-- ProgressTracker's public.app_users)
-- ============================================================================
create table projectcontrols.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  email text not null,
  display_name text,
  role projectcontrols.user_role not null default 'viewer',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on projectcontrols.app_users(tenant_id);
create unique index on projectcontrols.app_users(lower(email));
alter table projectcontrols.app_users enable row level security;

-- ============================================================================
-- Tenancy + role helpers
-- ============================================================================
create or replace function projectcontrols.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = projectcontrols, auth
as $$
  select tenant_id from projectcontrols.app_users where id = auth.uid()
$$;

create or replace function projectcontrols.current_user_role()
returns projectcontrols.user_role
language sql
stable
security definer
set search_path = projectcontrols, auth
as $$
  select role from projectcontrols.app_users where id = auth.uid()
$$;

create or replace function projectcontrols.assert_role(min_role projectcontrols.user_role)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  r projectcontrols.user_role := projectcontrols.current_user_role();
  rank int;
  min_rank int;
begin
  if r is null then
    raise exception 'auth required' using errcode = '42501';
  end if;
  rank := case r
    when 'viewer' then 1
    when 'editor' then 2
    when 'pc_reviewer' then 3
    when 'pm' then 4
    when 'admin' then 5
  end;
  min_rank := case min_role
    when 'viewer' then 1
    when 'editor' then 2
    when 'pc_reviewer' then 3
    when 'pm' then 4
    when 'admin' then 5
  end;
  if rank < min_rank then
    raise exception 'insufficient role: % < %', r, min_role using errcode = '42501';
  end if;
end
$$;

revoke all on function projectcontrols.current_tenant_id() from public;
revoke all on function projectcontrols.current_user_role() from public;
revoke all on function projectcontrols.assert_role(projectcontrols.user_role) from public;
grant execute on function projectcontrols.current_tenant_id() to authenticated;
grant execute on function projectcontrols.current_user_role() to authenticated;

-- ============================================================================
-- handle_new_user trigger — bridges auth.users → projectcontrols.app_users
-- Only fires for users tagged with tenant_id in their user_metadata, so
-- ProgressTracker signups don't land here.
-- Trigger name is prefixed to distinguish from ProgressTracker's trigger
-- on the same auth.users table.
-- ============================================================================
create or replace function projectcontrols.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid;
  app text;
  role_claim text;
  target_role projectcontrols.user_role;
begin
  app := new.raw_user_meta_data->>'app';
  tid := (new.raw_user_meta_data->>'tenant_id')::uuid;

  -- Only create app_users row when this signup is tagged for ProjectControls.
  if app is distinct from 'projectcontrols' or tid is null then
    return new;
  end if;

  role_claim := coalesce(new.raw_user_meta_data->>'role', 'viewer');
  begin
    target_role := role_claim::projectcontrols.user_role;
  exception when invalid_text_representation then
    target_role := 'viewer';
  end;

  insert into projectcontrols.app_users (id, tenant_id, email, display_name, role, status)
  values (
    new.id,
    tid,
    new.email,
    new.raw_user_meta_data->>'display_name',
    target_role,
    'active'
  )
  on conflict (id) do nothing;

  return new;
end
$$;

drop trigger if exists on_auth_user_created_projectcontrols on auth.users;
create trigger on_auth_user_created_projectcontrols
after insert on auth.users
for each row execute function projectcontrols.handle_new_user();

-- ============================================================================
-- RLS policies
-- ============================================================================
create policy "tenant_read" on projectcontrols.tenants
  for select to authenticated
  using (id = projectcontrols.current_tenant_id());

create policy "users_read_own_tenant" on projectcontrols.app_users
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

create policy "users_admin_write" on projectcontrols.app_users
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin')
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin');
