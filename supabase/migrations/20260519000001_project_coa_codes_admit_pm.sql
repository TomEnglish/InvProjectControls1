-- A18 — project_coa_codes write policy admits PM (project-scoped).
--
-- Sandra's UAT (app_review_todo.md item 18): "auditor must be able to
-- select codes on Project Setup". In our role mapping the auditor is
-- the pm — project lifecycle owner. The original policy
-- (20260506000000_project_coa_codes.sql) admitted only super_admin and
-- project-scoped admin; this extends the same project-scoped
-- membership pattern to pm so the frontend ProjectCoaPickerCard
-- check (relaxed to hasRole(me?.role, 'pm') in the same commit) maps
-- to a usable server-side write path.

drop policy if exists "pcc_admin_write" on projectcontrols.project_coa_codes;

create policy "pcc_admin_write" on projectcontrols.project_coa_codes
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and (
      projectcontrols.current_user_role() = 'super_admin'
      or (
        projectcontrols.current_user_role() in ('admin', 'pm')
        and exists (
          select 1 from projectcontrols.project_members pm
          where pm.project_id = project_coa_codes.project_id
            and pm.user_id = auth.uid()
            and pm.tenant_id = projectcontrols.current_tenant_id()
        )
      )
    )
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and (
      projectcontrols.current_user_role() = 'super_admin'
      or (
        projectcontrols.current_user_role() in ('admin', 'pm')
        and exists (
          select 1 from projectcontrols.project_members pm
          where pm.project_id = project_coa_codes.project_id
            and pm.user_id = auth.uid()
            and pm.tenant_id = projectcontrols.current_tenant_id()
        )
      )
    )
  );
