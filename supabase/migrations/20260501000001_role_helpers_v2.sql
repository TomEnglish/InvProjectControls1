-- Phase 1.2: Rebuild assert_role to rank super_admin above admin, and add
-- assert_role_for_project for project-scoped checks.
--
-- super_admin > admin > pm > pc_reviewer > editor > viewer.
--
-- assert_role_for_project enforces the user-stated rule: admins are restricted
-- to the projects they belong to (via projectcontrols.project_members, created
-- in the next migration); super_admin bypasses that membership check. This
-- function is created here but not called by any RPC yet — call sites move
-- over in a later migration once project_members has been backfilled.

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
    when 'super_admin' then 6
  end;
  min_rank := case min_role
    when 'viewer' then 1
    when 'editor' then 2
    when 'pc_reviewer' then 3
    when 'pm' then 4
    when 'admin' then 5
    when 'super_admin' then 6
  end;
  if rank < min_rank then
    raise exception 'insufficient role: % < %', r, min_role using errcode = '42501';
  end if;
end
$$;

create or replace function projectcontrols.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = projectcontrols, auth
as $$
  select projectcontrols.current_user_role() = 'super_admin'
$$;

revoke all on function projectcontrols.is_super_admin() from public;
grant execute on function projectcontrols.is_super_admin() to authenticated;

-- assert_role_for_project: enforces both the global rank check AND project
-- membership. super_admin bypasses membership entirely. For all other roles,
-- the caller must have a projectcontrols.project_members row for p_project_id.
-- Note: project_members is created in 20260501000002_project_members.sql; this
-- function references it but Postgres resolves the table at call time, so
-- creating it here is fine.

create or replace function projectcontrols.assert_role_for_project(
  min_role projectcontrols.user_role,
  p_project_id uuid
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  r projectcontrols.user_role := projectcontrols.current_user_role();
begin
  perform projectcontrols.assert_role(min_role);

  if r = 'super_admin' then
    return;
  end if;

  if not exists (
    select 1
    from projectcontrols.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.tenant_id = projectcontrols.current_tenant_id()
  ) then
    raise exception 'not a member of project %', p_project_id using errcode = '42501';
  end if;
end
$$;

revoke all on function projectcontrols.assert_role_for_project(projectcontrols.user_role, uuid) from public;
grant execute on function projectcontrols.assert_role_for_project(projectcontrols.user_role, uuid) to authenticated;
