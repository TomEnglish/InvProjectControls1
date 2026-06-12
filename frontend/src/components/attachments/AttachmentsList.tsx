import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Upload, Download, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  useAttachments,
  useCurrentUser,
  hasRole,
  type AttachmentEntity,
  type AttachmentRow,
} from '@/lib/queries';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

type Props = {
  entity: AttachmentEntity;
  entityId: string | null;
  /** Compact = no eyebrow, smaller padding. Used inside RecordDetail. */
  compact?: boolean;
};

const SIGNED_URL_TTL = 60 * 15; // 15 minutes

function sanitise(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '_')
    .slice(-160);
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsList({ entity, entityId, compact }: Props) {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canUpload = hasRole(me?.role, 'pc_reviewer');
  // Mirrors RLS `attachments_reviewer_delete`: pc_reviewer+ may delete only
  // their own uploads — showing the button more broadly would just produce
  // server-side no-ops.
  const canDelete = (a: AttachmentRow) =>
    !!me && a.uploaded_by === me.id && hasRole(me.role, 'pc_reviewer');
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<AttachmentRow | null>(null);

  const { data: items, isLoading } = useAttachments(entity, entityId);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!entityId || !me?.tenant_id) throw new Error('not ready');
      const id = crypto.randomUUID();
      const path = `${me.tenant_id}/${entity}/${entityId}/${id}-${sanitise(file.name)}`;
      const { error: storageErr } = await supabase.storage
        .from('attachments')
        .upload(path, file, { contentType: file.type || undefined });
      if (storageErr) throw storageErr;
      const { error: rowErr } = await supabase.from('attachments').insert({
        id,
        tenant_id: me.tenant_id,
        entity,
        entity_id: entityId,
        path,
        original_filename: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: me.id,
      });
      if (rowErr) {
        // Best-effort cleanup if the row insert fails after the file was stored.
        await supabase.storage.from('attachments').remove([path]).catch(() => undefined);
        throw rowErr;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', entity, entityId] }),
  });

  const download = useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.storage
        .from('attachments')
        .createSignedUrl(path, SIGNED_URL_TTL);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener');
    },
  });

  const del = useMutation({
    mutationFn: async (att: { id: string; path: string }) => {
      // Row first: RLS makes deletes owner-only, and a filtered-out delete is
      // a silent 0-row no-op — removing the storage object first would orphan
      // the metadata row. A storage failure after the row delete leaves an
      // orphaned object instead, which the orphan-sweep covers.
      const { data, error: rowErr } = await supabase
        .from('attachments')
        .delete()
        .eq('id', att.id)
        .select('id');
      if (rowErr) throw rowErr;
      if (!data || data.length === 0) {
        throw new Error('You can only delete files you uploaded.');
      }
      const { error: storageErr } = await supabase.storage.from('attachments').remove([att.path]);
      if (storageErr) throw storageErr;
    },
    onSuccess: () => setConfirmDelete(null),
    onSettled: () => qc.invalidateQueries({ queryKey: ['attachments', entity, entityId] }),
  });

  return (
    <div className={compact ? '' : 'is-surface p-6'}>
      {!compact && (
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="is-eyebrow mb-1">Attachments</div>
            <h3 className="text-base font-semibold">Files</h3>
          </div>
          {canUpload && (
            <button
              type="button"
              className="is-btn is-btn-secondary is-btn-sm"
              onClick={() => fileInput.current?.click()}
              disabled={!entityId || upload.isPending}
            >
              <Upload size={14} /> {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
          )}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          if (e.target) e.target.value = '';
        }}
      />

      {compact && canUpload && (
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            className="is-btn is-btn-outline is-btn-sm"
            onClick={() => fileInput.current?.click()}
            disabled={!entityId || upload.isPending}
          >
            <Paperclip size={14} /> {upload.isPending ? 'Uploading…' : 'Attach file'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="is-skeleton" style={{ height: 24 }} />
      ) : (items ?? []).length === 0 ? (
        <div className="text-sm text-[color:var(--color-text-muted)] py-2">
          No files attached yet.
        </div>
      ) : (
        <ul className="grid gap-1.5">
          {(items ?? []).map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-raised)]"
            >
              <Paperclip size={14} className="text-[color:var(--color-text-muted)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate font-medium">{a.original_filename}</div>
                <div className="text-xs text-[color:var(--color-text-muted)]">
                  {new Date(a.uploaded_at).toLocaleDateString()}
                  {a.size_bytes != null && ` · ${formatSize(a.size_bytes)}`}
                </div>
              </div>
              <button
                type="button"
                aria-label="Download"
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-soft)] transition-colors"
                onClick={() => download.mutate(a.path)}
                disabled={download.isPending}
              >
                <Download size={14} />
              </button>
              {canDelete(a) && (
                <button
                  type="button"
                  aria-label="Delete"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-soft)] transition-colors"
                  onClick={() => {
                    del.reset();
                    setConfirmDelete(a);
                  }}
                  disabled={del.isPending}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {upload.error && (
        <div className="is-toast is-toast-danger mt-2">
          {(upload.error as Error).message}
        </div>
      )}
      {download.error && (
        <div className="is-toast is-toast-danger mt-2">
          {(download.error as Error).message}
        </div>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          title="Delete file"
          width={440}
        >
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
            <span className="font-medium text-[color:var(--color-text)]">
              {confirmDelete.original_filename}
            </span>{' '}
            will be removed for everyone with access. This can't be undone.
          </p>
          {del.error && (
            <div className="is-toast is-toast-danger mt-3">{(del.error as Error).message}</div>
          )}
          <div className="mt-4 flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={del.isPending}
              onClick={() => del.mutate({ id: confirmDelete.id, path: confirmDelete.path })}
            >
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
