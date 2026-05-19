-- A2 — per-project U/R adjustment override + audit trail.
--
-- Sandra's UAT (app_review_todo.md item 2):
--   "U/R changes per job depending on bid; must be editable from Project
--    Setup. Restricted role: only Elliott / Jerry / 'the person over all
--    the auditors' can change U/R. Track every U/R change: who changed it,
--    when, old → new."
--
-- Implementation: a nullable `pf_adj_override` column on project_coa_codes.
-- When set, the project's effective PF adjustment for that code is the
-- override; when null, the project falls back to the tenant-wide
-- coa_codes.pf_adj. The effective per-project pf_rate is then
-- `base_rate * coalesce(pf_adj_override, pf_adj)`.
--
-- Writes go through a SECURITY DEFINER RPC so the role gate is enforced
-- server-side and every change writes an audit_log entry the admin trail
-- needs ("who changed it, when, old → new"). The base_rate stays
-- tenant-wide because it's a labor-market figure that doesn't shift
-- per-job; only the productivity factor varies.

alter table projectcontrols.project_coa_codes
  add column if not exists pf_adj_override numeric(6, 4)
    check (pf_adj_override is null or pf_adj_override >= 0);

comment on column projectcontrols.project_coa_codes.pf_adj_override is
  'Per-project override of the tenant-wide coa_codes.pf_adj. When null the project uses the tenant default. Effective pf_rate = base_rate * coalesce(pf_adj_override, pf_adj).';

-- ─────────────────────────────────────────────────────────────────────
-- project_coa_pf_set — admin-only setter for the override.
--
-- Pass p_pf_adj = NULL to clear the override (back to tenant default).
-- The row must already exist (i.e. the code must be in the project's
-- in-scope picks) — we don't auto-add to scope here because that's a
-- separate user gesture on the picker card.
--
-- Reads admit pm via the picker card RLS (see
-- 20260519000001_project_coa_codes_admit_pm.sql). Writes here stay
-- admin-only per Sandra's tight scoping ("only Elliott / Jerry / the
-- person over all the auditors").
-- ─────────────────────────────────────────────────────────────────────

create or replace function projectcontrols.project_coa_pf_set(
  p_project_id  uuid,
  p_coa_code_id uuid,
  p_pf_adj      numeric
)
returns void
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
begin
  perform projectcontrols.assert_role('admin');

  -- Project must be in caller's tenant.
  if not exists (
    select 1 from projectcontrols.projects
    where id = p_project_id and tenant_id = tid
  ) then
    raise exception 'project not in tenant' using errcode = 'P0001';
  end if;

  -- COA code must exist in tenant (the FK will catch cross-tenant, but
  -- raising explicitly gives a friendlier error than a constraint name).
  if not exists (
    select 1 from projectcontrols.coa_codes
    where id = p_coa_code_id and tenant_id = tid
  ) then
    raise exception 'coa code not in tenant' using errcode = 'P0001';
  end if;

  if p_pf_adj is not null and p_pf_adj < 0 then
    raise exception 'pf_adj must be >= 0 (got %)', p_pf_adj using errcode = '22023';
  end if;

  -- Snapshot the row's previous override for audit. FOR UPDATE locks
  -- the row so two concurrent admin calls can't both read the same
  -- before-state and emit conflicting audit_log entries. Sandra's
  -- "old → new" trail needs to be linearizable.
  select to_jsonb(pcc) into before
  from projectcontrols.project_coa_codes pcc
  where pcc.project_id = p_project_id and pcc.coa_code_id = p_coa_code_id
  for update;

  if before is null then
    raise exception 'code is not in this project''s scope — pick it first'
      using errcode = 'P0001';
  end if;

  update projectcontrols.project_coa_codes
     set pf_adj_override = p_pf_adj
   where project_id = p_project_id
     and coa_code_id = p_coa_code_id;

  perform projectcontrols.write_audit_log(
    'project_coa_codes',
    null,
    'pf_adj_override',
    before,
    jsonb_build_object(
      'project_id', p_project_id,
      'coa_code_id', p_coa_code_id,
      'pf_adj_override', p_pf_adj
    )
  );
end
$$;

revoke all on function projectcontrols.project_coa_pf_set(uuid, uuid, numeric) from public;
grant execute on function projectcontrols.project_coa_pf_set(uuid, uuid, numeric) to authenticated;
