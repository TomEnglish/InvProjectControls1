-- A11 — project_lock_baseline v3.
--
-- Two fixes from Sandra's UAT (app_review_todo.md item 11):
--
-- 1) The v2 body still snapshotted roc_templates + roc_milestones, which
--    were dropped in 20260511000001_work_types_library.sql. Any call to
--    this RPC against the current schema would raise "relation
--    projectcontrols.roc_templates does not exist" and roll back. Replace
--    the dropped joins with work_types + work_type_milestones (and pick
--    up project_disciplines.default_work_type_id while we're here, which
--    matters for restoring the per-discipline default after a rollback).
--
-- 2) Relax the role gate from admin → pm. Per the role matrix in
--    app_review_todo.md item 17, "Auditor" (= pm) is the project
--    lifecycle owner. Locking the baseline is a project-execution
--    action, not a tenant-admin action. Sandra is a PM and needs to be
--    able to test the draft → active flip without a tenant admin in
--    the loop.

create or replace function projectcontrols.project_lock_baseline(
  p_project_id uuid,
  p_lock_date timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = projectcontrols, auth
as $$
declare
  tid uuid := projectcontrols.current_tenant_id();
  before jsonb;
  snapshot jsonb;
  baseline_id uuid;
begin
  -- pm + admin + super_admin can lock. Mirrors the assert_role ladder
  -- after the A20 Wave 1 clerk insertion (viewer < clerk < editor <
  -- pc_reviewer < pm < admin < super_admin).
  perform projectcontrols.assert_role('pm');

  select to_jsonb(p) into before
  from projectcontrols.projects p
  where id = p_project_id and tenant_id = tid;
  if before is null then
    raise exception 'project not found' using errcode = 'P0001';
  end if;
  if (before->>'status') <> 'draft' then
    raise exception 'project must be in draft state to lock baseline'
      using errcode = '22023';
  end if;

  snapshot := jsonb_build_object(
    'project', before,
    'disciplines', (
      -- Include default_work_type_id so the rollback restore has the
      -- discipline → default-craft mapping.
      select jsonb_agg(to_jsonb(pd))
      from projectcontrols.project_disciplines pd
      where pd.project_id = p_project_id
    ),
    'coa_codes', (
      select jsonb_agg(to_jsonb(c))
      from projectcontrols.coa_codes c
      where c.tenant_id = tid
    ),
    'work_types', (
      -- Replaces the dropped roc_templates+roc_milestones snapshot. Each
      -- work_type ships with its milestone list so a restore can rebuild
      -- the variable 1–8 milestone weighting that drives EV math.
      select jsonb_agg(jsonb_build_object(
        'work_type', to_jsonb(w),
        'milestones', (
          select jsonb_agg(to_jsonb(m) order by m.seq)
          from projectcontrols.work_type_milestones m
          where m.work_type_id = w.id
        )
      ))
      from projectcontrols.work_types w
      where w.tenant_id = tid
    ),
    'progress_records', (
      select jsonb_agg(to_jsonb(r))
      from projectcontrols.progress_records r
      where r.project_id = p_project_id
    ),
    'progress_record_milestones', (
      select jsonb_agg(to_jsonb(m))
      from projectcontrols.progress_record_milestones m
      where m.progress_record_id in (
        select id from projectcontrols.progress_records
        where project_id = p_project_id
      )
    )
  );

  insert into projectcontrols.baselines (tenant_id, project_id, locked_at, locked_by, snapshot)
  values (tid, p_project_id, p_lock_date, auth.uid(), snapshot)
  returning id into baseline_id;

  update projectcontrols.projects
     set status = 'active',
         baseline_locked_at = p_lock_date,
         baseline_locked_by = auth.uid(),
         updated_at = now()
   where id = p_project_id;

  perform projectcontrols.write_audit_log(
    'projects', p_project_id, 'lock_baseline',
    before,
    to_jsonb((select p from projectcontrols.projects p where p.id = p_project_id))
  );

  return baseline_id;
end
$$;

revoke all on function projectcontrols.project_lock_baseline(uuid, timestamptz) from public;
grant execute on function projectcontrols.project_lock_baseline(uuid, timestamptz) to authenticated;
