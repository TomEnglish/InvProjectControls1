import '@/lib/charts';
import { useProjectStore } from '@/stores/project';
import { useProjectSummary, useProgressPeriods } from '@/lib/queries';
import { fmt } from '@/lib/format';
import { KpiCard, KpiCardSkeleton } from '@/components/dashboard/KpiCard';
import { ChartCard, ChartCardSkeleton } from '@/components/dashboard/ChartCard';
import { EarnedValueByDisciplineChart } from '@/components/dashboard/EarnedValueByDisciplineChart';
import { SCurveChart } from '@/components/dashboard/SCurveChart';
import { DisciplineSummaryTable } from '@/components/dashboard/DisciplineSummaryTable';

function NoProjectSelected() {
  return (
    <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg p-8 text-center">
      <h3 className="text-base font-semibold mb-2">No project selected</h3>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Pick a project in the top bar, or create one in Project Setup.
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCardSkeleton title="Earned Value by Discipline" />
        <ChartCardSkeleton title="S-Curve — Cumulative Progress" />
      </div>
    </>
  );
}

export function DashboardPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const summary = useProjectSummary(projectId);
  const periods = useProgressPeriods(projectId);

  if (!projectId) return <NoProjectSelected />;

  const isLoading = summary.isLoading || periods.isLoading;
  if (isLoading) return <LoadingSkeleton />;

  if (summary.error) {
    return (
      <div className="bg-[color:var(--color-status-pending-bg)] text-[color:var(--color-status-pending-fg)] border border-[color:var(--color-status-pending-fg)]/30 rounded-lg p-4 text-sm">
        Failed to load dashboard: {(summary.error as Error).message}
      </div>
    );
  }

  const s = summary.data;
  if (!s) return <NoProjectSelected />;

  const cpiTone = s.cpi == null ? 'neutral' : s.cpi >= 1 ? 'favourable' : 'unfavourable';
  const spiTone = s.spi == null ? 'neutral' : s.spi >= 1 ? 'favourable' : 'unfavourable';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Overall Earned"
          value={fmt.pct(s.overall_pct)}
          subtext={`${fmt.int(s.total_earned_hrs)} / ${fmt.int(s.total_budget_hrs)} hrs`}
        />
        <KpiCard
          label="Earned Hours"
          value={fmt.int(s.total_earned_hrs)}
          subtext={`of ${fmt.int(s.total_budget_hrs)} budget`}
        />
        <KpiCard
          label="CPI"
          value={fmt.ratio(s.cpi)}
          subtext={s.cpi == null ? 'No actuals yet' : s.cpi >= 1 ? 'Under budget' : 'Over budget'}
          tone={cpiTone}
        />
        <KpiCard
          label="SPI"
          value={fmt.ratio(s.spi)}
          subtext={s.spi == null ? 'No baseline yet' : s.spi >= 1 ? 'Ahead of schedule' : 'Behind schedule'}
          tone={spiTone}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Earned Value by Discipline">
          <EarnedValueByDisciplineChart disciplines={s.disciplines} />
        </ChartCard>
        <ChartCard title="S-Curve — Cumulative Progress">
          <SCurveChart periods={periods.data ?? []} summary={s} />
        </ChartCard>
      </div>

      <div className="bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg p-5">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[color:var(--color-line)]">
          <h3 className="text-sm font-semibold">Discipline Summary</h3>
        </div>
        <DisciplineSummaryTable disciplines={s.disciplines} />
      </div>
    </div>
  );
}
