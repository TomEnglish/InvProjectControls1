-- Phase 1.4: Extend existing RLS policies so super_admin has at least the
-- same write access as admin (and tenant-wide where admin was already
-- tenant-wide). Project-scoping enforcement on admin (admin restricted to
-- their projects) is deferred — it requires project_members to be
-- backfilled first, which lands in Phase 2.
--
-- Special case: app_users.users_admin_write also closes a self-promotion
-- hole. With the old policy (admin-only via .from('app_users').update), an
-- admin could promote themselves once 'super_admin' existed in the enum.
-- The new split policy lets admin write rows whose role is below admin
-- only; super_admin can write any row in their tenant.

-- ---------------------------------------------------------------------------
-- app_users (originally 0001_init.sql:177-180)
-- ---------------------------------------------------------------------------
drop policy if exists "users_admin_write" on projectcontrols.app_users;

create policy "users_super_admin_write" on projectcontrols.app_users
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() = 'super_admin'
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() = 'super_admin'
  );

create policy "users_admin_write_below_admin" on projectcontrols.app_users
  for all to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() = 'admin'
    and role not in ('admin', 'super_admin')
  )
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() = 'admin'
    and role not in ('admin', 'super_admin')
  );

-- ---------------------------------------------------------------------------
-- projects + project_disciplines (0002_projects.sql)
-- ---------------------------------------------------------------------------
drop policy if exists "projects_admin_write" on projectcontrols.projects;
create policy "projects_admin_write" on projectcontrols.projects
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'super_admin'));

drop policy if exists "pd_admin_write" on projectcontrols.project_disciplines;
create policy "pd_admin_write" on projectcontrols.project_disciplines
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'super_admin'));

-- ---------------------------------------------------------------------------
-- coa_codes / roc_templates / roc_milestones (0003_libraries.sql)
-- Tenant-wide admin tables; super_admin gets the same access.
-- ---------------------------------------------------------------------------
drop policy if exists "coa_admin_write" on projectcontrols.coa_codes;
create policy "coa_admin_write" on projectcontrols.coa_codes
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'));

drop policy if exists "roc_tmpl_admin_write" on projectcontrols.roc_templates;
create policy "roc_tmpl_admin_write" on projectcontrols.roc_templates
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'));

drop policy if exists "roc_ms_admin_write" on projectcontrols.roc_milestones;
create policy "roc_ms_admin_write" on projectcontrols.roc_milestones
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'));

-- ---------------------------------------------------------------------------
-- audit_records / audit_record_milestones (0004_audit_records.sql)
-- ---------------------------------------------------------------------------
drop policy if exists "ar_editor_write" on projectcontrols.audit_records;
create policy "ar_editor_write" on projectcontrols.audit_records
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor', 'super_admin'));

drop policy if exists "arm_editor_write" on projectcontrols.audit_record_milestones;
create policy "arm_editor_write" on projectcontrols.audit_record_milestones
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor', 'super_admin'));

-- ---------------------------------------------------------------------------
-- baselines / progress_periods / actual_hours / change_orders (0005)
-- ---------------------------------------------------------------------------
drop policy if exists "baselines_admin_write" on projectcontrols.baselines;
create policy "baselines_admin_write" on projectcontrols.baselines
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'super_admin'));

drop policy if exists "pp_admin_write" on projectcontrols.progress_periods;
create policy "pp_admin_write" on projectcontrols.progress_periods
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'super_admin'));

drop policy if exists "ah_editor_write" on projectcontrols.actual_hours;
create policy "ah_editor_write" on projectcontrols.actual_hours
  for all to authenticated
  using (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor', 'super_admin'))
  with check (tenant_id = projectcontrols.current_tenant_id() and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor', 'super_admin'));

drop policy if exists "co_editor_draft" on projectcontrols.change_orders;
create policy "co_editor_draft" on projectcontrols.change_orders
  for insert to authenticated
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor', 'super_admin')
    and status in ('draft', 'pending')
  );

-- ---------------------------------------------------------------------------
-- attachments + storage.objects (20260428300000_attachments.sql)
-- ---------------------------------------------------------------------------
drop policy if exists "attachments_editor_write" on projectcontrols.attachments;
create policy "attachments_editor_write" on projectcontrols.attachments
  for insert to authenticated
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor', 'super_admin')
  );

drop policy if exists "attachments_editor_delete" on projectcontrols.attachments;
create policy "attachments_editor_delete" on projectcontrols.attachments
  for delete to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'super_admin')
  );

drop policy if exists "attachments_storage_editor_write" on storage.objects;
create policy "attachments_storage_editor_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor', 'super_admin')
  );

drop policy if exists "attachments_storage_editor_delete" on storage.objects;
create policy "attachments_storage_editor_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'super_admin')
  );
