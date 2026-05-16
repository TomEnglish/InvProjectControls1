import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { signedUploadQueueUrl, type UploadQueueRow } from '@/lib/queries';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

type Props = {
  row: UploadQueueRow | null;
  onClose: () => void;
};

/**
 * Auditor review modal. Loads parsed.json from Storage for the row's
 * preview, surfaces both heuristic + LLM warnings, and offers Approve /
 * Reject(reason) buttons that call queue-approve-upload. Approval +
 * rejection are routed through the edge fn so the import body + state
 * transition stay atomic with the audit_log writes.
 */
export function QueueReviewModal({ row, onClose }: Props) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    // Reset every per-row state on each row change — including row-swap
    // without going through null first — so Row1's preview / download URL /
    // rejection draft don't bleed into Row2's view while the new fetch
    // resolves.
    setPreview(null);
    setDownloadUrl(null);
    setPreviewErr(null);
    setRejecting(false);
    setRejectionReason('');
    if (!row) return;
    let cancelled = false;
    (async () => {
      try {
        const parsedUrl = await signedUploadQueueUrl(row.parsed_path, 60);
        const fileUrl = await signedUploadQueueUrl(row.file_path, 300);
        if (cancelled) return;
        setDownloadUrl(fileUrl);
        const resp = await fetch(parsedUrl);
        const json = (await resp.json()) as Record<string, unknown>[];
        if (cancelled) return;
        setPreview(json);
      } catch (e) {
        if (!cancelled) setPreviewErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row]);

  const action = useMutation({
    mutationFn: async (input: { action: 'approve' | 'reject'; reason?: string }) => {
      if (!row) throw new Error('no row');
      const { data, error } = await supabase.functions.invoke('queue-approve-upload', {
        body: {
          queueId: row.id,
          action: input.action,
          rejectionReason: input.reason,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['upload-queue'] });
      qc.invalidateQueries({ queryKey: ['progress-rows'] });
      qc.invalidateQueries({ queryKey: ['snapshots'] });
      onClose();
    },
  });

  if (!row) return null;

  const heuristicCount =
    (row.heuristic_warnings?.disciplineMismatch.length ?? 0) +
    (row.heuristic_warnings?.workTypeMismatch.length ?? 0);

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={`Review submission — ${row.original_filename}`}
      caption={`${row.uploader_display_name ?? row.uploader_email ?? row.uploaded_by} · ${row.project_code ?? '—'} · ${row.declared_craft}`}
      width={960}
    >
      <div className="grid gap-4">
        {/* Warnings panel */}
        {(heuristicCount > 0 || row.llm_warnings || row.override_warnings) && (
          <div className="grid gap-2">
            {row.override_warnings && (
              <div className="is-toast is-toast-warn">
                <strong>Submitted over heuristic warning</strong>
                <div className="text-xs mt-1">
                  The clerk confirmed the file despite a discipline-mismatch flag.
                </div>
              </div>
            )}
            {heuristicCount > 0 && row.heuristic_warnings && (
              <div className="is-toast is-toast-warn">
                <strong>Heuristic mismatch ({heuristicCount} row{heuristicCount === 1 ? '' : 's'})</strong>
                <ul className="mt-1 text-xs list-disc ml-5">
                  {row.heuristic_warnings.disciplineMismatch.slice(0, 5).map((w, i) => (
                    <li key={`d${i}`}>
                      Row {w.rowIndex + 1}: DISCIPLINE column says
                      <code className="ml-1">{w.rowValue}</code>
                    </li>
                  ))}
                  {row.heuristic_warnings.workTypeMismatch.slice(0, 5).map((w, i) => (
                    <li key={`w${i}`}>
                      Row {w.rowIndex + 1}: WORK_TYPE{' '}
                      <code className="mx-1">{w.code}</code> belongs to {w.codeCraft}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {row.llm_warnings && row.llm_warnings.verdict !== 'consistent' && (
              <div className="is-toast is-toast-warn">
                <strong>
                  LLM verdict: {row.llm_warnings.verdict.replace('_', ' ')}
                </strong>
                {row.llm_warnings.concerns.length > 0 && (
                  <ul className="mt-1 text-xs list-disc ml-5">
                    {row.llm_warnings.concerns.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {row.llm_scan_state === 'pending' && (
              <div className="is-toast">
                <span className="text-xs">LLM scan still in progress — preview is available now.</span>
              </div>
            )}
            {row.llm_scan_state === 'failed' && (
              <div className="is-toast">
                <span className="text-xs text-[color:var(--color-text-muted)]">
                  LLM scan didn't complete — review using heuristic results only.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Parse summary + download */}
        <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-[color:var(--color-text-muted)]">
          <span>
            Parsed <strong>{Number(row.parse_summary?.row_count ?? 0)}</strong> rows
            {Array.isArray(row.parse_summary?.unmapped_headers) &&
              row.parse_summary.unmapped_headers.length > 0 && (
                <>
                  {' · '}
                  <span className="text-[color:var(--color-warn)]">
                    Ignored: {row.parse_summary.unmapped_headers.join(', ')}
                  </span>
                </>
              )}
          </span>
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="is-btn is-btn-outline is-btn-sm"
            >
              <Download size={14} /> Download original
            </a>
          )}
        </div>

        {/* Preview table */}
        <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]" style={{ maxHeight: 320 }}>
          {previewErr && (
            <div className="is-toast is-toast-danger m-2">{previewErr}</div>
          )}
          {!preview && !previewErr && (
            <div className="p-4 text-xs text-[color:var(--color-text-muted)]">Loading preview…</div>
          )}
          {preview && preview.length > 0 && (
            <table className="is-table">
              <thead>
                <tr>
                  <th>DWG</th>
                  <th>Description</th>
                  <th>Tag / Spool</th>
                  <th>Work Type</th>
                  <th className="text-right">Budget Hrs</th>
                  <th className="text-right">% Cmp</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    <td className="font-mono text-xs">{String(r.dwg ?? '—')}</td>
                    <td className="text-xs">{String(r.name ?? '—')}</td>
                    <td className="font-mono text-xs">{String(r.tag_no ?? r.spool_fr ?? '—')}</td>
                    <td className="font-mono text-xs">{String(r.work_type ?? '—')}</td>
                    <td className="text-right font-mono text-xs">{String(r.budget_hrs ?? '—')}</td>
                    <td className="text-right font-mono text-xs">{String(r.percent_complete ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Reject form OR action buttons */}
        {rejecting ? (
          <div className="grid gap-2">
            <label
              htmlFor="queue-reject-reason"
              className="text-xs font-semibold text-[color:var(--color-text-muted)]"
            >
              Reason for rejection (shown to the clerk)
            </label>
            <textarea
              id="queue-reject-reason"
              className="is-form-input"
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Row 23 has bad budget_hrs; fix and resubmit."
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRejecting(false)}>
                Back
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!rejectionReason.trim() || action.isPending}
                onClick={() =>
                  action.mutate({ action: 'reject', reason: rejectionReason.trim() })
                }
              >
                {action.isPending ? 'Rejecting…' : 'Confirm reject'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {action.isError && (
              <span className="text-xs text-[color:var(--color-variance-unfavourable)] mr-auto">
                {(action.error as Error).message}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={action.isPending}
              onClick={() => setRejecting(true)}
            >
              Reject…
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={action.isPending}
              onClick={() => action.mutate({ action: 'approve' })}
            >
              {action.isPending ? 'Approving…' : 'Approve & import'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
