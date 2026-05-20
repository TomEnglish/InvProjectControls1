-- CO RPC v3 — assignment-aware routing.
--
-- The three CO RPCs (co_submit, co_pc_review, co_approve) gain assignment
-- behavior:
--
--   co_submit
--     * Accepts assigned_pc_reviewer_id / assigned_pm_id in the payload.
--     * If null in payload, falls back to the project_co_reviewers default
--       for (project, discipline).
--     * If still null, the CO is "unassigned" — any pc_reviewer / pm in
--       the tenant can act on it (legacy behavior for backward compat).
--
--   co_pc_review
--     * Now gates on assigned_pc_reviewer_id: only the assignee, the
--       project's admin/super_admin, can forward/reject. Null assignment
--       means "any pc_reviewer" (legacy behavior).
--     * NEW p_reassign_pm_id parameter: on forward, the PC reviewer can
--       override the assigned PM (covers "this is actually civil, kicking
--       it to Hank" — Sandra's stated re-assignment use case).
--
--   co_approve
--     * Gates on assigned_pm_id the same way co_pc_review gates on
--       assigned_pc_reviewer_id. Null = any PM.

-- ─────────────────────────────────────────────────────────────────────
-- co_submit v3 — accepts assignments in payload, falls back to defaults.
-- ─────────────────────────────────────────────────────────────────────

create or replace function projectcontrols.co_submit(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  pid uuid := (p_payload->>'project_id')::uuid;
  did uuid := nullif(p_payload->>'discipline_id', '')::uuid;
  next_num int;
  co_num text;
  new_id uuid;
  hrs_impact numeric;
  v_date date;
  v_pc_reviewer uuid;
  v_pm uuid;
begin
  perform projectcontrols.assert_role('editor');

  if not exists (select 1 from projectcontrols.projects where id = pid and tenant_id = tid) then
    raise exception 'project not found' using errcode = 'P0001';
  end if;

  select coalesce(max((regexp_replace(co_number, '\D', '', 'g'))::int), 0) + 1
    into next_num
  from projectcontrols.change_orders where project_id = pid;
  co_num := 'CO-' || lpad(next_num::text, 3, '0');

  hrs_impact := coalesce((p_payload->>'hrs_impact')::numeric, (p_payload->>'qty_change')::numeric * 2.5);
  v_date := coalesce(nullif(p_payload->>'date', '')::date, current_date);

  -- Resolve assignments. Explicit payload values win; otherwise look up
  -- the project's per-discipline default; otherwise leave null (any
  -- pc_reviewer / pm can act, legacy behavior).
  v_pc_reviewer := nullif(p_payload->>'assigned_pc_reviewer_id', '')::uuid;
  v_pm := nullif(p_payload->>'assigned_pm_id', '')::uuid;
  if (v_pc_reviewer is null or v_pm is null) and did is not null then
    select
      coalesce(v_pc_reviewer, pcor.pc_reviewer_id),
      coalesce(v_pm, pcor.pm_id)
      into v_pc_reviewer, v_pm
    from projectcontrols.project_co_reviewers pcor
    where pcor.project_id = pid and pcor.discipline_id = did;
  end if;

  -- Validate any chosen assignments are in-tenant with sufficient role.
  -- Without this, a malicious payload could plant a non-pc_reviewer id
  -- on assigned_pc_reviewer_id and the gate in co_pc_review would still
  -- admit them because assert_role('pc_reviewer') passes — though they
  -- wouldn't be a valid recipient for the notification email anyway.
  -- Defense-in-depth.
  if v_pc_reviewer is not null and not exists (
    select 1 from projectcontrols.app_users
    where id = v_pc_reviewer and tenant_id = tid
      and role in ('pc_reviewer', 'pm', 'admin', 'super_admin')
  ) then
    raise exception 'assigned_pc_reviewer_id user not in tenant or insufficient role'
      using errcode = '42501';
  end if;
  if v_pm is not null and not exists (
    select 1 from projectcontrols.app_users
    where id = v_pm and tenant_id = tid
      and role in ('pm', 'admin', 'super_admin')
  ) then
    raise exception 'assigned_pm_id user not in tenant or insufficient role'
      using errcode = '42501';
  end if;

  insert into projectcontrols.change_orders (
    tenant_id, project_id, co_number, date, drawing, discipline_id,
    type, description, qty_change, uom, hrs_impact, status,
    requested_by, created_by,
    assigned_pc_reviewer_id, assigned_pm_id
  ) values (
    tid, pid, co_num, v_date,
    nullif(p_payload->>'drawing', ''),
    did,
    (p_payload->>'type')::projectcontrols.co_type,
    p_payload->>'description',
    (p_payload->>'qty_change')::numeric,
    (p_payload->>'uom')::projectcontrols.uom_code,
    hrs_impact,
    'pending',
    p_payload->>'requested_by',
    auth.uid(),
    v_pc_reviewer,
    v_pm
  )
  returning id into new_id;

  insert into projectcontrols.change_order_events (tenant_id, co_id, event, actor_id, notes)
  values (tid, new_id, 'submitted', auth.uid(), p_payload->>'notes');

  perform projectcontrols.write_audit_log(
    'change_orders', new_id, 'submit',
    null,
    to_jsonb((select co from projectcontrols.change_orders co where co.id = new_id))
  );

  return new_id;
end
$$;

grant execute on function projectcontrols.co_submit(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- co_pc_review v3 — gates on assignment, allows PM re-assignment.
-- New optional p_reassign_pm_id parameter. Pass to override the
-- assigned PM on forward (covers "kick it to a different PM" flow);
-- omit / null to leave assigned_pm_id as-is.
--
-- NOTE: this is a NEW signature (uuid, text, text, uuid). The old
-- signature (uuid, text, text) is dropped so old callers fail loudly
-- rather than silently bypassing the new gate.
-- ─────────────────────────────────────────────────────────────────────

drop function if exists projectcontrols.co_pc_review(uuid, text, text);

create or replace function projectcontrols.co_pc_review(
  p_co_id uuid,
  p_decision text,
  p_notes text default null,
  p_reassign_pm_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  caller_role projectcontrols.user_role := projectcontrols.current_user_role();
  before jsonb;
  assigned_pcr uuid;
  new_status projectcontrols.co_status;
  new_pm_assignment uuid;
begin
  perform projectcontrols.assert_role('pc_reviewer');

  select to_jsonb(co), co.assigned_pc_reviewer_id
    into before, assigned_pcr
  from projectcontrols.change_orders co
  where id = p_co_id and tenant_id = tid;
  if before is null then
    raise exception 'CO not found' using errcode = 'P0001';
  end if;
  if (before->>'status') <> 'pending' then
    raise exception 'CO not in pending state' using errcode = '22023';
  end if;

  -- Assignment gate: if the CO is assigned to a specific reviewer, only
  -- that reviewer (or admin / super_admin) can act. Null assignment
  -- falls back to "any pc_reviewer", which the assert_role call above
  -- already enforced.
  if assigned_pcr is not null
     and assigned_pcr <> auth.uid()
     and caller_role not in ('admin', 'super_admin')
  then
    raise exception 'CO is assigned to a different reviewer'
      using errcode = '42501';
  end if;

  new_status := case p_decision
                  when 'forward' then 'pc_reviewed'::projectcontrols.co_status
                  when 'reject' then 'rejected'::projectcontrols.co_status
                  else null
                end;
  if new_status is null then
    raise exception 'invalid decision' using errcode = '22023';
  end if;

  -- PM re-assignment is only meaningful on forward. Validate target if
  -- supplied; reject path ignores the parameter.
  if p_decision = 'forward' and p_reassign_pm_id is not null then
    if not exists (
      select 1 from projectcontrols.app_users
      where id = p_reassign_pm_id and tenant_id = tid
        and role in ('pm', 'admin', 'super_admin')
    ) then
      raise exception 'reassigned PM not in tenant or insufficient role'
        using errcode = '42501';
    end if;
    new_pm_assignment := p_reassign_pm_id;
  else
    new_pm_assignment := (before->>'assigned_pm_id')::uuid;
  end if;

  update projectcontrols.change_orders
     set status = new_status,
         pc_reviewed_by = auth.uid(),
         pc_reviewed_at = now(),
         assigned_pm_id = new_pm_assignment,
         rejection_reason = case when p_decision = 'reject' then p_notes else null end,
         updated_at = now()
   where id = p_co_id and tenant_id = tid;

  insert into projectcontrols.change_order_events (tenant_id, co_id, event, actor_id, notes)
  values (tid, p_co_id,
    case p_decision when 'forward' then 'pc_reviewed' else 'rejected' end,
    auth.uid(), p_notes);

  perform projectcontrols.write_audit_log(
    'change_orders', p_co_id,
    'pc_review_' || p_decision,
    before,
    to_jsonb((select co from projectcontrols.change_orders co where co.id = p_co_id))
  );
end
$$;

grant execute on function projectcontrols.co_pc_review(uuid, text, text, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- co_approve v3 — gates on assigned_pm_id.
-- Signature unchanged; behavior tightens to honor the assignment.
-- ─────────────────────────────────────────────────────────────────────

create or replace function projectcontrols.co_approve(
  p_co_id uuid,
  p_decision text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  caller_role projectcontrols.user_role := projectcontrols.current_user_role();
  before jsonb;
  assigned_pm uuid;
  new_status projectcontrols.co_status;
begin
  perform projectcontrols.assert_role('pm');

  select to_jsonb(co), co.assigned_pm_id
    into before, assigned_pm
  from projectcontrols.change_orders co
  where id = p_co_id and tenant_id = tid;
  if before is null then
    raise exception 'CO not found' using errcode = 'P0001';
  end if;
  if (before->>'status') <> 'pc_reviewed' then
    raise exception 'CO must be pc_reviewed before approval' using errcode = '22023';
  end if;

  -- Assignment gate: if the CO is assigned to a specific PM, only that
  -- PM (or admin / super_admin) can act. Null assignment falls back to
  -- "any pm", which assert_role already enforced.
  if assigned_pm is not null
     and assigned_pm <> auth.uid()
     and caller_role not in ('admin', 'super_admin')
  then
    raise exception 'CO is assigned to a different PM'
      using errcode = '42501';
  end if;

  new_status := case p_decision
                  when 'forward' then 'approved'::projectcontrols.co_status
                  when 'reject' then 'rejected'::projectcontrols.co_status
                  else null
                end;
  if new_status is null then
    raise exception 'invalid decision' using errcode = '22023';
  end if;

  update projectcontrols.change_orders
     set status = new_status,
         approved_by = auth.uid(),
         approved_at = now(),
         rejection_reason = case when p_decision = 'reject' then p_notes else null end,
         updated_at = now()
   where id = p_co_id and tenant_id = tid;

  insert into projectcontrols.change_order_events (tenant_id, co_id, event, actor_id, notes)
  values (tid, p_co_id,
    case p_decision when 'forward' then 'approved' else 'rejected' end,
    auth.uid(), p_notes);

  perform projectcontrols.write_audit_log(
    'change_orders', p_co_id,
    'approve_' || p_decision,
    before,
    to_jsonb((select co from projectcontrols.change_orders co where co.id = p_co_id))
  );
end
$$;

grant execute on function projectcontrols.co_approve(uuid, text, text) to authenticated;
