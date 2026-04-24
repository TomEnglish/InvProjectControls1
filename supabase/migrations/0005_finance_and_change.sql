-- 0005_finance_and_change.sql
-- baselines, progress_periods, actual_hours, change_orders, change_order_events

create table projectcontrols.baselines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  locked_at timestamptz not null default now(),
  locked_by uuid references projectcontrols.app_users(id) on delete set null,
  snapshot jsonb not null,
  constraint baselines_unique unique (project_id, locked_at)
);
create index on projectcontrols.baselines(tenant_id);
alter table projectcontrols.baselines enable row level security;

create table projectcontrols.progress_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  period_number int not null,
  start_date date not null,
  end_date date not null,
  locked_at timestamptz,
  bcws_hrs numeric(14, 3),
  bcwp_hrs numeric(14, 3),
  acwp_hrs numeric(14, 3),
  constraint pp_unique unique (project_id, period_number),
  constraint pp_date_order check (end_date >= start_date)
);
create index on projectcontrols.progress_periods(tenant_id);
create index on projectcontrols.progress_periods(project_id);
alter table projectcontrols.progress_periods enable row level security;

create table projectcontrols.actual_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  period_id uuid references projectcontrols.progress_periods(id) on delete set null,
  discipline_id uuid references projectcontrols.project_disciplines(id) on delete set null,
  record_id uuid references projectcontrols.audit_records(id) on delete set null,
  hours numeric(14, 3) not null check (hours >= 0),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);
create index on projectcontrols.actual_hours(tenant_id);
create index on projectcontrols.actual_hours(project_id);
create index on projectcontrols.actual_hours(period_id);
alter table projectcontrols.actual_hours enable row level security;

create table projectcontrols.change_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  co_number text not null,
  date date not null default current_date,
  discipline_id uuid references projectcontrols.project_disciplines(id) on delete set null,
  type projectcontrols.co_type not null,
  description text not null,
  qty_change numeric(14, 3) not null,
  uom projectcontrols.uom_code not null,
  hrs_impact numeric(14, 3) not null default 0,
  status projectcontrols.co_status not null default 'pending',
  requested_by text not null,
  created_by uuid references projectcontrols.app_users(id) on delete set null,
  pc_reviewed_by uuid references projectcontrols.app_users(id) on delete set null,
  pc_reviewed_at timestamptz,
  approved_by uuid references projectcontrols.app_users(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint co_unique unique (project_id, co_number)
);
create index on projectcontrols.change_orders(tenant_id);
create index on projectcontrols.change_orders(project_id);
create index on projectcontrols.change_orders(status);
alter table projectcontrols.change_orders enable row level security;

create table projectcontrols.change_order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  co_id uuid not null references projectcontrols.change_orders(id) on delete cascade,
  event text not null,
  actor_id uuid references projectcontrols.app_users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index on projectcontrols.change_order_events(tenant_id);
create index on projectcontrols.change_order_events(co_id);
alter table projectcontrols.change_order_events enable row level security;

create policy "baselines_tenant_read" on projectcontrols.baselines
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
create policy "baselines_admin_write" on projectcontrols.baselines
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin')
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() = 'admin');

create policy "pp_tenant_read" on projectcontrols.progress_periods
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
create policy "pp_admin_write" on projectcontrols.progress_periods
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer'));

create policy "ah_tenant_read" on projectcontrols.actual_hours
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
create policy "ah_editor_write" on projectcontrols.actual_hours
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor'));

create policy "co_tenant_read" on projectcontrols.change_orders
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
create policy "co_editor_draft" on projectcontrols.change_orders
  for insert to authenticated
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor')
    and status in ('draft', 'pending')
  );

create policy "co_events_tenant_read" on projectcontrols.change_order_events
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
