-- attachments — file metadata for audit records and change orders.
-- File bytes live in the `attachments` storage bucket; this table records
-- the where/what so we can list, audit, and orphan-sweep.
--
-- Path scheme: <tenant_id>/<entity>/<entity_id>/<uuid>-<sanitised-filename>
-- The tenant_id-prefix lets storage.objects RLS gate access cheaply.

create table projectcontrols.attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references projectcontrols.tenants(id) on delete cascade,
  entity text not null check (entity in ('audit_record', 'change_order', 'report')),
  entity_id uuid not null,
  path text not null unique,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index on projectcontrols.attachments(tenant_id);
create index on projectcontrols.attachments(entity, entity_id);
alter table projectcontrols.attachments enable row level security;

create policy "attachments_tenant_read" on projectcontrols.attachments
  for select to authenticated
  using (tenant_id = projectcontrols.current_tenant_id());

create policy "attachments_editor_write" on projectcontrols.attachments
  for insert to authenticated
  with check (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor')
  );

create policy "attachments_editor_delete" on projectcontrols.attachments
  for delete to authenticated
  using (
    tenant_id = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm')
  );

-- Storage bucket. Idempotent — safe to re-run.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Storage RLS: scope objects to their tenant by path prefix. The first path
-- segment is the tenant_id (uuid as text). storage.objects.name stores the
-- full path; (storage.foldername(name))[1] returns the first segment.
create policy "attachments_storage_tenant_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
  );

create policy "attachments_storage_editor_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm', 'pc_reviewer', 'editor')
  );

create policy "attachments_storage_editor_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid = projectcontrols.current_tenant_id()
    and projectcontrols.current_user_role() in ('admin', 'pm')
  );
