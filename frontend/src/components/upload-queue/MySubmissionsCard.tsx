import { useMySubmissions } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusChip } from '@/components/ui/StatusChip';

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

/**
 * Clerk-side view of their last 10 submissions. Realtime-subscribed via
 * useMySubmissions so a queue-state change shows up without a refresh.
 * Rejection reason rendered inline so the clerk can act on it without
 * pinging the auditor.
 */
export function MySubmissionsCard() {
  const { data, isLoading } = useMySubmissions();

  if (isLoading) {
    return (
      <Card>
        <div className="is-skeleton" style={{ height: 120 }} />
      </Card>
    );
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return null;
  }

  return (
    <Card padded={false}>
      <div className="px-6 pt-5 pb-3">
        <CardHeader
          eyebrow="Recent activity"
          title="My submissions"
          caption="Last 10 files you've sent to the auditor queue."
        />
      </div>
      <div className="overflow-x-auto">
        <table className="is-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Project</th>
              <th>Craft</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Reviewer / Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-xs">{r.original_filename}</td>
                <td>{r.project_code ?? '—'}</td>
                <td>
                  <span className="is-chip font-mono">{r.declared_craft}</span>
                </td>
                <td className="text-xs text-[color:var(--color-text-muted)]">
                  {fmtAgo(r.created_at)}
                </td>
                <td>
                  <StatusChip kind={r.status} />
                </td>
                <td className="text-xs">
                  {r.status === 'rejected' && r.rejection_reason ? (
                    <span className="text-[color:var(--color-variance-unfavourable)]">
                      {r.rejection_reason}
                    </span>
                  ) : r.status === 'approved' && r.reviewer_display_name ? (
                    <span className="text-[color:var(--color-text-muted)]">
                      Approved by {r.reviewer_display_name}
                    </span>
                  ) : (
                    <span className="text-[color:var(--color-text-muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
