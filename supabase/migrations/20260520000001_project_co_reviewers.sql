-- Per-project, per-discipline default reviewers for CO routing.
--
-- When an editor submits a CO under discipline X, the New CO modal
-- pre-fills the "Assigned PC Reviewer" + "Assigned PM" dropdowns from
-- this table. The submitter can override before submitting, and the
-- PC reviewer can override the assigned PM at forward time — but the
-- defaults are the common case so per-discipline specialists don't
-- have to be remembered every time.
--
-- One row per (project, discipline). pc_reviewer_id / pm_id nullable
-- so a project can opt-in incrementally (e.g. set up just civil
-- reviewers first, leave instrumentation null).

create table projectcontrols.project_co_reviewers (
  tenant_id        uuid not null references projectcontrols.tenants(id) on delete cascade,
  project_id       uuid not null,
  discipline_id    uuid not null references projectcontrols.project_disciplines(id) on delete cascade,
  pc_reviewer_id   uuid references projectcontrols.app_users(id) on delete set null,
  pm_id            uuid references projectcontrols.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (project_id, discipline_id),
  foreign key (project_id, tenant_id)
    references projectcontrols.projects(id, tenant_id) on delete cascade
);

create index on projectcontrols.project_co_reviewers(tenant_id);
create index on projectcontrols.project_co_reviewers(pc_reviewer_id) where pc_reviewer_id is not null;
create index on projectcontrols.project_co_reviewers(pm_id) where pm_id is not null;

alter table projectcontrols.project_co_reviewers enable row level security;

-- Read: tenant-wide. Anyone authenticated in the tenant can see the
-- default routing so they understand who their CO will go to.
create policy "pcor_tenant_read" on projectcontrols.project_co_reviewers
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

-- No direct INSERT/UPDATE/DELETE policy — writes go through
-- project_co_reviewer_set, which audit-logs every change and enforces
-- the admin/pm project_member check server-side.

-- ─────────────────────────────────────────────────────────────────────
-- project_co_reviewer_set: admin/pm/super_admin only. Sets (or clears,
-- by passing null) the default reviewer + PM for a project/discipline
-- pair. Audit-logged.
-- ─────────────────────────────────────────────────────────────────────

create or replace function projectcontrols.project_co_reviewer_set(
  p_project_id     uuid,
  p_discipline_id  uuid,
  p_pc_reviewer_id uuid,
  p_pm_id          uuid
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
  -- Only admin/pm/super_admin can set defaults. admin/pm must be a
  -- project_member; super_admin bypasses.
  if caller_role = 'super_admin' then
    null;
  elsif caller_role in ('admin', 'pm') then
    if not exists (
      select 1 from projectcontrols.project_members
      where project_id = p_project_id
        and user_id = auth.uid()
        and tenant_id = tid
    ) then
      raise exception 'caller not a member of project %', p_project_id
        using errcode = '42501';
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

  -- Discipline must belong to this project (FK enforces it but the
  -- explicit check gives a friendlier error than a constraint name).
  if not exists (
    select 1 from projectcontrols.project_disciplines
    where id = p_discipline_id and project_id = p_project_id
  ) then
    raise exception 'discipline not in project' using errcode = 'P0001';
  end if;

  -- If reviewer/pm IDs are provided, validate they're in the tenant
  -- and hold sufficient role. pc_reviewer needs pc_reviewer+; pm
  -- needs pm+. We don't enforce that they're project_members because
  -- a PC reviewer might not need to be added as a project member to
  -- handle COs (the gate is the role + the per-CO assignment).
  if p_pc_reviewer_id is not null then
    if not exists (
      select 1 from projectcontrols.app_users
      where id = p_pc_reviewer_id and tenant_id = tid
        and role in ('pc_reviewer', 'pm', 'admin', 'super_admin')
    ) then
      raise exception 'pc_reviewer_id user not in tenant or insufficient role'
        using errcode = '42501';
    end if;
  end if;
  if p_pm_id is not null then
    if not exists (
      select 1 from projectcontrols.app_users
      where id = p_pm_id and tenant_id = tid
        and role in ('pm', 'admin', 'super_admin')
    ) then
      raise exception 'pm_id user not in tenant or insufficient role'
        using errcode = '42501';
    end if;
  end if;

  -- Capture before-state for audit. Same FOR UPDATE pattern as
  -- project_coa_pf_set so concurrent admin edits don't race.
  select to_jsonb(pcor) into before
  from projectcontrols.project_co_reviewers pcor
  where pcor.project_id = p_project_id
    and pcor.discipline_id = p_discipline_id
  for update;

  insert into projectcontrols.project_co_reviewers
    (tenant_id, project_id, discipline_id, pc_reviewer_id, pm_id)
  values
    (tid, p_project_id, p_discipline_id, p_pc_reviewer_id, p_pm_id)
  on conflict (project_id, discipline_id) do update
    set pc_reviewer_id = excluded.pc_reviewer_id,
        pm_id = excluded.pm_id,
        updated_at = now();

  perform projectcontrols.write_audit_log(
    'project_co_reviewers',
    null,
    'set',
    before,
    jsonb_build_object(
      'project_id', p_project_id,
      'discipline_id', p_discipline_id,
      'pc_reviewer_id', p_pc_reviewer_id,
      'pm_id', p_pm_id
    )
  );
end
$$;

revoke all on function projectcontrols.project_co_reviewer_set(uuid, uuid, uuid, uuid) from public;
grant execute on function projectcontrols.project_co_reviewer_set(uuid, uuid, uuid, uuid) to authenticated;
