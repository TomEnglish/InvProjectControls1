-- ELL-62 — Remove the deprecated `editor` role from RBAC.
--
-- Jerry review (May 2026): "get rid of editor — editor would be controller."
-- Execution duties (progress writes, CO submit, auditor queue) move to
-- pc_reviewer+; existing editor rows are migrated to pc_reviewer.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Data migration (while enum still carries `editor`)
-- ─────────────────────────────────────────────────────────────────────
update projectcontrols.app_users
   set role = 'pc_reviewer', updated_at = now()
 where role = 'editor';

update projectcontrols.project_members
   set project_role = 'pc_reviewer', updated_at = now()
 where project_role = 'editor';

-- ─────────────────────────────────────────────────────────────────────
-- 2. RPC gates: editor+ → pc_reviewer+
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
  perform projectcontrols.assert_role('pc_reviewer');

  if not exists (select 1 from projectcontrols.projects where id = pid and tenant_id = tid) then
    raise exception 'project not found' using errcode = 'P0001';
  end if;

  select coalesce(max((regexp_replace(co_number, '\D', '', 'g'))::int), 0) + 1
    into next_num
  from projectcontrols.change_orders where project_id = pid;
  co_num := 'CO-' || lpad(next_num::text, 3, '0');

  hrs_impact := coalesce((p_payload->>'hrs_impact')::numeric, (p_payload->>'qty_change')::numeric * 2.5);
  v_date := coalesce(nullif(p_payload->>'date', '')::date, current_date);

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
  perform projectcontrols.assert_role('pc_reviewer');

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

create or replace function projectcontrols.actuals_bulk_upsert(
  p_project_id uuid,
  p_period_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = projectcontrols
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  period record;
  row jsonb;
  v_discipline_id uuid;
  v_record_id uuid;
  inserted int := 0;
begin
  perform projectcontrols.assert_role('pc_reviewer');

  select id, locked_at, project_id, tenant_id into period
  from projectcontrols.progress_periods
  where id = p_period_id and project_id = p_project_id and tenant_id = tid
  for update;

  if period.id is null then
    raise exception 'period not found in this tenant/project' using errcode = 'P0001';
  end if;
  if period.locked_at is not null then
    raise exception 'period_already_locked' using errcode = '22023';
  end if;

  for row in select * from jsonb_array_elements(p_rows) loop
    select id into v_discipline_id
    from projectcontrols.project_disciplines
    where project_id = p_project_id
      and discipline_code = (row->>'discipline_code')::projectcontrols.discipline_code
      and is_active = true;

    if v_discipline_id is null then
      raise exception 'discipline % not configured', row->>'discipline_code' using errcode = '22023';
    end if;

    v_record_id := nullif(row->>'record_id', '')::uuid;

    insert into projectcontrols.actual_hours (
      tenant_id, project_id, period_id, discipline_id, record_id, hours, source
    ) values (
      tid, p_project_id, p_period_id, v_discipline_id, v_record_id,
      (row->>'hours')::numeric,
      coalesce(row->>'source', 'manual')
    );
    inserted := inserted + 1;
  end loop;

  perform projectcontrols.write_audit_log(
    'actual_hours', p_period_id, 'bulk_upsert',
    null,
    jsonb_build_object('inserted', inserted)
  );

  return jsonb_build_object('inserted', inserted);
end
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. RLS — drop editor from role lists (pc_reviewer already admitted)
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists "progress_records_editor_write" on projectcontrols.progress_records;
create policy "progress_records_reviewer_write" on projectcontrols.progress_records
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  );

drop policy if exists "prm_editor_write" on projectcontrols.progress_record_milestones;
create policy "prm_reviewer_write" on projectcontrols.progress_record_milestones
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('super_admin', 'admin', 'pm', 'pc_reviewer')
  );

drop policy if exists "uq_tenant_read_editor_plus" on projectcontrols.upload_queue;
create policy "uq_tenant_read_reviewer_plus" on projectcontrols.upload_queue
  for select to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in
        ('pc_reviewer','pm','admin','super_admin')
  );

drop policy if exists "uq_storage_editor_write" on storage.objects;
create policy "uq_storage_reviewer_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'upload-queue'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in
        ('pc_reviewer','pm','admin','super_admin')
  );

drop policy if exists "co_editor_draft" on projectcontrols.change_orders;
create policy "co_reviewer_draft" on projectcontrols.change_orders
  for insert to authenticated
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'super_admin')
    and status in ('draft', 'pending')
  );

drop policy if exists "attachments_editor_write" on projectcontrols.attachments;
create policy "attachments_reviewer_write" on projectcontrols.attachments
  for insert to authenticated
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'super_admin')
  );

drop policy if exists "attachments_editor_delete" on projectcontrols.attachments;
create policy "attachments_reviewer_delete" on projectcontrols.attachments
  for delete to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and uploaded_by = auth.uid()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'super_admin')
  );

drop policy if exists "attachments_storage_editor_write" on storage.objects;
create policy "attachments_storage_reviewer_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'super_admin')
  );

drop policy if exists "attachments_storage_editor_delete" on storage.objects;
create policy "attachments_storage_reviewer_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'super_admin')
  );

drop policy if exists "ah_editor_write" on projectcontrols.actual_hours;
create policy "ah_reviewer_write" on projectcontrols.actual_hours
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'super_admin')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'super_admin')
  );

-- ─────────────────────────────────────────────────────────────────────
-- 4. assert_role v4 — viewer < clerk < pc_reviewer < pm < admin < super_admin
-- ─────────────────────────────────────────────────────────────────────
create or replace function projectcontrols.assert_role(min_role projectcontrols.user_role)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  r projectcontrols.user_role := projectcontrols.current_user_role();
  rank int;
  min_rank int;
begin
  if r is null then
    raise exception 'auth required' using errcode = '42501';
  end if;
  rank := case r
    when 'viewer' then 1
    when 'clerk' then 2
    when 'pc_reviewer' then 3
    when 'pm' then 4
    when 'admin' then 5
    when 'super_admin' then 6
    else null
  end;
  min_rank := case min_role
    when 'viewer' then 1
    when 'clerk' then 2
    when 'pc_reviewer' then 3
    when 'pm' then 4
    when 'admin' then 5
    when 'super_admin' then 6
    else null
  end;
  if rank is null then
    raise exception 'unknown current role in assert_role: %', r using errcode = '42501';
  end if;
  if min_rank is null then
    raise exception 'unknown min_role in assert_role: %', min_role using errcode = '42501';
  end if;
  if rank < min_rank then
    raise exception 'insufficient role: % < %', r, min_role using errcode = '42501';
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Retire `editor` at the assignment layer (physical enum drop deferred
--    to ELL-49 — dozens of policies + RPC signatures depend on the type).
-- ─────────────────────────────────────────────────────────────────────
alter table projectcontrols.app_users
  drop constraint if exists app_users_role_not_editor;
alter table projectcontrols.app_users
  add constraint app_users_role_not_editor
  check (role::text <> 'editor');

alter table projectcontrols.project_members
  drop constraint if exists project_members_role_not_editor;
alter table projectcontrols.project_members
  add constraint project_members_role_not_editor
  check (project_role::text <> 'editor');

create or replace function projectcontrols.admin_set_user_role(
  p_user_id uuid,
  p_new_role projectcontrols.user_role,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  caller uuid := auth.uid();
  caller_role projectcontrols.user_role := projectcontrols.current_user_role();
  target_role projectcontrols.user_role;
  before jsonb;
begin
  perform projectcontrols.assert_role('admin');

  if p_new_role::text = 'editor' then
    raise exception 'editor role is retired; use pc_reviewer instead' using errcode = '22023';
  end if;

  if p_user_id = caller then
    raise exception 'cannot change your own role; ask another admin or super_admin' using errcode = '22023';
  end if;

  select to_jsonb(u), u.role into before, target_role
  from projectcontrols.app_users u
  where u.id = p_user_id and u.tenant_id = tid;

  if before is null then
    raise exception 'user not found in this tenant' using errcode = 'P0001';
  end if;

  if caller_role = 'admin' then
    if target_role in ('admin', 'super_admin') then
      raise exception 'admin cannot modify another admin or super_admin' using errcode = '42501';
    end if;
    if p_new_role in ('admin', 'super_admin') then
      raise exception 'admin cannot grant role %', p_new_role using errcode = '42501';
    end if;
  end if;

  update projectcontrols.app_users
     set role = p_new_role, updated_at = now()
   where id = p_user_id and tenant_id = tid;

  perform projectcontrols.write_audit_log(
    'app_users', p_user_id, 'set_role',
    before,
    jsonb_build_object(
      'role', p_new_role,
      'reason', p_reason,
      'set_by', caller,
      'set_by_role', caller_role
    )
  );
end
$$;
