-- data_check_signoffs — explicit human sign-off on the ingestion Data Check.
--
-- UAT question: "how do I complete Verify Load?" The Setup Guide step was
-- inferred from manifests existing, which proves there's something TO
-- verify, not that anyone verified it. Project-controls culture wants a
-- named sign-off, so the Data Check page gains a "Mark load verified"
-- action that records who, when, and the check counts at that moment.
--
-- Append-only history (no update/delete policies): a re-import after
-- sign-off doesn't erase the record — the frontend treats a sign-off older
-- than the newest import manifest as stale and asks for a fresh one.

create table projectcontrols.data_check_signoffs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default projectcontrols.current_tenant_id()
                    references projectcontrols.tenants(id) on delete restrict,
  project_id      uuid not null references projectcontrols.projects(id) on delete cascade,
  verified_by     uuid default auth.uid()
                    references projectcontrols.app_users(id) on delete set null,
  verified_at     timestamptz not null default now(),
  checks_total    int not null default 0,
  checks_failing  int not null default 0,
  note            text
);
create index on projectcontrols.data_check_signoffs(tenant_id);
create index on projectcontrols.data_check_signoffs(project_id, verified_at desc);
alter table projectcontrols.data_check_signoffs enable row level security;

create policy "dcs_tenant_read" on projectcontrols.data_check_signoffs
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

-- Verification is a reviewer-level responsibility (locking stays pm+).
create policy "dcs_reviewer_insert" on projectcontrols.data_check_signoffs
  for insert to authenticated
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  );
