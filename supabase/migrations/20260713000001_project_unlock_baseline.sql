-- project_unlock_baseline — undo a baseline lock (active → draft).
--
-- Until now the lock was one-way: project_lock_baseline flips draft → active
-- and nothing flips back, so a mis-locked baseline (wrong records, missing
-- work types, bad budgets) was unrecoverable without hand-editing the
-- projects row. This RPC completes the re-baseline loop identified in the
-- lifecycle review: unlock → fix/clear/reload → Data Check → re-lock.
--
-- Semantics:
--   * pm+ role, project in caller's tenant, status must be 'active'
--     (a closed project must be reopened first — see project_reopen).
--   * Status returns to 'draft'; baseline_locked_at/_by are cleared so the
--     Setup page renders the draft flow (loader + lock card) again.
--   * Existing rows in `baselines` are kept untouched — the snapshot history
--     stays immutable and audit-able. Re-locking inserts a new snapshot.
--   * Progress data (records, milestone %, snapshots, uploads, COs) is not
--     modified. Unlocking only reopens scope editing; it deletes nothing.

-- Re-lock support: baselines carried `unique (project_id, locked_at)`. That
-- was unreachable while the lock was one-way, but the unlock loop makes
-- "lock → unlock → re-lock the same day" routine — and the lock modal
-- normalizes the effective date to midnight, so a same-day re-lock would
-- collide. Locking is already serialized by the draft-status guard, so the
-- constraint isn't guarding anything real; drop it and keep a plain lookup
-- index. Multiple snapshots per project/date are legitimate history.
alter table projectcontrols.baselines drop constraint if exists baselines_unique;
create index if not exists baselines_project_locked_at
  on projectcontrols.baselines (project_id, locked_at desc);

create or replace function projectcontrols.project_unlock_baseline(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
begin
  perform projectcontrols.assert_role('pm');

  select to_jsonb(p) into before
  from projectcontrols.projects p
  where id = p_project_id and tenant_id = tid;
  if before is null then
    raise exception 'project not found in your tenant' using errcode = '42501';
  end if;
  if (before->>'status') <> 'active' then
    raise exception 'only an active project can have its baseline unlocked (status "%")', before->>'status'
      using errcode = '55000';
  end if;

  update projectcontrols.projects
     set status = 'draft',
         baseline_locked_at = null,
         baseline_locked_by = null,
         updated_at = now()
   where id = p_project_id and tenant_id = tid;

  perform projectcontrols.write_audit_log(
    'projects', p_project_id, 'unlock_baseline',
    before,
    to_jsonb((select p from projectcontrols.projects p where p.id = p_project_id))
  );
end
$$;

revoke all on function projectcontrols.project_unlock_baseline(uuid) from public;
grant execute on function projectcontrols.project_unlock_baseline(uuid) to authenticated;
