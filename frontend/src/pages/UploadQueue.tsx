import { useMemo, useState } from 'react';
import { Search, AlertTriangle, Bot, Flag } from 'lucide-react';
import {
  useCurrentUser,
  useUploadQueue,
  hasRole,
  type UploadQueueRow,
  type UploadQueueStatus,
} from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusChip } from '@/components/ui/StatusChip';
import { inputClass } from '@/components/ui/FormField';
import { QueueReviewModal } from '@/components/upload-queue/QueueReviewModal';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function fmtAgo(iso: string): string {
  const dt = new Date(iso);
  const diffMs = Date.now() - dt.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusKind(s: UploadQueueStatus) {
  if (s === 'approved') return 'active';
  if (s === 'rejected') return 'closed';
  return 'draft';
}

function WarningChips({ row }: { row: UploadQueueRow }) {
  const heuristicCount =
    (row.heuristic_warnings?.disciplineMismatch.length ?? 0) +
    (row.heuristic_warnings?.workTypeMismatch.length ?? 0);
  const llmConcern =
    row.llm_warnings && row.llm_warnings.verdict !== 'consistent';
  const llmScanning = row.llm_scan_state === 'pending';
  return (
    <div className="flex gap-1 flex-wrap">
      {row.override_warnings && (
        <span
          className="is-chip is-chip-warn font-mono text-[10px]"
          title="Clerk submitted over a heuristic warning"
        >
          <Flag size={10} /> override
        </span>
      )}
      {heuristicCount > 0 && (
        <span
          className="is-chip is-chip-warn font-mono text-[10px]"
          title={`${heuristicCount} heuristic mismatch row${heuristicCount === 1 ? '' : 's'}`}
        >
          <AlertTriangle size={10} /> heuristic
        </span>
      )}
      {llmConcern && (
        <span
          className="is-chip is-chip-warn font-mono text-[10px]"
          title={`LLM verdict: ${row.llm_warnings!.verdict.replace('_', ' ')}`}
        >
          <Bot size={10} /> LLM concern
        </span>
      )}
      {llmScanning && (
        <span
          className="is-chip font-mono text-[10px]"
          title="LLM scan still running"
        >
          <Bot size={10} /> scanning…
        </span>
      )}
    </div>
  );
}

export function UploadQueuePage() {
  const { data: me } = useCurrentUser();
  const { data, isLoading, error } = useUploadQueue();
  const [tab, setTab] = useState<UploadQueueStatus>('queued');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<UploadQueueRow | null>(null);

  // Hooks must run unconditionally before any early return — the role
  // gate and loading states come after the memos.
  const all = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const byStatus = all.filter((r) => {
      if (r.status !== tab) return false;
      if (tab !== 'queued') {
        const ts = r.reviewed_at ? new Date(r.reviewed_at).getTime() : 0;
        return ts >= cutoff;
      }
      return true;
    });
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((r) =>
      [
        r.original_filename,
        r.declared_craft,
        r.project_code,
        r.project_name,
        r.uploader_display_name,
        r.uploader_email,
        r.label,
      ]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [all, tab, search]);

  const counts = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return {
      queued: all.filter((r) => r.status === 'queued').length,
      approved: all.filter(
        (r) =>
          r.status === 'approved' &&
          (r.reviewed_at ? new Date(r.reviewed_at).getTime() : 0) >= cutoff,
      ).length,
      rejected: all.filter(
        (r) =>
          r.status === 'rejected' &&
          (r.reviewed_at ? new Date(r.reviewed_at).getTime() : 0) >= cutoff,
      ).length,
    };
  }, [all]);

  // Role gate. The route itself has no guard so a clerk navigating
  // directly via URL would otherwise see the auditor inbox; bounce
  // with an explanatory empty state instead of a hard 404.
  if (me && !hasRole(me.role, 'editor')) {
    return (
      <Card>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Auditor inbox — restricted to editor and above. Clerks see their own
          submissions on the <strong>Upload</strong> page.
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <div className="is-skeleton mb-3" style={{ width: 220 }} />
        <div className="is-skeleton" style={{ height: 320 }} />
      </Card>
    );
  }
  if (error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load queue: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Upload Queue"
          caption="Submissions waiting for auditor review, plus recent decisions for context."
        />

        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex gap-2">
            {(['queued', 'approved', 'rejected'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={[
                  'px-3 py-1.5 text-sm rounded-md font-medium transition-colors',
                  tab === t
                    ? 'bg-[color:var(--color-primary-soft)] text-[color:var(--color-primary)]'
                    : 'text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-raised)] hover:text-[color:var(--color-text)]',
                ].join(' ')}
              >
                {t === 'queued'
                  ? `Queued (${counts.queued})`
                  : t === 'approved'
                    ? `Approved 7d (${counts.approved})`
                    : `Rejected 7d (${counts.rejected})`}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--color-text-muted)]"
            />
            <input
              className={`${inputClass} pl-8 w-64`}
              placeholder="Search filename, project, clerk…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
          <table className="is-table">
            <thead>
              <tr>
                <th>Clerk</th>
                <th>Project</th>
                <th>Craft</th>
                <th>File</th>
                <th>Size</th>
                <th>Submitted</th>
                <th>Warnings</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-[color:var(--color-text-muted)] py-6">
                    {tab === 'queued' ? 'No queued submissions.' : 'Nothing in the last 7 days.'}
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => tab === 'queued' && setSelected(r)}>
                  <td className="text-xs">
                    {r.uploader_display_name ?? r.uploader_email ?? r.uploaded_by.slice(0, 8)}
                  </td>
                  <td className="text-xs">{r.project_code ?? '—'}</td>
                  <td>
                    <span className="is-chip font-mono text-[10px]">{r.declared_craft}</span>
                  </td>
                  <td className="font-mono text-xs">{r.original_filename}</td>
                  <td className="text-xs text-[color:var(--color-text-muted)]">
                    {fmtSize(r.file_size_bytes)}
                  </td>
                  <td className="text-xs text-[color:var(--color-text-muted)]">
                    {fmtAgo(r.created_at)}
                  </td>
                  <td>
                    <WarningChips row={r} />
                  </td>
                  <td>
                    <StatusChip kind={statusKind(r.status)} />
                  </td>
                  <td className="text-right">
                    {tab === 'queued' ? (
                      <button
                        type="button"
                        className="text-xs text-[color:var(--color-primary)] hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(r);
                        }}
                      >
                        Review →
                      </button>
                    ) : r.status === 'rejected' && r.rejection_reason ? (
                      <span
                        className="text-xs text-[color:var(--color-text-muted)] truncate inline-block max-w-[18ch]"
                        title={r.rejection_reason}
                      >
                        {r.rejection_reason}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <QueueReviewModal row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
