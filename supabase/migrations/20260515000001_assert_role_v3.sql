-- A20 Wave 1 — assert_role v3: admit `clerk` between viewer and editor.
--
-- The previous version (20260504000001_assert_role_else.sql) tightened the
-- CASE expressions with explicit `else null` + raise-on-unknown to close a
-- privilege-escalation hole. That guard now fires for clerk users (rank
-- comes back NULL → raise), so any clerk hitting an assert_role-gated RPC
-- breaks the second 20260515000000 lands.
--
-- This migration extends both CASE ladders to admit clerk at rank 2, with
-- editor and everything above shifted up by one. Relative ordering is
-- preserved — every existing min_role check (e.g. min_role = 'pm') still
-- admits the same set of roles as before.

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
    when 'editor' then 3
    when 'pc_reviewer' then 4
    when 'pm' then 5
    when 'admin' then 6
    when 'super_admin' then 7
    else null
  end;
  min_rank := case min_role
    when 'viewer' then 1
    when 'clerk' then 2
    when 'editor' then 3
    when 'pc_reviewer' then 4
    when 'pm' then 5
    when 'admin' then 6
    when 'super_admin' then 7
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
