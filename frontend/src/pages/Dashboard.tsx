import '@/lib/charts';
import { useProjectStore } from '@/stores/project';
import { useDashboardSummary, useProgressPeriods, useProjectQtyRollup } from '@/lib/queries';
import { fmt } from '@/lib/format';
import { KpiCard, KpiCardSkeleton } from '@/components/dashboard/KpiCard';
import { ChartCard, ChartCardSkeleton } from '@/components/dashboard/ChartCard';
import { EarnedValueByDisciplineChart } from '@/components/dashboard/EarnedValueByDisciplineChart';
import { SCurveChart } from '@/components/dashboard/SCurveChart';
import { DisciplineSummaryTable } from '@/components/dashboard/DisciplineSummaryTable';
import { FolderOpen } from 'lucide-react';

function NoProjectSelected() {
  return (
    <div className="is-surface is-empty">
      <div className="is-empty-icon">
        <FolderOpen size={28} />
      </div>
      <div className="is-empty-title">No project selected</div>
      <p className="is-empty-caption">
        Pick a project from the top bar, or create one in Project Setup.
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
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
  const summary = useDashboardSummary(projectId);
  const periods = useProgressPeriods(projectId);
  const qtyRollup = useProjectQtyRollup(projectId);

  if (!projectId) return <NoProjectSelected />;

  const isLoading = summary.isLoading || periods.isLoading;
  if (isLoading) return <LoadingSkeleton />;

  if (summary.error) {
    return (
      <div className="is-toast is-toast-danger">
        <div>
          <div className="font-semibold">Failed to load dashboard</div>
          <div className="opacity-90 mt-0.5">{summary.error.message}</div>
        </div>
      </div>
    );
  }

  const s = summary.data;
  if (!s) return <NoProjectSelected />;

  const cpiTone = s.cpi == null ? 'neutral' : s.cpi >= 1 ? 'favourable' : 'unfavourable';
  const spiTone = s.spi == null ? 'neutral' : s.spi >= 1 ? 'favourable' : 'unfavourable';
  const rollupModeLabel: Record<'hours_weighted' | 'equal' | 'custom', string> = {
    hours_weighted: 'Hours-weighted',
    equal: 'Equal-weighted',
    custom: 'Custom weights',
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
        {qtyRollup.data ? (
          <KpiCard
            label="Composite % (qty)"
            value={fmt.pct(qtyRollup.data.composite_pct)}
            subtext={rollupModeLabel[qtyRollup.data.mode]}
          />
        ) : (
          <KpiCardSkeleton />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Earned Value by Discipline" caption="Budget vs earned, by discipline">
          <EarnedValueByDisciplineChart disciplines={s.disciplines} />
        </ChartCard>
        <ChartCard title="S-Curve" caption="Cumulative planned vs earned vs actual hours">
          <SCurveChart periods={periods.data ?? []} summary={s} />
        </ChartCard>
      </div>

      <div className="is-surface p-6">
        <div className="mb-5">
          <h3 className="text-sm font-semibold">Discipline Summary</h3>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
            Budget, earned, and actual hours by discipline.
          </p>
        </div>
        <DisciplineSummaryTable disciplines={s.disciplines} />
      </div>
    </div>
  );
}
