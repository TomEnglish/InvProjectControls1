import '@/lib/charts';
import { useMemo, useState } from 'react';
import { FileBarChart, Download, Calendar, Info } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import {
  useDashboardSummary,
  useDashboardSummaryAtSnapshot,
  useProgressPeriods,
  useSnapshots,
} from '@/lib/queries';
import { ChartCard, ChartCardSkeleton } from '@/components/dashboard/ChartCard';
import { EarnedValueByDisciplineChart } from '@/components/dashboard/EarnedValueByDisciplineChart';
import { CpiSpiTrendChart } from '@/components/reports/CpiSpiTrendChart';
import { VarianceAnalysisTable } from '@/components/reports/VarianceAnalysisTable';
import { PeriodCloseCard } from '@/components/reports/PeriodCloseCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { selectClass } from '@/components/ui/FormField';
import { fmt } from '@/lib/format';
import { downloadCsv } from '@/lib/export';

function NoProject() {
  return (
    <div className="is-surface is-empty">
      <div className="is-empty-icon">
        <FileBarChart size={28} />
      </div>
      <div className="is-empty-title">No project selected</div>
      <p className="is-empty-caption">
        Pick a project in the top bar to view earned-value reports.
      </p>
    </div>
  );
}

export function ReportsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const liveSummary = useDashboardSummary(projectId);
  const periods = useProgressPeriods(projectId);
  const snapshots = useSnapshots(projectId);

  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const selectedSnapshot = useMemo(
    () => snapshots.data?.find((s) => s.id === snapshotId) ?? null,
    [snapshots.data, snapshotId],
  );
  const snapshotSummary = useDashboardSummaryAtSnapshot(selectedSnapshot, projectId);
  const snapshotIsMissing =
    snapshotId !== null && !snapshots.isLoading && !selectedSnapshot;

  // Pick the active data source: live state if no snapshot is selected,
  // otherwise the frozen snapshot view. Wait on the underlying snapshots
  // list to avoid a flash of "missing" while it's still loading.
  const summary = snapshotId
    ? {
        isLoading: snapshots.isLoading || snapshotSummary.isLoading,
        error: snapshotSummary.error,
        data: snapshotSummary.data,
      }
    : liveSummary;
  const sortedSnapshots = useMemo(() => {
    return (snapshots.data ?? [])
      .slice()
      .sort((a, b) => (b.snapshot_date.localeCompare(a.snapshot_date)));
  }, [snapshots.data]);

  if (!projectId) return <NoProject />;

  if (summary.isLoading || periods.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="is-surface is-stat-card">
              <div className="is-skeleton" style={{ width: '40%' }} />
              <div className="is-skeleton" style={{ height: 28, width: '60%' }} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCardSkeleton title="Budget vs Earned vs Actual" />
          <ChartCardSkeleton title="CPI / SPI trend" />
        </div>
      </div>
    );
  }

  if (summary.error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load report data: {summary.error.message}
      </div>
    );
  }

  if (!summary.data) {
    // Snapshot path: either still loading, or the snapshot was deleted /
    // is no longer in the list. Distinguish so the user can recover.
    return (
      <div className="space-y-4">
        <SnapshotSelector
          snapshots={sortedSnapshots}
          snapshotId={snapshotId}
          onChange={setSnapshotId}
        />
        <Card>
          {snapshotIsMissing ? (
            <div className="is-toast is-toast-warn">
              The selected snapshot is no longer available. It may have
              been deleted or you no longer have access. Pick another, or
              click "Back to live".
            </div>
          ) : (
            <p className="text-sm text-[color:var(--color-text-muted)]">
              Loading snapshot data…
            </p>
          )}
        </Card>
      </div>
    );
  }

  const s = summary.data;
  const ps = periods.data ?? [];
  const projectBcws = ps.reduce((acc, p) => acc + (p.locked_at ? p.bcws_hrs ?? 0 : 0), 0);
  const cv = s.total_earned_hrs - s.total_actual_hrs;
  const sv = s.total_earned_hrs - projectBcws;

  return (
    <div className="space-y-4">
      <SnapshotSelector
        snapshots={sortedSnapshots}
        snapshotId={snapshotId}
        onChange={setSnapshotId}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryTile
          label="Cost Variance (CV)"
          help="Earned hours minus actual hours. Positive = under budget on the work done. CV = BCWP − ACWP."
          value={`${cv >= 0 ? '+' : ''}${fmt.int(cv)}`}
          caption="BCWP − ACWP"
          tone={cv >= 0 ? 'favourable' : 'unfavourable'}
        />
        <SummaryTile
          label="Schedule Variance (SV)"
          help="Earned hours minus planned hours. Positive = ahead of schedule. SV = BCWP − BCWS."
          value={projectBcws > 0 ? `${sv >= 0 ? '+' : ''}${fmt.int(sv)}` : '—'}
          caption={projectBcws > 0 ? 'BCWP − BCWS' : 'No locked period yet'}
          tone={projectBcws === 0 ? 'neutral' : sv >= 0 ? 'favourable' : 'unfavourable'}
        />
        <SummaryTile
          label="Forecast at Completion (FAC)"
          help="Projected total hours at finish, given the current cost-performance trend. FAC = Budget ÷ CPI."
          value={
            s.cpi != null && s.cpi > 0
              ? fmt.int(s.total_budget_hrs / s.cpi)
              : '—'
          }
          caption={s.cpi != null && s.cpi > 0 ? `Budget ÷ CPI (${s.cpi.toFixed(3)})` : 'No actuals yet'}
          tone={
            s.cpi == null
              ? 'neutral'
              : s.cpi >= 1
                ? 'favourable'
                : 'unfavourable'
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 grid gap-4">
          <ChartCard title="Budget vs Earned vs Actual" caption="Hours by discipline.">
            {s.disciplines.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-[color:var(--color-text-muted)]">
                No active disciplines yet.
              </div>
            ) : (
              <EarnedValueByDisciplineChart disciplines={s.disciplines} />
            )}
          </ChartCard>
          <ChartCard
            title="CPI / SPI trend"
            caption="Per locked period. CPI = earned÷actual hours (cost performance, ≥1 favourable). SPI = earned÷planned hours (schedule performance, ≥1 favourable)."
          >
            <CpiSpiTrendChart periods={ps} />
          </ChartCard>
        </div>
        <PeriodCloseCard projectId={projectId} periods={ps} />
      </div>

      <div className="is-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-[color:var(--color-line)] flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Variance analysis</h3>
            <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
              Per discipline. EAC uses the live CPI; flatlines if there are no actuals yet.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={s.disciplines.length === 0}
            onClick={() => {
              const date = new Date().toISOString().slice(0, 10);
              const headers = [
                'Discipline',
                'Budget hrs',
                'BCWP (Earned hrs)',
                'ACWP (Actual hrs)',
                'CV',
                'CPI',
                'EAC',
              ];
              const rows = s.disciplines.map((d) => {
                const cv = d.earned_hrs - d.actual_hrs;
                const cpi = d.actual_hrs > 0 ? d.earned_hrs / d.actual_hrs : null;
                const eac = cpi && cpi > 0 ? d.budget_hrs / cpi : null;
                return [
                  d.display_name,
                  d.budget_hrs.toFixed(0),
                  d.earned_hrs.toFixed(0),
                  d.actual_hrs.toFixed(0),
                  cv.toFixed(0),
                  cpi != null ? cpi.toFixed(3) : '',
                  eac != null ? eac.toFixed(0) : '',
                ];
              });
              const totalCv = s.total_earned_hrs - s.total_actual_hrs;
              const totalEac = s.cpi && s.cpi > 0 ? s.total_budget_hrs / s.cpi : null;
              rows.push([
                'PROJECT TOTAL',
                s.total_budget_hrs.toFixed(0),
                s.total_earned_hrs.toFixed(0),
                s.total_actual_hrs.toFixed(0),
                totalCv.toFixed(0),
                s.cpi != null ? s.cpi.toFixed(3) : '',
                totalEac != null ? totalEac.toFixed(0) : '',
              ]);
              if (projectBcws > 0) {
                rows.push([
                  `Schedule variance (BCWS = ${projectBcws.toFixed(0)})`,
                  '',
                  '',
                  '',
                  (s.total_earned_hrs - projectBcws).toFixed(0),
                  s.spi != null ? s.spi.toFixed(3) : '',
                  '',
                ]);
              }
              downloadCsv(`variance-analysis-${date}.csv`, headers, rows);
            }}
          >
            <Download size={14} /> Export
          </Button>
        </div>
        <div className="p-6 pt-4">
          <VarianceAnalysisTable
            disciplines={s.disciplines}
            summary={s}
            projectBcws={projectBcws}
          />
        </div>
      </div>
    </div>
  );
}

type SnapshotForSelector = {
  id: string;
  snapshot_date: string;
  week_ending: string | null;
  label: string;
};

function SnapshotSelector({
  snapshots,
  snapshotId,
  onChange,
}: {
  snapshots: SnapshotForSelector[];
  snapshotId: string | null;
  onChange: (id: string | null) => void;
}) {
  // Find the most-recent snapshot for the "Latest snapshot" preset.
  const latest = snapshots[0];

  return (
    <Card>
      <div className="flex items-center gap-3 flex-wrap">
        <Calendar size={16} className="text-[color:var(--color-text-muted)]" />
        <div>
          <div className="is-eyebrow mb-0.5">Reporting period</div>
          <div className="text-sm font-semibold">
            {snapshotId
              ? `As of ${snapshots.find((s) => s.id === snapshotId)?.snapshot_date ?? '—'}`
              : 'Live (current state)'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select
            aria-label="Snapshot selector"
            className={selectClass}
            value={snapshotId ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">Live (current state)</option>
            {latest && (
              <option value={latest.id}>
                Latest snapshot — {latest.label}
              </option>
            )}
            {snapshots.length > 1 && <option disabled>──────────</option>}
            {snapshots.slice(1).map((s) => (
              <option key={s.id} value={s.id}>
                {s.snapshot_date} — {s.label}
              </option>
            ))}
          </select>
          {snapshotId && (
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              Back to live
            </Button>
          )}
        </div>
      </div>
      {snapshots.length === 0 && (
        <p className="text-xs text-[color:var(--color-text-muted)] mt-2">
          No snapshots yet — only live state is available. Snapshots are
          created automatically by uploads on the Progress page.
        </p>
      )}
      {snapshotId && (
        <p className="text-xs text-[color:var(--color-text-muted)] mt-2">
          Snapshot values are frozen at capture time and use percent-of-budget
          earned-hours math. Live values use milestone-weighted earned-hours
          and may differ for records that have milestone-level overrides.
        </p>
      )}
    </Card>
  );
}

function SummaryTile({
  label,
  value,
  caption,
  tone,
  help,
}: {
  label: string;
  value: string;
  caption: string;
  tone: 'favourable' | 'unfavourable' | 'neutral';
  help?: string;
}) {
  const colour =
    tone === 'favourable'
      ? 'var(--color-variance-favourable)'
      : tone === 'unfavourable'
        ? 'var(--color-variance-unfavourable)'
        : 'var(--color-text)';
  return (
    <div className="is-surface is-stat-card" title={help}>
      <div
        className={`is-stat-label flex items-center gap-1.5 ${help ? 'cursor-help' : ''}`}
      >
        <span>{label}</span>
        {help && <Info size={12} className="text-[color:var(--color-text-subtle)]" />}
      </div>
      <div className="is-stat-value font-mono" style={{ color: colour }}>
        {value}
      </div>
      <div className="text-xs text-[color:var(--color-text-muted)]">{caption}</div>
    </div>
  );
}
