import '@/lib/charts';
import { useMemo, useState } from 'react';
import { Lock, Info, Download } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import {
  useBudgetRollup,
  useDashboardSummary,
  useDashboardSummaryAtSnapshot,
  useCurrentUser,
  useProject,
  useSnapshots,
  hasRole,
  type Project,
} from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { ChartCard, ChartCardSkeleton } from '@/components/dashboard/ChartCard';
import {
  DateRangeFilter,
  ALL_TIME_RANGE,
  isInRange,
  snapshotFilterDate,
  type DateRange,
} from '@/components/ui/DateRangeFilter';
import { fmt } from '@/lib/format';
import { downloadCsv } from '@/lib/export';
import { LockBaselineModal } from '@/components/budget/LockBaselineModal';
import { BudgetByDisciplineChart } from '@/components/budget/BudgetByDisciplineChart';

function ThreeBudgetPrimer() {
  return (
    <div className="is-surface p-6">
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-10 h-10 rounded-md flex items-center justify-center"
          style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
        >
          <Info size={18} />
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-1">The three-budget model</h3>
          <ul className="text-sm text-[color:var(--color-text-muted)] space-y-1.5 leading-relaxed">
            <li>
              <span className="font-semibold text-[color:var(--color-text)]">Baseline Budget</span> —
              the discipline budgets at the moment the baseline was locked. Immutable thereafter.
            </li>
            <li>
              <span className="font-semibold text-[color:var(--color-text)]">Current Budget</span> —
              Baseline + approved Change Orders. The figure all execution metrics (CPI, EAC) measure
              against.
            </li>
            <li>
              <span className="font-semibold text-[color:var(--color-text)]">Forecast Budget</span> —
              Current + pending and PC-reviewed Change Orders. Projected end-state if everything
              currently in flight gets approved.
            </li>
            <li>
              <span className="font-semibold text-[color:var(--color-text)]">Baseline Drift</span> —
              the cumulative hours added to the project via approved Change Orders. Computes as Current Budget − Baseline Budget.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function BudgetPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: me } = useCurrentUser();
  // A11 — matches the relaxed assert_role('pm') gate inside
  // project_lock_baseline v3. PMs run the project lifecycle and need to
  // lock the baseline without an admin in the loop.
  const canLock = hasRole(me?.role, 'pm');
  const [lockModalOpen, setLockModalOpen] = useState(false);

  const { data: project } = useProject(projectId);

  const rollup = useBudgetRollup(projectId);
  const summary = useDashboardSummary(projectId);
  const snapshots = useSnapshots(projectId);
  const [dateRange, setDateRange] = useState<DateRange>(ALL_TIME_RANGE);

  // Latest snapshot whose date falls inside the range — used to show
  // "earned-as-of" alongside the always-current budget tiles. When the range
  // is "all time" we pick the most recent snapshot overall.
  const earnedSnapshot = useMemo(() => {
    const list = (snapshots.data ?? [])
      .slice()
      .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
    return list.find((s) => isInRange(snapshotFilterDate(s), dateRange)) ?? null;
  }, [snapshots.data, dateRange]);

  // A10 — when an in-range snapshot exists and the user has narrowed the
  // range (i.e. they're explicitly asking for a historical view), pull
  // the chart + per-discipline figures from that snapshot. Budget tiles
  // stay live because they represent the current commitment, but the
  // earned-bar in the discipline chart and the export CSV should match
  // the snapshot the user picked or the filter would feel inert.
  const rangeIsFiltered = dateRange.label !== ALL_TIME_RANGE.label;
  const useSnapshotPath = rangeIsFiltered && !!earnedSnapshot;
  const snapshotSummary = useDashboardSummaryAtSnapshot(
    useSnapshotPath ? earnedSnapshot : null,
    projectId,
  );
  // While the snapshot fetch is in flight or has errored, route through
  // it so the page surfaces that state instead of silently rendering live
  // data. Only when the user has NOT narrowed the range, or there's no
  // snapshot to fetch for the range, do we use the live summary.
  const activeSummary = useSnapshotPath ? snapshotSummary : summary;

  if (!projectId || !project) {
    return (
      <div className="is-surface p-8 text-center">
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Pick a project in the top bar to view its budget.
        </p>
      </div>
    );
  }

  if (rollup.isLoading || activeSummary.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="is-surface is-stat-card">
              <div className="is-skeleton" style={{ width: '40%' }} />
              <div className="is-skeleton" style={{ height: 28, width: '60%' }} />
              <div className="is-skeleton" style={{ width: '70%' }} />
            </div>
          ))}
        </div>
        <ChartCardSkeleton title="Budget by Discipline" />
      </div>
    );
  }

  if (rollup.error || activeSummary.error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load budget: {(rollup.error ?? activeSummary.error)!.message}
      </div>
    );
  }

  const r = rollup.data!;
  const s = activeSummary.data!;
  const isDraft = project.status === 'draft';
  const recordCount = s.disciplines.reduce((acc, d) => acc + d.records, 0);

  const exportBudgetCsv = () => {
    const date = new Date().toISOString().slice(0, 10);
    const headers = [
      'Discipline',
      'Budget hrs (current)',
      'Earned hrs',
      'Remaining hrs',
      'Baseline budget hrs',
      'Snapshot week ending',
    ];
    const rows = s.disciplines.map((d) => [
      d.display_name,
      d.current_budget_hrs.toFixed(0),
      d.earned_hrs.toFixed(0),
      d.remaining_hrs.toFixed(0),
      d.budget_hrs.toFixed(0),
      earnedSnapshot ? snapshotFilterDate(earnedSnapshot) : 'live',
    ]);
    rows.push([
      'PROJECT TOTAL',
      r.current_budget.toFixed(0),
      s.total_earned_hrs.toFixed(0),
      s.disciplines.reduce((acc, d) => acc + d.remaining_hrs, 0).toFixed(0),
      r.original_budget.toFixed(0),
      earnedSnapshot ? snapshotFilterDate(earnedSnapshot) : 'live',
    ]);
    downloadCsv(`budget-${date}-${dateRange.label.replace(/\s+/g, '-').toLowerCase()}.csv`, headers, rows);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="is-eyebrow">Week ending</span>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
          {rangeIsFiltered && earnedSnapshot && (
            <span className="text-xs text-[color:var(--color-text-muted)]">
              Chart + disciplines from week ending{' '}
              <span className="font-mono">{snapshotFilterDate(earnedSnapshot)}</span>
              {' — '}
              {earnedSnapshot.label}
            </span>
          )}
          {!rangeIsFiltered && earnedSnapshot && (
            <span className="text-xs text-[color:var(--color-text-muted)]">
              Showing live data — pick a date range to switch to a historical snapshot.
            </span>
          )}
          {rangeIsFiltered && !earnedSnapshot && (snapshots.data ?? []).length > 0 && (
            <span className="text-xs text-[color:var(--color-warn)]">
              No snapshot in this range — chart falls back to live data. Pick a
              wider range or upload a weekly snapshot inside the selected window.
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={exportBudgetCsv}>
          <Download size={14} /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <BudgetTile
          tone="primary"
          label="Baseline Budget"
          hrs={r.original_budget}
          caption="Locked at baseline"
        />
        <BudgetTile
          tone="accent"
          label="Current Budget"
          hrs={r.current_budget}
          caption={
            r.approved_changes_hrs === 0
              ? 'No approved changes'
              : `OB ${r.approved_changes_hrs > 0 ? '+' : ''}${fmt.int(r.approved_changes_hrs)} approved`
          }
        />
        <BudgetTile
          tone="warn"
          label="Forecast Budget"
          hrs={r.forecast_budget}
          caption={
            r.pending_changes_hrs === 0
              ? 'No pending changes'
              : `CB ${r.pending_changes_hrs > 0 ? '+' : ''}${fmt.int(r.pending_changes_hrs)} pending`
          }
        />
        {(() => {
          const drift = r.current_budget - r.original_budget;
          return (
            <BudgetTile
              tone="info"
              label="Baseline Drift"
              hrs={drift}
              caption={
                drift === 0
                  ? 'No drift from baseline'
                  : `${drift > 0 ? '+' : ''}${fmt.int(drift)} hrs added via COs`
              }
            />
          );
        })()}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ChartCard
            title="Budget by Discipline"
            caption="Original / Current / Forecast budget hours per discipline."
          >
            {s.disciplines.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-[color:var(--color-text-muted)]">
                No active disciplines yet.
              </div>
            ) : (
              <BudgetByDisciplineChart
                disciplines={s.disciplines}
                approvedHrs={r.approved_changes_hrs}
                pendingHrs={r.pending_changes_hrs}
              />
            )}
          </ChartCard>
        </div>
        <div className="space-y-4">
          <BaselineControlsCard
            project={project}
            canLock={canLock}
            onLock={() => setLockModalOpen(true)}
          />
          <ThreeBudgetPrimer />
        </div>
      </div>

      <div className="is-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-[color:var(--color-line)]">
          <h3 className="text-sm font-semibold">Budget by discipline</h3>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
            Current budget includes approved change orders. Earned and remaining respect the over-budget cap until scope expands.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="is-table">
            <thead>
              <tr>
                <th>Discipline</th>
                <th className="text-right">Budget hrs</th>
                <th className="text-right">Earned hrs</th>
                <th className="text-right">Remaining hrs</th>
                <th className="text-right">Records</th>
              </tr>
            </thead>
            <tbody>
              {s.disciplines.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-[color:var(--color-text-muted)] py-8">
                    No active disciplines yet.
                  </td>
                </tr>
              )}
              {s.disciplines.map((d) => (
                <tr key={d.discipline_id}>
                  <td className="font-semibold">{d.display_name}</td>
                  <td className="text-right font-mono">{fmt.int(d.current_budget_hrs)}</td>
                  <td className="text-right font-mono">{fmt.int(d.earned_hrs)}</td>
                  <td className="text-right font-mono">{fmt.int(d.remaining_hrs)}</td>
                  <td className="text-right font-mono">{d.records}</td>
                </tr>
              ))}
              {s.disciplines.length > 0 && (
                <tr style={{ background: 'var(--color-raised)' }}>
                  <td className="font-bold">Project total</td>
                  <td className="text-right font-mono font-bold">{fmt.int(r.current_budget)}</td>
                  <td className="text-right font-mono font-bold">{fmt.int(s.total_earned_hrs)}</td>
                  <td className="text-right font-mono font-bold">
                    {fmt.int(s.disciplines.reduce((acc, d) => acc + d.remaining_hrs, 0))}
                  </td>
                  <td className="text-right font-mono font-bold">
                    {s.disciplines.reduce((acc, d) => acc + d.records, 0)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LockBaselineModal
        open={lockModalOpen && isDraft}
        onClose={() => setLockModalOpen(false)}
        projectId={project.id}
        projectCode={project.project_code}
        projectName={project.name}
        totalBudgetHrs={s.total_budget_hrs}
        recordCount={recordCount}
      />
    </div>
  );
}

type Tone = 'primary' | 'accent' | 'warn' | 'success' | 'danger' | 'info';
const toneBorder: Record<Tone, string> = {
  primary: 'var(--color-primary)',
  accent: 'var(--color-accent)',
  warn: 'var(--color-warn)',
  success: 'var(--color-success)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
};

function BudgetTile({
  tone,
  label,
  hrs,
  caption,
}: {
  tone: Tone;
  label: string;
  hrs: number;
  caption: string;
}) {
  return (
    <div
      className="is-surface is-stat-card relative overflow-hidden"
      style={{ borderLeft: `4px solid ${toneBorder[tone]}`, paddingLeft: 20 }}
    >
      <div className="is-stat-label">{label}</div>
      <div className="is-stat-value">{fmt.int(hrs)}</div>
      <div className="text-xs text-[color:var(--color-text-muted)] mt-1">{caption}</div>
    </div>
  );
}

function BaselineControlsCard({
  project,
  canLock,
  onLock,
}: {
  project: Project;
  canLock: boolean;
  onLock: () => void;
}) {
  const isDraft = project.status === 'draft';
  const lockedDate = project.baseline_locked_at
    ? new Date(project.baseline_locked_at).toLocaleDateString()
    : null;

  return (
    <div className="is-surface p-6">
      <div className="is-eyebrow mb-1.5">Baseline</div>
      <h3 className="text-base font-semibold leading-tight">
        {isDraft ? 'Ready to lock' : 'Locked'}
      </h3>
      <p className="text-sm text-[color:var(--color-text-muted)] mt-1.5 leading-relaxed">
        {isDraft
          ? 'Locking the baseline freezes discipline budgets and snapshot data. From then on, scope changes flow through Change Orders.'
          : `Baseline locked on ${lockedDate}. Discipline budgets are read-only — use Change Management to adjust scope.`}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {isDraft ? (
          <Button
            variant="primary"
            disabled={!canLock}
            onClick={onLock}
            className="w-full justify-center"
          >
            <Lock size={14} /> Lock baseline
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled
            className="w-full justify-center"
            title="Baseline export — Phase 3"
          >
            <Download size={14} /> Export snapshot
          </Button>
        )}
        {!canLock && isDraft && (
          <p className="text-xs text-[color:var(--color-text-muted)] text-center">
            PM role or above required to lock baseline.
          </p>
        )}
      </div>
    </div>
  );
}
