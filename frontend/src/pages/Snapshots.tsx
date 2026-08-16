import { useMemo, useState } from 'react';
import { Camera, Download, Info, RotateCcw, Trash2 } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import {
  hasRole,
  useCurrentUser,
  useDeleteSnapshot,
  useRevertSnapshot,
  useSnapshotComparison,
  useSnapshots,
  type Snapshot,
} from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { NoProjectSelected } from '@/components/ui/NoProjectSelected';
import { QueryError } from '@/components/ui/QueryError';
import { SnapshotActionModal, type SnapshotAction } from '@/components/snapshots/SnapshotActionModal';
import { fmt } from '@/lib/format';
import { downloadCsv } from '@/lib/export';

function HowToCard() {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-9 h-9 rounded-md flex items-center justify-center"
          style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
        >
          <Info size={16} />
        </div>
        <div className="text-sm">
          <h3 className="font-semibold mb-1">How comparison works</h3>
          <p className="text-[color:var(--color-text-muted)] leading-relaxed">
            Each row in the history below has two radio buttons — column{' '}
            <span className="is-chip is-chip-primary" style={{ padding: '1px 6px', fontSize: 11 }}>A (Earlier)</span>{' '}
            and column{' '}
            <span className="is-chip is-chip-primary" style={{ padding: '1px 6px', fontSize: 11 }}>B (Later)</span>.
            Selections will automatically swap if chosen out of chronological order to ensure A is always the earlier snapshot and B is the later snapshot.
            Once both are set, a comparison card appears showing per-record drift in earned percent and earned hours between the two captures.
            Drift magnitudes are always positive; week-ending dates label each side. Reviewer roles also have cleanup actions: Revert restores saved before-state, while Delete history removes comparison history only.
          </p>

          <div className="mt-4 border-t border-[color:var(--color-border)] pt-4">
            <h3 className="font-semibold mb-2">Snapshot cleanup</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-raised)] p-3">
                <p className="font-semibold text-sm">Revert audit</p>
                <p className="mt-1 text-sm text-[color:var(--color-text-muted)] leading-relaxed">
                  Removes the audit snapshot and restores earned percent, earned quantity/hours, and milestones to the state immediately before that upload. It never changes the actual-hours ledger and must be done newest audit first.
                </p>
              </div>
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-raised)] p-3">
                <p className="font-semibold text-sm">Delete history</p>
                <p className="mt-1 text-sm text-[color:var(--color-text-muted)] leading-relaxed">
                  Removes the snapshot and comparison history only. It does not roll back current progress or actual hours, so it is the safe option for legacy uploads or history you no longer want to compare.
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-[color:var(--color-text-muted)]">
              Only new weekly uploads with saved before-state show Revert. The older snapshots currently in this project are legacy, so they show Delete history only. The first-audit baseline cannot be cleaned up here.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}


function snapshotOrderDate(s: Snapshot): string {
  return s.week_ending ?? s.snapshot_date;
}

function snapshotPickerLabel(s: Snapshot): string {
  const we = snapshotOrderDate(s);
  return `${we} · ${s.label}`;
}

const KIND_LABEL: Record<Snapshot['kind'], string> = {
  weekly: 'Weekly',
  baseline_first_audit: 'First-audit baseline',
};

export function SnapshotsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: me } = useCurrentUser();
  const snapshots = useSnapshots(projectId);
  const deleteSnapshot = useDeleteSnapshot();
  const revertSnapshot = useRevertSnapshot();
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [action, setAction] = useState<{ kind: SnapshotAction; snapshot: Snapshot } | null>(null);

  const canManage = hasRole(me?.role, 'pc_reviewer');

  const sortedById = useMemo(() => {
    const map = new Map<string, Snapshot>();
    for (const s of snapshots.data ?? []) map.set(s.id, s);
    return map;
  }, [snapshots.data]);

  const comparison = useSnapshotComparison(projectId, a, b);

  if (!projectId) {
    return <NoProjectSelected message="Pick a project in the top bar to view its snapshot history." />;
  }

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
      <QueryError
        title="Couldn't load snapshots"
        error={snapshots.error}
        onRetry={() => snapshots.refetch()}
      />
    );
  }

  const rows = snapshots.data ?? [];

  return (
    <div className="space-y-4">
      <HowToCard />
      <Card padded={false}>
        <div className="px-6 pt-5 pb-3">
          <CardHeader
            eyebrow="Weekly snapshots"
            title="History"
            caption="Frozen captures of project state. Pick two to compare, or use the Actions column to manage audit history."
          />
        </div>
        <div className="overflow-x-auto">
          <table className="is-table">
            <thead>
              <tr>
                <th style={{ width: 85 }} className="text-center text-xs">A (Earlier)</th>
                <th style={{ width: 85 }} className="text-center text-xs">B (Later)</th>
                <th>Date</th>
                <th>Kind</th>
                <th>Week ending</th>
                <th>Label</th>
                <th className="text-right">Budget hrs</th>
                <th className="text-right">Earned hrs</th>
                <th className="text-right">Actual hrs</th>
                <th className="text-right">CPI</th>
                <th className="text-right">SPI</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={canManage ? 12 : 11}
                    className="text-center text-[color:var(--color-text-muted)] py-10"
                  >
                    <Camera size={20} className="inline mb-1 opacity-60" />
                    <div>No snapshots yet — upload progress data to create one.</div>
                  </td>
                </tr>
              )}
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={{ width: 85 }} className="text-center">
                    <input
                      type="radio"
                      name="snap-a"
                      checked={a === s.id}
                      onChange={() => {
                        if (b === s.id) {
                          setB(null);
                          setA(s.id);
                          return;
                        }
                        if (b) {
                          const snapB = rows.find((x) => x.id === b);
                          if (snapB && snapshotOrderDate(s) > snapshotOrderDate(snapB)) {
                            setA(b);
                            setB(s.id);
                            return;
                          }
                        }
                        setA(s.id);
                      }}
                      aria-label={`Mark ${snapshotPickerLabel(s)} as A`}
                    />
                  </td>
                  <td style={{ width: 85 }} className="text-center">
                    <input
                      type="radio"
                      name="snap-b"
                      checked={b === s.id}
                      onChange={() => {
                        if (a === s.id) {
                          setA(null);
                          setB(s.id);
                          return;
                        }
                        if (a) {
                          const snapA = rows.find((x) => x.id === a);
                          if (snapA && snapshotOrderDate(s) < snapshotOrderDate(snapA)) {
                            setB(a);
                            setA(s.id);
                            return;
                          }
                        }
                        setB(s.id);
                      }}
                      aria-label={`Mark ${snapshotPickerLabel(s)} as B`}
                    />
                  </td>
                  <td className="font-mono whitespace-nowrap">{fmt.date(s.snapshot_date)}</td>
                  <td>{KIND_LABEL[s.kind]}</td>
                  <td className="font-mono whitespace-nowrap">{fmt.date(s.week_ending)}</td>
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
                  {canManage && (
                    <td className="whitespace-nowrap">
                      {s.kind === 'weekly' && (
                        <div className="flex items-center gap-1">
                          {s.reversible && (
                            <Button
                              variant="danger"
                              size="sm"
                              title="Revert this audit and remove its snapshot"
                              aria-label={`Revert ${snapshotPickerLabel(s)}`}
                              onClick={() => setAction({ kind: 'revert', snapshot: s })}
                            >
                              <RotateCcw size={13} /> Revert audit
                            </Button>
                          )}
                          {!s.reversible && (
                            <span
                              className="text-xs text-[color:var(--color-text-muted)]"
                              title="This legacy snapshot has no saved before-state"
                            >
                              Legacy · no revert
                            </span>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            title="Delete snapshot history without changing current progress"
                            aria-label={`Delete history for ${snapshotPickerLabel(s)}`}
                            onClick={() => setAction({ kind: 'delete', snapshot: s })}
                          >
                            <Trash2 size={13} /> Delete history
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
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
              title={`${sortedById.get(a) ? snapshotPickerLabel(sortedById.get(a)!) : '—'} → ${sortedById.get(b) ? snapshotPickerLabel(sortedById.get(b)!) : '—'}`}
              caption="Per-record drift between A (earlier week ending) and B (later). Δ columns show positive magnitude only."
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!comparison.data || comparison.data.length === 0}
                  onClick={() => {
                    const labelA = sortedById.get(a)?.label ?? 'A';
                    const labelB = sortedById.get(b)?.label ?? 'B';
                    const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                    downloadCsv(
                      `snapshot-comparison-${safe(labelA)}-vs-${safe(labelB)}.csv`,
                      [
                        'DWG',
                        'Description',
                        'Pct A',
                        'Pct B',
                        'Δ Pct',
                        'Earned hrs A',
                        'Earned hrs B',
                        'Δ Earned hrs',
                      ],
                      (comparison.data ?? []).map((r) => [
                        r.dwg ?? '',
                        r.description,
                        r.pct_a.toFixed(1),
                        r.pct_b.toFixed(1),
                        r.delta_pct.toFixed(1),
                        r.earned_hrs_a.toFixed(0),
                        r.earned_hrs_b.toFixed(0),
                        r.delta_earned_hrs.toFixed(0),
                      ]),
                    );
                  }}
                >
                  <Download size={14} /> Export CSV
                </Button>
              }
            />
          </div>
          {comparison.isLoading && (
            <div className="px-6 pb-6">
              <div className="is-skeleton" style={{ height: 220, width: '100%' }} />
            </div>
          )}
          {comparison.error && (
            <QueryError
              title="Couldn't load the comparison"
              error={comparison.error}
              onRetry={() => comparison.refetch()}
              className="mx-6 mb-6"
            />
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
                    <th className="text-right">Δ Pct (mag.)</th>
                    <th className="text-right">Earned hrs A</th>
                    <th className="text-right">Earned hrs B</th>
                    <th className="text-right">Δ Earned hrs (mag.)</th>
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
                      <td className="text-right font-mono">{r.delta_pct.toFixed(1)}</td>
                      <td className="text-right font-mono">{fmt.int(r.earned_hrs_a)}</td>
                      <td className="text-right font-mono">{fmt.int(r.earned_hrs_b)}</td>
                      <td className="text-right font-mono">{fmt.int(r.delta_earned_hrs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <SnapshotActionModal
        open={!!action}
        action={action?.kind ?? null}
        snapshot={action?.snapshot ?? null}
        pending={deleteSnapshot.isPending || revertSnapshot.isPending}
        error={(deleteSnapshot.error ?? revertSnapshot.error) as Error | null}
        onClose={() => {
          if (!deleteSnapshot.isPending && !revertSnapshot.isPending) {
            deleteSnapshot.reset();
            revertSnapshot.reset();
            setAction(null);
          }
        }}
        onConfirm={() => {
          if (!projectId || !action) return;
          const variables = { projectId, snapshotId: action.snapshot.id };
          const onSuccess = () => {
            if (a === action.snapshot.id) setA(null);
            if (b === action.snapshot.id) setB(null);
            setAction(null);
          };
          if (action.kind === 'revert') {
            revertSnapshot.mutate(variables, { onSuccess });
          } else {
            deleteSnapshot.mutate(variables, { onSuccess });
          }
        }}
      />
    </div>
  );
}
