-- ELL-48 / Sandra UAT #18 — admit pc_reviewer (auditor) to project_coa_codes
-- writes so ProjectCoaPickerCard edits succeed server-side.

drop policy if exists "pcc_admin_write" on projectcontrols.project_coa_codes;

create policy "pcc_admin_write" on projectcontrols.project_coa_codes
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and (
      projectcontrols.current_user_role() = 'super_admin'
      or (
        projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer')
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
        projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer')
        and exists (
          select 1 from projectcontrols.project_members pm
          where pm.project_id = project_coa_codes.project_id
            and pm.user_id = auth.uid()
            and pm.tenant_id = projectcontrols.current_tenant_id()
        )
      )
    )
  );
