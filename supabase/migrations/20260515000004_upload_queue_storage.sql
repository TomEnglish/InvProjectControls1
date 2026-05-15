-- A20 Wave 1 — upload-queue storage bucket + RLS policies.
--
-- Path scheme: <tenant_id>/<project_id>/<queue_id>/<filename>
--   (storage.foldername(name))[1] = tenant_id (uuid)
--   (storage.foldername(name))[2] = project_id (uuid)
--   (storage.foldername(name))[3] = queue_id (uuid)
--
-- Tenant prefix lets storage.objects RLS gate access cheaply. Mirrors the
-- existing `attachments` bucket pattern in 20260428300000_attachments.sql.
--
-- The clerk-submission flow does NOT upload directly from the browser —
-- the queue-progress-upload edge fn (Wave 2) receives the file as
-- multipart/form-data and writes it via service role. We still scope the
-- INSERT policy to editor+ so a misconfigured client can't bypass the fn.

insert into storage.buckets (id, name, public)
values ('upload-queue', 'upload-queue', false)
on conflict (id) do nothing;

-- SELECT: tenant-wide so auditors can preview parsed.json + the original
-- file from the inbox. Clerks land here as well via the same gate; in
-- practice they only get signed URLs to their own files from the edge fn.
create policy "uq_storage_tenant_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'upload-queue'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
  );

-- INSERT: editor+ only. Clerks never write directly — they POST the file
-- to the queue-progress-upload edge fn, which uploads via service role
-- (which bypasses RLS). The editor+ gate here exists so a CLI / API
-- caller with an editor session can still write objects if needed.
create policy "uq_storage_editor_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'upload-queue'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in
        ('editor','pc_reviewer','pm','admin','super_admin')
  );

-- DELETE: admin / super_admin only. Submitted files are retained for the
-- audit trail; cleanup is an explicit admin action, not a per-request
-- side effect.
create policy "uq_storage_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'upload-queue'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin','super_admin')
  );
