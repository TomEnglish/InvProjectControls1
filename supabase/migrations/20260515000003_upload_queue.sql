-- A20 Wave 1 — upload_queue table + the three SECURITY DEFINER RPCs that
-- mediate every state transition on it.
--
-- Pipeline:
--   clerk → queue-progress-upload edge fn → upload_queue_submit RPC      (INSERT, status='queued')
--   edge fn → queue-llm-check (async)    → upload_queue_llm_update RPC   (narrow UPDATE: llm_warnings + state)
--   auditor → queue-approve-upload fn   → upload_queue_state_transition  (UPDATE: status, reviewer, snapshot_id)
--
-- The plan trades direct INSERT/UPDATE RLS for SECURITY DEFINER RPCs so
-- the write surface is statically scoped. The RPCs each do their own role
-- assertion + audit_log write. Mirrors the pattern of co_submit, co_approve,
-- project_lock_baseline, etc.

create table projectcontrols.upload_queue (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references projectcontrols.tenants(id) on delete cascade,
  project_id          uuid not null,
  declared_craft      projectcontrols.discipline_code not null,
  uploaded_by         uuid not null,
  file_path           text not null,
  parsed_path         text not null,
  original_filename   text not null,
  file_size_bytes     bigint not null,
  status              text not null
                      check (status in ('queued','approved','rejected'))
                      default 'queued',
  parse_summary       jsonb not null,
  heuristic_warnings  jsonb,
  llm_warnings        jsonb,
  llm_scan_state      text not null
                      check (llm_scan_state in ('pending','done','failed'))
                      default 'pending',
  override_warnings   boolean not null default false,
  week_ending         date,
  label               text,
  reviewed_by         uuid references projectcontrols.app_users(id) on delete set null,
  reviewed_at         timestamptz,
  rejection_reason    text,
  snapshot_id         uuid references projectcontrols.progress_snapshots(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (project_id, tenant_id)
    references projectcontrols.projects(id, tenant_id) on delete cascade,
  foreign key (uploaded_by, tenant_id)
    references projectcontrols.app_users(id, tenant_id) on delete cascade
);

create index on projectcontrols.upload_queue(tenant_id);
create index on projectcontrols.upload_queue(project_id, status);
create index on projectcontrols.upload_queue(uploaded_by, created_at desc);
create index on projectcontrols.upload_queue(status, created_at desc);

alter table projectcontrols.upload_queue enable row level security;

-- SELECT: tenant-wide so editor+ (auditors, PMs) see every submission.
-- Clerks see their own rows by extension of the same tenant gate AND a
-- second policy that restricts them to uploaded_by = auth.uid().
create policy "uq_tenant_read_editor_plus" on projectcontrols.upload_queue
  for select to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in
        ('editor','pc_reviewer','pm','admin','super_admin')
  );

create policy "uq_own_read_clerk" on projectcontrols.upload_queue
  for select to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() = 'clerk'
    and uploaded_by = auth.uid()
  );

-- No INSERT/UPDATE/DELETE policies. All writes via the RPCs below.

-- ─────────────────────────────────────────────────────────────────────
-- upload_queue_submit: clerks INSERT a queued row through here.
-- Asserts role >= clerk + (project, craft) ∈ project_clerk_crafts for the
-- caller. super_admin bypasses the per-(project, craft) check. Returns
-- the new row's id so the caller can poll for LLM-scan completion.
-- ─────────────────────────────────────────────────────────────────────

create or replace function projectcontrols.upload_queue_submit(
  p_project_id          uuid,
  p_declared_craft      projectcontrols.discipline_code,
  p_file_path           text,
  p_parsed_path         text,
  p_original_filename   text,
  p_file_size_bytes     bigint,
  p_parse_summary       jsonb,
  p_heuristic_warnings  jsonb,
  p_override_warnings   boolean,
  p_week_ending         date,
  p_label               text
)
returns uuid
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  caller_role projectcontrols.user_role := projectcontrols.current_user_role();
  new_id uuid;
begin
  perform projectcontrols.assert_role('clerk');

  -- Project must be in caller's tenant.
  if not exists (
    select 1 from projectcontrols.projects
    where id = p_project_id and tenant_id = tid
  ) then
    raise exception 'project not in tenant' using errcode = 'P0001';
  end if;

  -- super_admin bypasses the per-(project, craft) check. Anyone else must
  -- have a project_clerk_crafts row for this exact pair.
  if caller_role <> 'super_admin' and not exists (
    select 1
    from projectcontrols.project_clerk_crafts
    where project_id = p_project_id
      and user_id    = auth.uid()
      and craft      = p_declared_craft
      and tenant_id  = tid
  ) then
    raise exception 'caller not permitted on (% , %)', p_project_id, p_declared_craft
      using errcode = '42501';
  end if;

  if p_file_path is null or p_file_path = '' then
    raise exception 'file_path required' using errcode = 'P0001';
  end if;
  if p_parsed_path is null or p_parsed_path = '' then
    raise exception 'parsed_path required' using errcode = 'P0001';
  end if;

  insert into projectcontrols.upload_queue (
    tenant_id, project_id, declared_craft, uploaded_by,
    file_path, parsed_path, original_filename, file_size_bytes,
    parse_summary, heuristic_warnings, override_warnings,
    week_ending, label
  )
  values (
    tid, p_project_id, p_declared_craft, auth.uid(),
    p_file_path, p_parsed_path, p_original_filename, p_file_size_bytes,
    coalesce(p_parse_summary, '{}'::jsonb), p_heuristic_warnings, coalesce(p_override_warnings, false),
    p_week_ending, p_label
  )
  returning id into new_id;

  perform projectcontrols.write_audit_log(
    'upload_queue', new_id, 'submit',
    null,
    jsonb_build_object(
      'project_id', p_project_id,
      'declared_craft', p_declared_craft,
      'original_filename', p_original_filename,
      'override_warnings', coalesce(p_override_warnings, false)
    )
  );

  return new_id;
end
$$;

revoke all on function projectcontrols.upload_queue_submit(
  uuid, projectcontrols.discipline_code, text, text, text, bigint, jsonb, jsonb, boolean, date, text
) from public;
grant execute on function projectcontrols.upload_queue_submit(
  uuid, projectcontrols.discipline_code, text, text, text, bigint, jsonb, jsonb, boolean, date, text
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- upload_queue_state_transition: auditors approve or reject. Atomic
-- status update + audit_log. The snapshot import itself happens upstream
-- in the queue-approve-upload edge fn — by the time this RPC is called
-- the new snapshot already exists and its id is passed in.
-- ─────────────────────────────────────────────────────────────────────

create or replace function projectcontrols.upload_queue_state_transition(
  p_queue_id          uuid,
  p_action            text,
  p_snapshot_id       uuid default null,
  p_rejection_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
  reviewer_id uuid;
begin
  perform projectcontrols.assert_role('editor');

  if p_action not in ('approved', 'rejected') then
    raise exception 'invalid action: % (must be approved or rejected)', p_action
      using errcode = 'P0001';
  end if;

  if p_action = 'rejected' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'rejection_reason required when action = rejected' using errcode = 'P0001';
  end if;

  if p_action = 'approved' and p_snapshot_id is null then
    raise exception 'snapshot_id required when action = approved' using errcode = 'P0001';
  end if;

  select to_jsonb(q) into before
  from projectcontrols.upload_queue q
  where q.id = p_queue_id and q.tenant_id = tid;

  if before is null then
    raise exception 'queue row not found' using errcode = 'P0002';
  end if;

  if (before->>'status') <> 'queued' then
    raise exception 'queue row in status %, cannot transition', before->>'status'
      using errcode = '22023';
  end if;

  -- Map the app_users.id for the reviewer. reviewed_by FKs to app_users,
  -- so a caller without a tenant-matching app_users row must be rejected
  -- explicitly — otherwise we'd silently lose the reviewer identity in
  -- the audit trail.
  select id into reviewer_id
  from projectcontrols.app_users
  where id = auth.uid() and tenant_id = tid;

  if reviewer_id is null then
    raise exception 'reviewer % not bound to a tenant app_users row', auth.uid()
      using errcode = '42501';
  end if;

  if p_action = 'approved' then
    update projectcontrols.upload_queue
       set status        = 'approved',
           reviewed_by   = reviewer_id,
           reviewed_at   = now(),
           snapshot_id   = p_snapshot_id,
           updated_at    = now()
     where id = p_queue_id and tenant_id = tid;
  else
    update projectcontrols.upload_queue
       set status            = 'rejected',
           reviewed_by       = reviewer_id,
           reviewed_at       = now(),
           rejection_reason  = p_rejection_reason,
           updated_at        = now()
     where id = p_queue_id and tenant_id = tid;
  end if;

  perform projectcontrols.write_audit_log(
    'upload_queue', p_queue_id, p_action,
    before,
    jsonb_build_object(
      'reviewed_by', reviewer_id,
      'snapshot_id', p_snapshot_id,
      'rejection_reason', p_rejection_reason
    )
  );
end
$$;

revoke all on function projectcontrols.upload_queue_state_transition(uuid, text, uuid, text) from public;
grant execute on function projectcontrols.upload_queue_state_transition(uuid, text, uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- upload_queue_llm_update: edge fn (queue-llm-check) writes the async LLM
-- scan result through here. Signature is the entire write surface — only
-- llm_warnings + llm_scan_state can be touched. Grant restricted to
-- service_role because the edge fn calls it with the service-role JWT
-- (the row's owning clerk shouldn't be able to spoof an LLM result).
-- ─────────────────────────────────────────────────────────────────────

create or replace function projectcontrols.upload_queue_llm_update(
  p_queue_id  uuid,
  p_warnings  jsonb,
  p_state     text
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  q_tenant_id uuid;
begin
  if p_state not in ('done', 'failed') then
    raise exception 'invalid llm_scan_state: %', p_state using errcode = 'P0001';
  end if;

  update projectcontrols.upload_queue
     set llm_warnings   = p_warnings,
         llm_scan_state = p_state,
         updated_at     = now()
   where id = p_queue_id
     and llm_scan_state = 'pending'
  returning tenant_id into q_tenant_id;

  if not found then
    -- Either the row doesn't exist or it's already been written to. Don't
    -- raise — the edge fn retries on transient errors and "no-op because
    -- already done" is a benign outcome.
    return;
  end if;

  -- Write audit_log directly rather than via write_audit_log: the helper
  -- sources tenant_id from current_tenant_id() and actor from auth.uid(),
  -- both of which return null when this RPC is invoked via the service_role
  -- JWT (the only authorized caller — see grant below). Sourcing tenant_id
  -- from the queue row keeps the audit row insertable in that path.
  -- actor_id is intentionally null: the LLM scan is an automated event,
  -- not a human action.
  insert into projectcontrols.audit_log
    (tenant_id, entity, entity_id, action, actor_id, before_json, after_json)
  values
    (q_tenant_id, 'upload_queue', p_queue_id, 'llm_scan', null,
     null,
     jsonb_build_object('llm_scan_state', p_state, 'llm_warnings', p_warnings));
end
$$;

revoke all on function projectcontrols.upload_queue_llm_update(uuid, jsonb, text) from public;
grant execute on function projectcontrols.upload_queue_llm_update(uuid, jsonb, text) to service_role;
