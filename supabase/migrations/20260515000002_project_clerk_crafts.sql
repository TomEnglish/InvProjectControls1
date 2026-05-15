-- A20 Wave 1 — project_clerk_crafts: which (project, craft) pairs a clerk
-- is allowed to submit upload-queue entries for.
--
-- Sandra's UAT feedback (app_review_todo.md A19): "each craft has its own
-- clerk (civil, pipe, electrical) but they all share the same upload entry
-- point." Some clerks cover multiple crafts on one project; some cover one
-- craft across multiple projects. Modelling this as a many-to-many join
-- table on (project, user, craft) handles both cases without forcing
-- per-craft user accounts.
--
-- Crucially: every clerk_crafts row implies a project_members row for
-- (project, user). The clerk_crafts_set RPC writes both atomically — see
-- the function body below. Without the project_members coupling the clerk
-- can't even see their assigned project in the top-bar picker (the picker
-- filters by project_members).

create table projectcontrols.project_clerk_crafts (
  tenant_id   uuid not null references projectcontrols.tenants(id) on delete cascade,
  project_id  uuid not null,
  user_id     uuid not null,
  craft       projectcontrols.discipline_code not null,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id, craft),
  foreign key (project_id, tenant_id)
    references projectcontrols.projects(id, tenant_id) on delete cascade,
  foreign key (user_id, tenant_id)
    references projectcontrols.app_users(id, tenant_id) on delete cascade
);

create index on projectcontrols.project_clerk_crafts(tenant_id);
create index on projectcontrols.project_clerk_crafts(user_id);
create index on projectcontrols.project_clerk_crafts(project_id);

alter table projectcontrols.project_clerk_crafts enable row level security;

-- Read: tenant-wide so PMs / auditors can see who's permitted on what.
-- Clerks see their own rows by extension of the same tenant gate.
create policy "pcc_tenant_read" on projectcontrols.project_clerk_crafts
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

-- No direct INSERT/UPDATE/DELETE policy — all writes go through
-- clerk_crafts_set (SECURITY DEFINER), which performs role assertions and
-- the project_members coupling in one transaction.

create or replace function projectcontrols.clerk_crafts_set(
  p_project_id uuid,
  p_user_id    uuid,
  p_crafts     projectcontrols.discipline_code[]
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  caller_role projectcontrols.user_role := projectcontrols.current_user_role();
  target_role projectcontrols.user_role;
  before_json jsonb;
  after_json jsonb;
begin
  -- Only admin / pm / super_admin can grant clerk permissions. admin must
  -- already be a member of the project (mirrors project_member_add).
  if caller_role = 'super_admin' then
    null;
  elsif caller_role in ('admin', 'pm') then
    if not exists (
      select 1 from projectcontrols.project_members
      where project_id = p_project_id
        and user_id = auth.uid()
        and tenant_id = tid
    ) then
      raise exception 'caller not a member of project %', p_project_id using errcode = '42501';
    end if;
  else
    raise exception 'insufficient role' using errcode = '42501';
  end if;

  -- Project must be in tenant.
  if not exists (
    select 1 from projectcontrols.projects
    where id = p_project_id and tenant_id = tid
  ) then
    raise exception 'project not in tenant' using errcode = 'P0001';
  end if;

  -- Target user must be in tenant and must be a clerk. Granting craft
  -- permissions to non-clerks is a category error — block it loudly so
  -- the admin UI can't silently mis-assign.
  select role into target_role
  from projectcontrols.app_users
  where id = p_user_id and tenant_id = tid;
  if target_role is null then
    raise exception 'user not in tenant' using errcode = 'P0001';
  end if;
  if target_role <> 'clerk' then
    raise exception 'target user role is % (must be clerk)', target_role using errcode = '42501';
  end if;

  -- Capture before-state for audit.
  select jsonb_agg(craft order by craft) into before_json
  from projectcontrols.project_clerk_crafts
  where project_id = p_project_id and user_id = p_user_id;

  -- Atomic replace: wipe and reinsert. Same project_members coupling is
  -- ensured below — a clerk with zero crafts also has no project_members
  -- row (handled by the membership branch at the end of the function).
  delete from projectcontrols.project_clerk_crafts
   where project_id = p_project_id and user_id = p_user_id;

  if p_crafts is not null and array_length(p_crafts, 1) > 0 then
    insert into projectcontrols.project_clerk_crafts (tenant_id, project_id, user_id, craft)
    select tid, p_project_id, p_user_id, unnest(p_crafts)
    on conflict do nothing;
  end if;

  -- Project membership coupling. If the clerk now has at least one craft
  -- on this project, ensure a project_members row exists; if they have
  -- zero crafts, remove the membership so they can't see the project at
  -- all. The project_role stored on project_members is 'viewer' — clerks
  -- get their write surface via project_clerk_crafts (and only on
  -- upload_queue), not via the project_role rank.
  if p_crafts is not null and array_length(p_crafts, 1) > 0 then
    insert into projectcontrols.project_members
      (tenant_id, project_id, user_id, project_role, added_by)
    values (tid, p_project_id, p_user_id, 'viewer', auth.uid())
    on conflict (project_id, user_id) do nothing;
  else
    delete from projectcontrols.project_members
     where project_id = p_project_id and user_id = p_user_id and tenant_id = tid;
  end if;

  -- After-state for audit.
  select jsonb_agg(craft order by craft) into after_json
  from projectcontrols.project_clerk_crafts
  where project_id = p_project_id and user_id = p_user_id;

  perform projectcontrols.write_audit_log(
    'project_clerk_crafts',
    null,
    'set',
    jsonb_build_object('project_id', p_project_id, 'user_id', p_user_id, 'crafts', before_json),
    jsonb_build_object('project_id', p_project_id, 'user_id', p_user_id, 'crafts', after_json)
  );
end
$$;

revoke all on function projectcontrols.clerk_crafts_set(uuid, uuid, projectcontrols.discipline_code[]) from public;
grant execute on function projectcontrols.clerk_crafts_set(uuid, uuid, projectcontrols.discipline_code[]) to authenticated;
