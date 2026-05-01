-- Phase 1.5: Replace admin_set_user_role with a hierarchy-aware version.
--
-- Rules enforced (matches the user-stated role model):
--   * super_admin can set any role (any user, any target role).
--   * admin can set roles strictly below admin (viewer, editor, pc_reviewer, pm).
--   * admin cannot modify a user whose current role is admin or super_admin.
--   * admin cannot promote anyone to admin or super_admin.
--   * Nobody can change their own role — a peer must do it. This prevents
--     accidental lockout (e.g. the only super_admin demoting themselves) and
--     forces deliberate, audit-logged hand-offs.

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
  -- Caller must be at least admin.
  perform projectcontrols.assert_role('admin');

  -- Self-modification is never allowed; prevents lockout and forces peer review.
  if p_user_id = caller then
    raise exception 'cannot change your own role; ask another admin or super_admin' using errcode = '22023';
  end if;

  -- Load target row (and assert same tenant).
  select to_jsonb(u), u.role into before, target_role
  from projectcontrols.app_users u
  where u.id = p_user_id and u.tenant_id = tid;

  if before is null then
    raise exception 'user not found in this tenant' using errcode = 'P0001';
  end if;

  -- Hierarchy enforcement for admin (super_admin is unrestricted).
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

revoke all on function projectcontrols.admin_set_user_role(uuid, projectcontrols.user_role, text) from public;
grant execute on function projectcontrols.admin_set_user_role(uuid, projectcontrols.user_role, text) to authenticated;
