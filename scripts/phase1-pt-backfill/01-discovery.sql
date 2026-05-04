-- Phase 1 PT Backfill — Discovery (READ-ONLY)
--
-- Run this against the Supabase project that hosts both apps. Outputs the
-- shape and contents of ProgressTracker's public-schema tables we need to
-- merge into the projectcontrols schema. No writes. Safe to re-run.
--
-- Paste the result back; we'll use it to write 02-dry-run.sql with the
-- actual table/column names and to confirm the super_admin assignment.

\echo '=== public schema tables related to PT ==='
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'app_users', 'project_members', 'projects', 'disciplines',
    'period_snapshots', 'progress_items', 'tenants'
  )
order by table_name;

\echo ''
\echo '=== public.app_users columns ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'app_users'
order by ordinal_position;

\echo ''
\echo '=== public.app_users role distribution ==='
select role, count(*) as n
from public.app_users
group by role
order by role;

\echo ''
\echo '=== public.app_users (anonymized — first 10 rows) ==='
select
  id,
  -- Show only the local-part length + domain to avoid leaking PII in shared output.
  -- Replace with `email` if you want the raw value.
  length(split_part(email, '@', 1)) as local_len,
  split_part(email, '@', 2) as email_domain,
  role,
  tenant_id,
  created_at
from public.app_users
order by created_at asc
limit 10;

\echo ''
\echo '=== Candidate first super_admin (oldest tenant_admin) ==='
-- The oldest tenant_admin is usually the original tenant owner. Confirm
-- before assigning super_admin in dry-run. Returns NULL if no tenant_admin.
select id, email, role, tenant_id, created_at
from public.app_users
where role = 'tenant_admin'
order by created_at asc
limit 5;

\echo ''
\echo '=== public.project_members columns (if exists) ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'project_members'
order by ordinal_position;

\echo ''
\echo '=== public.project_members count + role distribution (if exists) ==='
do $$
declare
  has_table boolean;
  has_role_col boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'project_members'
  ) into has_table;

  if not has_table then
    raise notice 'public.project_members does not exist';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_members'
      and column_name = 'role'
  ) into has_role_col;

  if has_role_col then
    raise notice 'project_members has a role column — see distribution below';
    perform 1; -- placeholder so the DO block stays valid; the actual select is below
  else
    raise notice 'project_members exists but has no role column — checking project_role';
  end if;
end$$;

-- Run separately depending on which column name is used:
-- select role,         count(*) from public.project_members group by role         order by role;
-- select project_role, count(*) from public.project_members group by project_role order by project_role;

\echo ''
\echo '=== public.projects (PT side) ==='
select count(*) as n_projects from public.projects;

\echo ''
\echo '=== Cross-app user overlap (same auth.users.id in both schemas) ==='
select
  count(*) filter (where pt.id is not null and pc.id is not null) as in_both,
  count(*) filter (where pt.id is not null and pc.id is null)     as pt_only,
  count(*) filter (where pt.id is null     and pc.id is not null) as pc_only
from auth.users u
left join public.app_users pt on pt.id = u.id
left join projectcontrols.app_users pc on pc.id = u.id;

\echo ''
\echo '=== Per-user overlap (first 20 rows) ==='
select
  u.id,
  split_part(u.email, '@', 2) as email_domain,
  pt.role as pt_role,
  pc.role as pc_role,
  pt.tenant_id as pt_tenant,
  pc.tenant_id as pc_tenant
from auth.users u
left join public.app_users pt on pt.id = u.id
left join projectcontrols.app_users pc on pc.id = u.id
where pt.id is not null or pc.id is not null
order by u.created_at asc
limit 20;
