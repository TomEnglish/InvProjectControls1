-- Phase 1.3: project_members table.
--
-- Mirrors ProgressTracker's per-project membership pattern. Anchors the
-- "admin restricted to their projects" rule: project-scoped writes by
-- non-super_admin roles must have a matching project_members row.
--
-- super_admin and tenant-wide RPCs bypass this check (see is_super_admin
-- in role_helpers_v2). Read access is still tenant-wide via existing
-- _tenant_read policies.

create table projectcontrols.project_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  user_id uuid not null references projectcontrols.app_users(id) on delete cascade,
  -- Effective role within this project. May differ from app_users.role; e.g.
  -- a tenant-level 'editor' could be 'pm' on one specific project.
  project_role projectcontrols.user_role not null default 'viewer',
  added_by uuid references projectcontrols.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (project_id, user_id)
);

create index on projectcontrols.project_members(tenant_id);
create index on projectcontrols.project_members(project_id);
create index on projectcontrols.project_members(user_id);

alter table projectcontrols.project_members enable row level security;

create or replace function projectcontrols.is_project_member(
  p_project_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = projectcontrols, auth
as $$
  select exists (
    select 1
    from projectcontrols.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = p_user_id
  )
$$;

revoke all on function projectcontrols.is_project_member(uuid, uuid) from public;
grant execute on function projectcontrols.is_project_member(uuid, uuid) to authenticated;

-- Read: anyone in the tenant can see who's a member of which project.
create policy "pm_tenant_read" on projectcontrols.project_members
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

-- Write: super_admin can manage anyone; admin can manage members of projects
-- they themselves belong to (so a "local admin" can manage their own project
-- but not someone else's). The `using` clause restricts UPDATE/DELETE; the
-- `with check` restricts INSERT/UPDATE.
create policy "pm_admin_write" on projectcontrols.project_members
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and (
      projectcontrols.current_user_role() = 'super_admin'
      or (
        projectcontrols.current_user_role() = 'admin'
        and projectcontrols.is_project_member(project_members.project_id, auth.uid())
      )
    )
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and (
      projectcontrols.current_user_role() = 'super_admin'
      or (
        projectcontrols.current_user_role() = 'admin'
        and projectcontrols.is_project_member(project_members.project_id, auth.uid())
        and project_role not in ('admin', 'super_admin')
      )
    )
  );

-- RPCs for managing project membership. Mirrors ProgressTracker's
-- admin_*_project_member surface so a unified frontend can call one set.

create or replace function projectcontrols.project_member_add(
  p_project_id uuid,
  p_user_id uuid,
  p_project_role projectcontrols.user_role default 'viewer'
)
returns uuid
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  caller_role projectcontrols.user_role := projectcontrols.current_user_role();
  new_id uuid;
begin
  -- super_admin can act on any project; admin must already be a member.
  if caller_role = 'super_admin' then
    null;
  elsif caller_role = 'admin' then
    if not exists (
      select 1 from projectcontrols.project_members
      where project_id = p_project_id and user_id = auth.uid()
    ) then
      raise exception 'admin not a member of project %', p_project_id using errcode = '42501';
    end if;
  else
    raise exception 'insufficient role' using errcode = '42501';
  end if;

  -- admin cannot grant admin or super_admin project_role.
  if caller_role = 'admin' and p_project_role in ('admin', 'super_admin') then
    raise exception 'admin cannot grant role %', p_project_role using errcode = '42501';
  end if;

  -- Target user must exist in the same tenant.
  if not exists (
    select 1 from projectcontrols.app_users
    where id = p_user_id and tenant_id = tid
  ) then
    raise exception 'user not in tenant' using errcode = 'P0001';
  end if;

  insert into projectcontrols.project_members (tenant_id, project_id, user_id, project_role, added_by)
  values (tid, p_project_id, p_user_id, p_project_role, auth.uid())
  on conflict (project_id, user_id) do update
    set project_role = excluded.project_role,
        updated_at = now()
  returning id into new_id;

  perform projectcontrols.write_audit_log(
    'project_members', new_id, 'add',
    null,
    jsonb_build_object('project_id', p_project_id, 'user_id', p_user_id, 'project_role', p_project_role)
  );

  return new_id;
end
$$;

revoke all on function projectcontrols.project_member_add(uuid, uuid, projectcontrols.user_role) from public;
grant execute on function projectcontrols.project_member_add(uuid, uuid, projectcontrols.user_role) to authenticated;

create or replace function projectcontrols.project_member_set_role(
  p_project_id uuid,
  p_user_id uuid,
  p_project_role projectcontrols.user_role
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  caller_role projectcontrols.user_role := projectcontrols.current_user_role();
  before jsonb;
begin
  if caller_role = 'super_admin' then
    null;
  elsif caller_role = 'admin' then
    if not exists (
      select 1 from projectcontrols.project_members
      where project_id = p_project_id and user_id = auth.uid()
    ) then
      raise exception 'admin not a member of project %', p_project_id using errcode = '42501';
    end if;
    if p_project_role in ('admin', 'super_admin') then
      raise exception 'admin cannot grant role %', p_project_role using errcode = '42501';
    end if;
  else
    raise exception 'insufficient role' using errcode = '42501';
  end if;

  select to_jsonb(m) into before
  from projectcontrols.project_members m
  where m.project_id = p_project_id and m.user_id = p_user_id and m.tenant_id = tid;

  if before is null then
    raise exception 'membership not found' using errcode = 'P0001';
  end if;

  update projectcontrols.project_members
     set project_role = p_project_role, updated_at = now()
   where project_id = p_project_id and user_id = p_user_id and tenant_id = tid;

  perform projectcontrols.write_audit_log(
    'project_members', (before->>'id')::uuid, 'set_role',
    before,
    jsonb_build_object('project_role', p_project_role)
  );
end
$$;

revoke all on function projectcontrols.project_member_set_role(uuid, uuid, projectcontrols.user_role) from public;
grant execute on function projectcontrols.project_member_set_role(uuid, uuid, projectcontrols.user_role) to authenticated;

create or replace function projectcontrols.project_member_remove(
  p_project_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  caller_role projectcontrols.user_role := projectcontrols.current_user_role();
  before jsonb;
begin
  if caller_role = 'super_admin' then
    null;
  elsif caller_role = 'admin' then
    if not exists (
      select 1 from projectcontrols.project_members
      where project_id = p_project_id and user_id = auth.uid()
    ) then
      raise exception 'admin not a member of project %', p_project_id using errcode = '42501';
    end if;
  else
    raise exception 'insufficient role' using errcode = '42501';
  end if;

  -- Don't let admin remove themselves from their own project (lockout
  -- prevention). super_admin can.
  if p_user_id = auth.uid() and caller_role <> 'super_admin' then
    raise exception 'cannot remove self from project' using errcode = '22023';
  end if;

  select to_jsonb(m) into before
  from projectcontrols.project_members m
  where m.project_id = p_project_id and m.user_id = p_user_id and m.tenant_id = tid;

  if before is null then
    raise exception 'membership not found' using errcode = 'P0001';
  end if;

  delete from projectcontrols.project_members
   where project_id = p_project_id and user_id = p_user_id and tenant_id = tid;

  perform projectcontrols.write_audit_log(
    'project_members', (before->>'id')::uuid, 'remove',
    before,
    null
  );
end
$$;

revoke all on function projectcontrols.project_member_remove(uuid, uuid) from public;
grant execute on function projectcontrols.project_member_remove(uuid, uuid) to authenticated;

create or replace function projectcontrols.project_member_list(p_project_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  project_role projectcontrols.user_role,
  tenant_role projectcontrols.user_role,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = projectcontrols, auth
as $$
  select m.user_id, u.email, u.display_name, m.project_role, u.role, m.created_at
  from projectcontrols.project_members m
  join projectcontrols.app_users u on u.id = m.user_id
  where m.tenant_id = projectcontrols.current_tenant_id()
    and m.project_id = p_project_id
    and (
      projectcontrols.current_user_role() = 'super_admin'
      or exists (
        select 1 from projectcontrols.project_members self
        where self.project_id = p_project_id and self.user_id = auth.uid()
      )
    )
$$;

revoke all on function projectcontrols.project_member_list(uuid) from public;
grant execute on function projectcontrols.project_member_list(uuid) to authenticated;
