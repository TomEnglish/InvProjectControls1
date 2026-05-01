-- Phase 2.1: Canonical progress tables for the merged ProjectControls +
-- ProgressTracker product. These are destination tables for upcoming
-- ProgressTracker backfill and UI port work.

alter table projectcontrols.projects
  add column if not exists qty_rollup_mode text not null default 'hours_weighted'
    check (qty_rollup_mode in ('hours_weighted', 'equal', 'custom'));

create table projectcontrols.iwps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  discipline_id uuid references projectcontrols.project_disciplines(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iwps_unique unique (project_id, name)
);
create index on projectcontrols.iwps(tenant_id);
create index on projectcontrols.iwps(project_id);
create index on projectcontrols.iwps(discipline_id);
alter table projectcontrols.iwps enable row level security;

create table projectcontrols.progress_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  discipline_id uuid references projectcontrols.project_disciplines(id) on delete set null,
  iwp_id uuid references projectcontrols.iwps(id) on delete set null,
  source_record_id uuid,
  source_type text not null default 'manual',
  source_filename text,
  record_no int,
  source_row int,
  dwg text,
  rev text,
  description text not null,
  uom projectcontrols.uom_code not null default 'EA',
  budget_qty numeric(14, 3),
  actual_qty numeric(14, 3),
  earned_qty numeric(14, 3) generated always as (
    case when budget_qty is null then null else budget_qty * percent_complete / 100.0 end
  ) stored,
  budget_hrs numeric(14, 3) not null default 0 check (budget_hrs >= 0),
  actual_hrs numeric(14, 3) not null default 0 check (actual_hrs >= 0),
  earned_hrs numeric(14, 3) generated always as (budget_hrs * percent_complete / 100.0) stored,
  percent_complete numeric(5, 2) not null default 0 check (percent_complete >= 0 and percent_complete <= 100),
  status projectcontrols.record_status not null default 'active',
  foreman_user_id uuid references projectcontrols.app_users(id) on delete set null,
  foreman_name text,
  attr_type text,
  attr_size text,
  attr_spec text,
  line_area text,
  created_by uuid references projectcontrols.app_users(id) on delete set null,
  updated_by uuid references projectcontrols.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_records_record_no_unique unique (project_id, record_no),
  constraint progress_records_source_unique unique (project_id, source_type, source_record_id)
);
create index on projectcontrols.progress_records(tenant_id);
create index on projectcontrols.progress_records(project_id);
create index on projectcontrols.progress_records(discipline_id);
create index on projectcontrols.progress_records(iwp_id);
create index on projectcontrols.progress_records(project_id, foreman_user_id);
create index on projectcontrols.progress_records(project_id, foreman_name);
create index on projectcontrols.progress_records(project_id, line_area);
alter table projectcontrols.progress_records enable row level security;

create table projectcontrols.progress_record_milestones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  progress_record_id uuid not null references projectcontrols.progress_records(id) on delete cascade,
  roc_milestone_id uuid references projectcontrols.roc_milestones(id) on delete set null,
  seq smallint not null check (seq between 1 and 8),
  label text,
  value numeric(5, 2) not null default 0 check (value >= 0 and value <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references projectcontrols.app_users(id) on delete set null,
  constraint prm_unique unique (progress_record_id, seq)
);
create index on projectcontrols.progress_record_milestones(tenant_id);
create index on projectcontrols.progress_record_milestones(progress_record_id);
alter table projectcontrols.progress_record_milestones enable row level security;

create table projectcontrols.progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  kind text not null default 'weekly' check (kind in ('weekly', 'baseline_first_audit')),
  snapshot_date date not null default current_date,
  week_ending date,
  label text not null,
  total_budget_hrs numeric(14, 3),
  total_earned_hrs numeric(14, 3),
  total_actual_hrs numeric(14, 3),
  cpi numeric(12, 4),
  spi numeric(12, 4),
  composite_pct_qty numeric(8, 4),
  source_filename text,
  uploaded_by uuid references projectcontrols.app_users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index progress_snapshots_one_first_audit_per_project
  on projectcontrols.progress_snapshots(project_id)
  where kind = 'baseline_first_audit';
create index on projectcontrols.progress_snapshots(tenant_id);
create index on projectcontrols.progress_snapshots(project_id);
alter table projectcontrols.progress_snapshots enable row level security;

create table projectcontrols.progress_snapshot_items (
  snapshot_id uuid not null references projectcontrols.progress_snapshots(id) on delete cascade,
  progress_record_id uuid not null references projectcontrols.progress_records(id) on delete restrict,
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  percent_complete numeric(5, 2),
  earned_hrs numeric(14, 3),
  earned_qty numeric(14, 3),
  actual_hrs numeric(14, 3),
  actual_qty numeric(14, 3),
  primary key (snapshot_id, progress_record_id)
);
create index on projectcontrols.progress_snapshot_items(tenant_id);
create index on projectcontrols.progress_snapshot_items(project_id);
create index on projectcontrols.progress_snapshot_items(progress_record_id);
alter table projectcontrols.progress_snapshot_items enable row level security;

create table projectcontrols.project_discipline_weights (
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  discipline_id uuid not null references projectcontrols.project_disciplines(id) on delete cascade,
  weight numeric(8, 6) not null check (weight >= 0 and weight <= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references projectcontrols.app_users(id) on delete set null,
  primary key (project_id, discipline_id)
);
create index on projectcontrols.project_discipline_weights(tenant_id);
alter table projectcontrols.project_discipline_weights enable row level security;

create table projectcontrols.foreman_aliases (
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  name text not null,
  user_id uuid not null references projectcontrols.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references projectcontrols.app_users(id) on delete set null,
  primary key (tenant_id, name)
);
create index on projectcontrols.foreman_aliases(user_id);
alter table projectcontrols.foreman_aliases enable row level security;

create policy "iwps_tenant_read" on projectcontrols.iwps
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "iwps_project_write" on projectcontrols.iwps
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm')
  );

create policy "progress_records_tenant_read" on projectcontrols.progress_records
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "progress_records_editor_write" on projectcontrols.progress_records
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer', 'editor')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer', 'editor')
  );

create policy "prm_tenant_read" on projectcontrols.progress_record_milestones
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "prm_editor_write" on projectcontrols.progress_record_milestones
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer', 'editor')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer', 'editor')
  );

create policy "progress_snapshots_tenant_read" on projectcontrols.progress_snapshots
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "progress_snapshots_pm_write" on projectcontrols.progress_snapshots
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  );

create policy "psi_tenant_read" on projectcontrols.progress_snapshot_items
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "psi_pm_write" on projectcontrols.progress_snapshot_items
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  );

create policy "pdw_tenant_read" on projectcontrols.project_discipline_weights
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "pdw_admin_write" on projectcontrols.project_discipline_weights
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin')
  );

create policy "foreman_aliases_tenant_read" on projectcontrols.foreman_aliases
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());
create policy "foreman_aliases_admin_write" on projectcontrols.foreman_aliases
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin')
  );
