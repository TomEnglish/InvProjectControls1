import { useMemo, useState } from 'react';
import { Camera } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import { useSnapshotComparison, useSnapshots, type Snapshot } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { fmt } from '@/lib/format';

function NoProject() {
  return (
    <Card>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Pick a project in the top bar to view its snapshot history.
      </p>
    </Card>
  );
}

const KIND_LABEL: Record<Snapshot['kind'], string> = {
  weekly: 'Weekly',
  baseline_first_audit: 'First-audit baseline',
};

export function SnapshotsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const snapshots = useSnapshots(projectId);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);

  const sortedById = useMemo(() => {
    const map = new Map<string, Snapshot>();
    for (const s of snapshots.data ?? []) map.set(s.id, s);
    return map;
  }, [snapshots.data]);

  const comparison = useSnapshotComparison(projectId, a, b);

  if (!projectId) return <NoProject />;

  if (snapshots.isLoading) {
    return (
      <Card>
        <div className="is-skeleton mb-3" style={{ width: 200 }} />
        <div className="is-skeleton" style={{ height: 220, width: '100%' }} />
      </Card>
    );
  }

  if (snapshots.error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load snapshots: {(snapshots.error as Error).message}
      </div>
    );
  }

  const rows = snapshots.data ?? [];

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="px-6 pt-5 pb-3">
          <CardHeader
            eyebrow="Period snapshots"
            title="History"
            caption="Frozen captures of project state. Pick two to compare."
          />
        </div>
        <div className="overflow-x-auto">
          <table className="is-table">
            <thead>
              <tr>
                <th />
                <th />
                <th>Date</th>
                <th>Kind</th>
                <th>Week ending</th>
                <th>Label</th>
                <th className="text-right">Budget hrs</th>
                <th className="text-right">Earned hrs</th>
                <th className="text-right">Actual hrs</th>
                <th className="text-right">CPI</th>
                <th className="text-right">SPI</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="text-center text-[color:var(--color-text-muted)] py-10"
                  >
                    <Camera size={20} className="inline mb-1 opacity-60" />
                    <div>No snapshots yet — upload progress data to create one.</div>
                  </td>
                </tr>
              )}
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={{ width: 30 }}>
                    <input
                      type="radio"
                      name="snap-a"
                      checked={a === s.id}
                      onChange={() => {
                        if (b === s.id) setB(null);
                        setA(s.id);
                      }}
                      aria-label={`Mark ${s.label} as A`}
                    />
                  </td>
                  <td style={{ width: 30 }}>
                    <input
                      type="radio"
                      name="snap-b"
                      checked={b === s.id}
                      onChange={() => {
                        if (a === s.id) setA(null);
                        setB(s.id);
                      }}
                      aria-label={`Mark ${s.label} as B`}
                    />
                  </td>
                  <td className="font-mono">{s.snapshot_date}</td>
                  <td>{KIND_LABEL[s.kind]}</td>
                  <td className="font-mono">{s.week_ending ?? '—'}</td>
                  <td>{s.label}</td>
                  <td className="text-right font-mono">
                    {s.total_budget_hrs != null ? fmt.int(s.total_budget_hrs) : '—'}
                  </td>
                  <td className="text-right font-mono">
                    {s.total_earned_hrs != null ? fmt.int(s.total_earned_hrs) : '—'}
                  </td>
                  <td className="text-right font-mono">
                    {s.total_actual_hrs != null ? fmt.int(s.total_actual_hrs) : '—'}
                  </td>
                  <td className="text-right font-mono">{fmt.ratio(s.cpi ?? undefined)}</td>
                  <td className="text-right font-mono">{fmt.ratio(s.spi ?? undefined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {a && b && (
        <Card padded={false}>
          <div className="px-6 pt-5 pb-3">
            <CardHeader
              eyebrow="Comparison"
              title={`${sortedById.get(a)?.label ?? '—'} → ${sortedById.get(b)?.label ?? '—'}`}
              caption="Per-record drift between the two selected snapshots."
            />
          </div>
          {comparison.isLoading && (
            <div className="px-6 pb-6">
              <div className="is-skeleton" style={{ height: 220, width: '100%' }} />
            </div>
          )}
          {comparison.error && (
            <div className="px-6 pb-6 is-toast is-toast-danger">
              {(comparison.error as Error).message}
            </div>
          )}
          {comparison.data && (
            <div className="overflow-x-auto">
              <table className="is-table">
                <thead>
                  <tr>
                    <th>DWG</th>
                    <th>Description</th>
                    <th className="text-right">Pct A</th>
                    <th className="text-right">Pct B</th>
                    <th className="text-right">Δ Pct</th>
                    <th className="text-right">Earned hrs A</th>
                    <th className="text-right">Earned hrs B</th>
                    <th className="text-right">Δ Earned hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.data.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="text-center text-[color:var(--color-text-muted)] py-6"
                      >
                        No records overlap between the two snapshots.
                      </td>
                    </tr>
                  )}
                  {comparison.data.map((r) => (
                    <tr key={r.progress_record_id}>
                      <td className="font-mono">{r.dwg ?? '—'}</td>
                      <td>{r.description}</td>
                      <td className="text-right font-mono">{r.pct_a.toFixed(1)}</td>
                      <td className="text-right font-mono">{r.pct_b.toFixed(1)}</td>
                      <td
                        className="text-right font-mono"
                        style={{
                          color:
                            r.delta_pct > 0
                              ? 'var(--color-variance-favourable)'
                              : r.delta_pct < 0
                                ? 'var(--color-variance-unfavourable)'
                                : 'var(--color-text)',
                        }}
                      >
                        {r.delta_pct >= 0 ? '+' : ''}
                        {r.delta_pct.toFixed(1)}
                      </td>
                      <td className="text-right font-mono">{fmt.int(r.earned_hrs_a)}</td>
                      <td className="text-right font-mono">{fmt.int(r.earned_hrs_b)}</td>
                      <td
                        className="text-right font-mono"
                        style={{
                          color:
                            r.delta_earned_hrs > 0
                              ? 'var(--color-variance-favourable)'
                              : r.delta_earned_hrs < 0
                                ? 'var(--color-variance-unfavourable)'
                                : 'var(--color-text)',
                        }}
                      >
                        {r.delta_earned_hrs >= 0 ? '+' : ''}
                        {fmt.int(r.delta_earned_hrs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
