-- 0004_audit_records.sql
-- audit_records, audit_record_milestones, v_audit_record_ev (view — matview in §VI
-- deferred until dataset grows past perf budgets in §XVI).

create table projectcontrols.audit_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  project_id uuid not null references projectcontrols.projects(id) on delete cascade,
  discipline_id uuid not null references projectcontrols.project_disciplines(id) on delete restrict,
  coa_code_id uuid not null references projectcontrols.coa_codes(id) on delete restrict,
  rec_no int not null,
  dwg text not null,
  rev text not null,
  description text not null,
  uom projectcontrols.uom_code not null,
  fld_qty numeric(14, 3) not null check (fld_qty >= 0),
  fld_whrs numeric(14, 3) not null check (fld_whrs >= 0),
  status projectcontrols.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references projectcontrols.app_users(id) on delete set null,
  updated_by uuid references projectcontrols.app_users(id) on delete set null,
  constraint ar_unique unique (project_id, rec_no)
);
create index on projectcontrols.audit_records(tenant_id);
create index on projectcontrols.audit_records(project_id);
create index on projectcontrols.audit_records(discipline_id);
create index on projectcontrols.audit_records(coa_code_id);
alter table projectcontrols.audit_records enable row level security;

create table projectcontrols.audit_record_milestones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  record_id uuid not null references projectcontrols.audit_records(id) on delete cascade,
  seq smallint not null check (seq between 1 and 8),
  value numeric(4, 3) not null default 0 check (value >= 0 and value <= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references projectcontrols.app_users(id) on delete set null,
  constraint arm_unique unique (record_id, seq)
);
create index on projectcontrols.audit_record_milestones(tenant_id);
create index on projectcontrols.audit_record_milestones(record_id);
alter table projectcontrols.audit_record_milestones enable row level security;

create or replace function projectcontrols.seed_audit_record_milestones()
returns trigger
language plpgsql
security definer
set search_path = projectcontrols
as $$
begin
  insert into projectcontrols.audit_record_milestones (tenant_id, record_id, seq, value)
  select new.tenant_id, new.id, s, 0
  from generate_series(1, 8) as s
  on conflict do nothing;
  return new;
end
$$;

create trigger audit_records_seed_ms
after insert on projectcontrols.audit_records
for each row execute function projectcontrols.seed_audit_record_milestones();

create view projectcontrols.v_audit_record_ev as
select
  r.id as record_id,
  r.tenant_id,
  r.project_id,
  r.discipline_id,
  r.fld_qty,
  r.fld_whrs,
  coalesce(sum(m.value * rm.weight), 0) as earn_pct,
  r.fld_qty * coalesce(sum(m.value * rm.weight), 0) as ern_qty,
  r.fld_whrs * coalesce(sum(m.value * rm.weight), 0) as earn_whrs
from projectcontrols.audit_records r
join projectcontrols.project_disciplines pd on pd.id = r.discipline_id
left join projectcontrols.roc_milestones rm on rm.template_id = pd.roc_template_id
left join projectcontrols.audit_record_milestones m on m.record_id = r.id and m.seq = rm.seq
group by r.id;

create policy "ar_tenant_read" on projectcontrols.audit_records
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
create policy "ar_editor_write" on projectcontrols.audit_records
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor'));

create policy "arm_tenant_read" on projectcontrols.audit_record_milestones
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
create policy "arm_editor_write" on projectcontrols.audit_record_milestones
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor'));
