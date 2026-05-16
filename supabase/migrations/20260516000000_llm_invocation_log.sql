-- A20 Wave 2 — llm_invocation_log: rate-limit + observability for the
-- async LLM consistency scan triggered by queue-progress-upload.
--
-- The plan promotes rate-limiting from "deferred" to a Wave 2 blocker: a
-- clerk submitting 50 files in an hour shouldn't burn 50 Anthropic API
-- calls. The edge fn inserts one row per scan (pre-call, so the count
-- includes in-flight invocations) and updates it on completion with
-- token counts + ok/error. The rate gate is `count(*) where user_id = X
-- and invoked_at > now() - interval '1 hour'` against a configurable cap.
--
-- Direct INSERT/UPDATE/DELETE go through service_role only (the edge fn
-- holds the key). No SECURITY DEFINER RPC needed — the rate-limit logic
-- lives in app code, not in PG.

create table projectcontrols.llm_invocation_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references projectcontrols.tenants(id) on delete cascade,
  user_id       uuid not null,                      -- caller who triggered the scan
  queue_id      uuid references projectcontrols.upload_queue(id) on delete set null,
  invoked_at    timestamptz not null default now(),
  model         text not null,                      -- e.g. 'claude-haiku-4-5-20251001'
  input_tokens  integer,
  output_tokens integer,
  ok            boolean not null default false,     -- updated to true on success
  error         text                                -- error message on failure
);

create index on projectcontrols.llm_invocation_log(user_id, invoked_at desc);
create index on projectcontrols.llm_invocation_log(tenant_id);
create index on projectcontrols.llm_invocation_log(queue_id);

alter table projectcontrols.llm_invocation_log enable row level security;

-- SELECT: admin / super_admin only — token-cost data is an admin concern,
-- not something every editor needs to see in their inbox.
create policy "lil_admin_read" on projectcontrols.llm_invocation_log
  for select to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'super_admin')
  );

-- No INSERT/UPDATE/DELETE policy: only service_role writes (edge fn
-- holds the key + bypasses RLS).
