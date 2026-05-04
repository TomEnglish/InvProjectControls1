-- Phase 1.5: assert_role hardening.
--
-- Closes the latent privilege-escalation hole flagged by the adversarial
-- review of the original 20260501000001_role_helpers_v2.sql: the CASE
-- statements that mapped role -> rank had no ELSE branch, so any future
-- enum value added to projectcontrols.user_role without updating this
-- function would produce rank=NULL, the comparison would short-circuit
-- to NULL (falsy), and assert_role would return without raising. Net
-- effect: any unknown role would bypass every role gate.
--
-- Fix: keep the existing CASE branches but explicitly raise when either
-- the current role or the requested min_role doesn't appear in the
-- ladder. Behavior for known roles is unchanged.

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
    when 'editor' then 2
    when 'pc_reviewer' then 3
    when 'pm' then 4
    when 'admin' then 5
    when 'super_admin' then 6
    else null
  end;
  min_rank := case min_role
    when 'viewer' then 1
    when 'editor' then 2
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
