-- 0006_audit_log.sql
-- Append-only audit trail; every mutating RPC writes here.

create table projectcontrols.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete restrict,
  entity text not null,
  entity_id uuid,
  action text not null,
  actor_id uuid references projectcontrols.app_users(id) on delete set null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);
create index on projectcontrols.audit_log(tenant_id);
create index on projectcontrols.audit_log(entity, entity_id);
create index on projectcontrols.audit_log(created_at desc);
alter table projectcontrols.audit_log enable row level security;

create policy "audit_log_tenant_read" on projectcontrols.audit_log
  for select to authenticated using (tenant_id = projectcontrols.current_tenant_id());
-- No write policy: only SECURITY DEFINER RPCs may insert.

create or replace function projectcontrols.write_audit_log(
  p_entity text,
  p_entity_id uuid,
  p_action text,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
begin
  insert into projectcontrols.audit_log (tenant_id, entity, entity_id, action, actor_id, before_json, after_json)
  values (projectcontrols.current_tenant_id(), p_entity, p_entity_id, p_action, auth.uid(), p_before, p_after);
end
$$;

revoke all on function projectcontrols.write_audit_log(text, uuid, text, jsonb, jsonb) from public;
