-- 0003_libraries.sql
-- coa_codes, roc_templates, roc_milestones

create table projectcontrols.coa_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  prime text not null,
  code text not null,
  description text not null,
  parent text,
  level smallint not null check (level between 1 and 5),
  uom projectcontrols.uom_code not null,
  base_rate numeric(10, 4) not null check (base_rate >= 0),
  pf_adj numeric(6, 4) not null check (pf_adj > 0),
  pf_rate numeric(10, 4) generated always as (round((base_rate * pf_adj)::numeric, 4)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coa_unique unique (tenant_id, code)
);
create index on projectcontrols.coa_codes(tenant_id);
create index on projectcontrols.coa_codes(prime);
alter table projectcontrols.coa_codes enable row level security;

create table projectcontrols.roc_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  discipline_code projectcontrols.discipline_code not null,
  name text not null,
  version smallint not null default 1,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roc_unique unique (tenant_id, discipline_code, version)
);
create index on projectcontrols.roc_templates(tenant_id);
alter table projectcontrols.roc_templates enable row level security;

create table projectcontrols.roc_milestones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  template_id uuid not null references projectcontrols.roc_templates(id) on delete cascade,
  seq smallint not null check (seq between 1 and 8),
  label text not null,
  weight numeric(5, 4) not null check (weight >= 0 and weight <= 1),
  constraint roc_ms_unique unique (template_id, seq)
);
create index on projectcontrols.roc_milestones(tenant_id);
create index on projectcontrols.roc_milestones(template_id);
alter table projectcontrols.roc_milestones enable row level security;

alter table projectcontrols.project_disciplines
  add constraint pd_roc_template_fk
  foreign key (roc_template_id) references projectcontrols.roc_templates(id) on delete set null;

create policy "coa_tenant_read" on projectcontrols.coa_codes
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
create policy "coa_admin_write" on projectcontrols.coa_codes
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin')
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin');

create policy "roc_tmpl_tenant_read" on projectcontrols.roc_templates
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
create policy "roc_tmpl_admin_write" on projectcontrols.roc_templates
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin')
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin');

create policy "roc_ms_tenant_read" on projectcontrols.roc_milestones
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
create policy "roc_ms_admin_write" on projectcontrols.roc_milestones
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin')
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin');
