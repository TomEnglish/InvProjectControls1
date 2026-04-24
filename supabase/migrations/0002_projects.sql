-- 0002_projects.sql
-- projects + project_disciplines in the projectcontrols schema.

create table projectcontrols.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_code text not null,
  name text not null,
  client text not null,
  status projectcontrols.project_status not null default 'draft',
  start_date date not null,
  end_date date not null,
  manager_id uuid references projectcontrols.app_users(id) on delete set null,
  baseline_locked_at timestamptz,
  baseline_locked_by uuid references projectcontrols.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_code_unique unique (tenant_id, project_code),
  constraint projects_date_order check (end_date >= start_date)
);
create index on projectcontrols.projects(tenant_id);
create index on projectcontrols.projects(status);
alter table projectcontrols.projects enable row level security;

create table projectcontrols.project_disciplines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  discipline_code projectcontrols.discipline_code not null,
  display_name text not null,
  roc_template_id uuid,  -- FK added after roc_templates exists
  budget_hrs numeric(14, 3) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pd_unique unique (project_id, discipline_code)
);
create index on projectcontrols.project_disciplines(tenant_id);
create index on projectcontrols.project_disciplines(project_id);
alter table projectcontrols.project_disciplines enable row level security;

create policy "projects_tenant_read" on projectcontrols.projects
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

create policy "projects_admin_write" on projectcontrols.projects
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm'));

create policy "pd_tenant_read" on projectcontrols.project_disciplines
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

create policy "pd_admin_write" on projectcontrols.project_disciplines
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm'));
