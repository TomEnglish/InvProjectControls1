-- admin_set_user_role: change a user's role within the caller's tenant.
-- Audit-logged. Caller must be admin; cannot demote themselves (prevents
-- locking the tenant out of admin access).

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
  before jsonb;
begin
  perform projectcontrols.assert_role('admin');

  if p_user_id = caller and p_new_role <> 'admin' then
    raise exception 'admins cannot demote themselves' using errcode = '22023';
  end if;

  select to_jsonb(u) into before
  from projectcontrols.app_users u
  where u.id = p_user_id and u.tenant_id = tid;

  if before is null then
    raise exception 'user not found in this tenant' using errcode = 'P0001';
  end if;

  update projectcontrols.app_users
     set role = p_new_role, updated_at = now()
   where id = p_user_id and tenant_id = tid;

  perform projectcontrols.write_audit_log(
    'app_users', p_user_id, 'set_role',
    before,
    jsonb_build_object('role', p_new_role, 'reason', p_reason)
  );
end
$$;

revoke all on function projectcontrols.admin_set_user_role(uuid, projectcontrols.user_role, text) from public;
grant execute on function projectcontrols.admin_set_user_role(uuid, projectcontrols.user_role, text) to authenticated;
