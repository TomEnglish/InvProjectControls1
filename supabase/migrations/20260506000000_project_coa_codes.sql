-- Per-project COA scoping. The COA library lives at the tenant level, but
-- each project only uses a subset; Sandra's UAT feedback called out that
-- selecting which codes are "in scope for this project" should be a
-- project-setup action, not a global setting.
--
-- Design choice: separate join table (project_coa_codes) rather than a
-- denormalized array column on coa_codes. Reasons:
--   * RLS is per-row, so admin writes can be project-scoped via
--     assert_role_for_project without giving admins write access to
--     tenant-wide coa_codes rows.
--   * Adding/removing a project's pick is a single insert/delete; an array
--     update would require rewriting the whole array under contention.
--   * Future audit-log entries are clean per-pick.

create table projectcontrols.project_coa_codes (
  tenant_id    uuid not null references projectcontrols.tenants(id)    on delete restrict,
  project_id   uuid not null references projectcontrols.projects(id)   on delete cascade,
  coa_code_id  uuid not null references projectcontrols.coa_codes(id)  on delete cascade,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references projectcontrols.app_users(id) on delete set null,
  primary key (project_id, coa_code_id)
);

create index on projectcontrols.project_coa_codes(tenant_id);
create index on projectcontrols.project_coa_codes(project_id);
create index on projectcontrols.project_coa_codes(coa_code_id);

alter table projectcontrols.project_coa_codes enable row level security;

-- Read: tenant-scoped. Anyone authenticated in the tenant can see which
-- codes are picked for any project they have visibility on.
create policy "pcc_tenant_read" on projectcontrols.project_coa_codes
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

-- Write: admin or super_admin in the tenant. Admins additionally must be
-- members of the project (project-scoped admin model) — super_admin
-- bypasses membership.
create policy "pcc_admin_write" on projectcontrols.project_coa_codes
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and (
      projectcontrols.current_user_role() = 'super_admin'
      or (
        projectcontrols.current_user_role() = 'admin'
        and exists (
          select 1 from projectcontrols.project_members pm
          where pm.project_id = project_coa_codes.project_id
            and pm.user_id = auth.uid()
            and pm.tenant_id = projectcontrols.current_tenant_id()
        )
      )
    )
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and (
      projectcontrols.current_user_role() = 'super_admin'
      or (
        projectcontrols.current_user_role() = 'admin'
        and exists (
          select 1 from projectcontrols.project_members pm
          where pm.project_id = project_coa_codes.project_id
            and pm.user_id = auth.uid()
            and pm.tenant_id = projectcontrols.current_tenant_id()
        )
      )
    )
  );

-- Tenant-consistency guard: verify project_id and coa_code_id both belong
-- to the row's tenant_id. RLS WITH CHECK confirms the row's tenant_id
-- matches current_tenant_id but doesn't cross-validate that the referenced
-- project and coa_code belong to that same tenant — a super_admin (or
-- service-role caller) could otherwise plant cross-tenant rows. This
-- trigger closes that hole.
create or replace function projectcontrols.pcc_enforce_tenant_consistency()
returns trigger
language plpgsql
as $$
declare
  proj_tenant uuid;
  code_tenant uuid;
begin
  select tenant_id into proj_tenant
  from projectcontrols.projects where id = new.project_id;
  if proj_tenant is null then
    raise exception 'project not found' using errcode = 'P0001';
  end if;
  if proj_tenant <> new.tenant_id then
    raise exception 'tenant mismatch: project belongs to tenant %, row claims %', proj_tenant, new.tenant_id
      using errcode = '42501';
  end if;

  select tenant_id into code_tenant
  from projectcontrols.coa_codes where id = new.coa_code_id;
  if code_tenant is null then
    raise exception 'coa_code not found' using errcode = 'P0001';
  end if;
  if code_tenant <> new.tenant_id then
    raise exception 'tenant mismatch: coa_code belongs to tenant %, row claims %', code_tenant, new.tenant_id
      using errcode = '42501';
  end if;

  return new;
end
$$;

create trigger pcc_tenant_consistency
before insert or update on projectcontrols.project_coa_codes
for each row execute function projectcontrols.pcc_enforce_tenant_consistency();
