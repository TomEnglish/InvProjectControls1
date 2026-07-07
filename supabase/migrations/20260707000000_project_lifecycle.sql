-- Project lifecycle — create a fresh draft project, close a finished one,
-- reopen a mistakenly-closed one.
--
-- Motivation: the app had no in-app way to start a new project. Projects
-- only existed because the seed script upserted them; "start a new project"
-- meant editing a seed and re-seeding. This adds the supported create path,
-- plus a close/reopen pair so a finished project can be marked done and
-- dropped out of the active switcher without deleting its history.
--
-- Why project_create must be a SECURITY DEFINER RPC and not a client insert:
--   * RLS lets pm/admin INSERT into projects (projects_admin_write), but
--   * project_members has no INSERT path for a self-bootstrapping creator:
--     pm cannot insert at all, and admin must ALREADY be a member
--     (pm_admin_insert). Chicken-and-egg.
--   * Yet the setup flow needs that membership row: project_coa_codes and
--     project_clerk_crafts writes require is_project_member(...). A project
--     created without it is half-broken — the COA picker fails RLS.
-- So creation inserts the project AND the creator's membership atomically,
-- the same definer-RPC pattern as project_lock_baseline.

-- closed_at: display stamp for the closed state. Nullable; only set by
-- project_close, cleared by project_reopen. status carries the source of
-- truth — this is convenience metadata for the UI and audit readability.
alter table projectcontrols.projects
  add column if not exists closed_at timestamptz;

-- ---------------------------------------------------------------------------
-- project_create — insert a draft project + self-membership for the creator.
-- ---------------------------------------------------------------------------
create or replace function projectcontrols.project_create(
  p_project_code text,
  p_name text,
  p_client text,
  p_start_date date,
  p_end_date date
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
  member_role projectcontrols.user_role;
begin
  -- Same lifecycle-owner gate as locking: pm + admin + super_admin.
  perform projectcontrols.assert_role('pm');

  if coalesce(trim(p_project_code), '') = '' then
    raise exception 'project code is required' using errcode = '22023';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'project name is required' using errcode = '22023';
  end if;
  if coalesce(trim(p_client), '') = '' then
    raise exception 'client is required' using errcode = '22023';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date must be on or after start date' using errcode = '22023';
  end if;

  begin
    insert into projectcontrols.projects (tenant_id, project_code, name, client, status, start_date, end_date)
    values (tid, trim(p_project_code), trim(p_name), trim(p_client), 'draft', p_start_date, p_end_date)
    returning id into new_id;
  exception when unique_violation then
    raise exception 'project code "%" is already used by another project', trim(p_project_code)
      using errcode = '23505';
  end;

  -- Self-membership so the setup flow's membership-gated writes (COA scope,
  -- clerk crafts) succeed. Give the creator a full-power project role rather
  -- than their raw tenant role, so a tenant-level admin still lands as an
  -- effective pm+ on the project they just made.
  member_role := case
    when caller_role in ('admin', 'super_admin') then 'admin'::projectcontrols.user_role
    else 'pm'::projectcontrols.user_role
  end;

  insert into projectcontrols.project_members (tenant_id, project_id, user_id, project_role, added_by)
  values (tid, new_id, auth.uid(), member_role, auth.uid());

  perform projectcontrols.write_audit_log(
    'projects', new_id, 'create',
    null,
    to_jsonb((select p from projectcontrols.projects p where p.id = new_id))
  );

  return new_id;
end
$$;

revoke all on function projectcontrols.project_create(text, text, text, date, date) from public;
grant execute on function projectcontrols.project_create(text, text, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- project_close — mark an active project complete (active → closed).
-- ---------------------------------------------------------------------------
create or replace function projectcontrols.project_close(p_project_id uuid)
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
    raise exception 'only an active project can be closed (status "%")', before->>'status'
      using errcode = '55000';
  end if;

  update projectcontrols.projects
     set status = 'closed', closed_at = now(), updated_at = now()
   where id = p_project_id and tenant_id = tid;

  perform projectcontrols.write_audit_log(
    'projects', p_project_id, 'close',
    before,
    to_jsonb((select p from projectcontrols.projects p where p.id = p_project_id))
  );
end
$$;

revoke all on function projectcontrols.project_close(uuid) from public;
grant execute on function projectcontrols.project_close(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- project_reopen — undo a close (closed → active). Restores the project to
-- the state it had before closing; the locked baseline is untouched.
-- ---------------------------------------------------------------------------
create or replace function projectcontrols.project_reopen(p_project_id uuid)
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
  if (before->>'status') <> 'closed' then
    raise exception 'only a closed project can be reopened (status "%")', before->>'status'
      using errcode = '55000';
  end if;

  update projectcontrols.projects
     set status = 'active', closed_at = null, updated_at = now()
   where id = p_project_id and tenant_id = tid;

  perform projectcontrols.write_audit_log(
    'projects', p_project_id, 'reopen',
    before,
    to_jsonb((select p from projectcontrols.projects p where p.id = p_project_id))
  );
end
$$;

revoke all on function projectcontrols.project_reopen(uuid) from public;
grant execute on function projectcontrols.project_reopen(uuid) to authenticated;
