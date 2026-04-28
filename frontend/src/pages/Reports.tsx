import '@/lib/charts';
import { FileBarChart, Download } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import { useProjectSummary, useProgressPeriods } from '@/lib/queries';
import { ChartCard, ChartCardSkeleton } from '@/components/dashboard/ChartCard';
import { EarnedValueByDisciplineChart } from '@/components/dashboard/EarnedValueByDisciplineChart';
import { CpiSpiTrendChart } from '@/components/reports/CpiSpiTrendChart';
import { VarianceAnalysisTable } from '@/components/reports/VarianceAnalysisTable';
import { Button } from '@/components/ui/Button';
import { fmt } from '@/lib/format';

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
  const summary = useProjectSummary(projectId);
  const periods = useProgressPeriods(projectId);

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
        Failed to load report data: {(summary.error as Error).message}
      </div>
    );
  }

  const s = summary.data!;
  const ps = periods.data ?? [];
  const projectBcws = ps.reduce((acc, p) => acc + (p.locked_at ? p.bcws_hrs ?? 0 : 0), 0);
  const cv = s.total_earned_hrs - s.total_actual_hrs;
  const sv = s.total_earned_hrs - projectBcws;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryTile
          label="Cost Variance"
          value={`${cv >= 0 ? '+' : ''}${fmt.int(cv)}`}
          caption="BCWP − ACWP"
          tone={cv >= 0 ? 'favourable' : 'unfavourable'}
        />
        <SummaryTile
          label="Schedule Variance"
          value={projectBcws > 0 ? `${sv >= 0 ? '+' : ''}${fmt.int(sv)}` : '—'}
          caption={projectBcws > 0 ? 'BCWP − BCWS' : 'No locked period yet'}
          tone={projectBcws === 0 ? 'neutral' : sv >= 0 ? 'favourable' : 'unfavourable'}
        />
        <SummaryTile
          label="Forecast at Completion"
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Budget vs Earned vs Actual"
          caption="Hours by discipline."
        >
          {s.disciplines.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[color:var(--color-text-muted)]">
              No active disciplines yet.
            </div>
          ) : (
            <EarnedValueByDisciplineChart disciplines={s.disciplines} />
          )}
        </ChartCard>
        <ChartCard title="CPI / SPI trend" caption="Per locked period.">
          <CpiSpiTrendChart periods={ps} />
        </ChartCard>
      </div>

      <div className="is-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-[color:var(--color-line)] flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Variance analysis</h3>
            <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
              Per discipline. EAC uses the live CPI; flatlines if there are no actuals yet.
            </p>
          </div>
          <Button variant="outline" size="sm" disabled title="Export — Phase 3">
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

function SummaryTile({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  tone: 'favourable' | 'unfavourable' | 'neutral';
}) {
  const colour =
    tone === 'favourable'
      ? 'var(--color-variance-favourable)'
      : tone === 'unfavourable'
        ? 'var(--color-variance-unfavourable)'
        : 'var(--color-text)';
  return (
    <div className="is-surface is-stat-card">
      <div className="is-stat-label">{label}</div>
      <div className="is-stat-value font-mono" style={{ color: colour }}>
        {value}
      </div>
      <div className="text-xs text-[color:var(--color-text-muted)]">{caption}</div>
    </div>
  );
}
