import { useMemo } from 'react';
import { useProjectStore } from '@/stores/project';
import { useDashboardSummary, useProgressRows } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { KpiCard, KpiCardSkeleton } from '@/components/dashboard/KpiCard';
import { EarnedValueByDisciplineChart } from '@/components/dashboard/EarnedValueByDisciplineChart';
import { fmt } from '@/lib/format';

function NoProject() {
  return (
    <Card>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Pick a project in the top bar to view earned-value details.
      </p>
    </Card>
  );
}

export function EarnedValuePage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const summary = useDashboardSummary(projectId);
  const rows = useProgressRows(projectId);

  const topDelta = useMemo(() => {
    const list = (rows.data ?? []).slice();
    list.sort((a, b) => Math.abs(b.earned_hrs - b.budget_hrs) - Math.abs(a.earned_hrs - a.budget_hrs));
    return list.slice(0, 20);
  }, [rows.data]);

  if (!projectId) return <NoProject />;
  if (summary.isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (summary.error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load earned value: {summary.error.message}
      </div>
    );
  }
  const s = summary.data;
  if (!s) return <NoProject />;

  const cpiTone = s.cpi == null ? 'neutral' : s.cpi >= 1 ? 'favourable' : 'unfavourable';
  const spiTone = s.spi == null ? 'neutral' : s.spi >= 1 ? 'favourable' : 'unfavourable';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Earned %"
          value={fmt.pct(s.overall_pct)}
          subtext={`${fmt.int(s.total_earned_hrs)} / ${fmt.int(s.total_budget_hrs)} hrs`}
        />
        <KpiCard label="Total Earned" value={fmt.int(s.total_earned_hrs)} subtext="Hours earned" />
        <KpiCard
          label="Total Budget"
          value={fmt.int(s.total_budget_hrs)}
          subtext="Hours budgeted"
        />
        <KpiCard
          label="CPI"
          value={fmt.ratio(s.cpi)}
          subtext={s.cpi == null ? 'No actuals' : s.cpi >= 1 ? 'Under budget' : 'Over budget'}
          tone={cpiTone}
        />
        <KpiCard
          label="SPI"
          value={fmt.ratio(s.spi)}
          subtext={s.spi == null ? 'No baseline' : s.spi >= 1 ? 'Ahead' : 'Behind'}
          tone={spiTone}
        />
      </div>

      <Card>
        <CardHeader
          eyebrow="By discipline"
          title="Budget vs earned vs actual"
          caption="Hours per discipline."
        />
        {s.disciplines.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-[color:var(--color-text-muted)]">
            No active disciplines yet.
          </div>
        ) : (
          <div className="h-72">
            <EarnedValueByDisciplineChart disciplines={s.disciplines} />
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="px-6 pt-5 pb-3">
          <CardHeader
            eyebrow="Top 20"
            title="Records by earned-hours delta"
            caption="Records with the largest gap between budget and earned hours."
          />
        </div>
        <div className="overflow-x-auto">
          <table className="is-table">
            <thead>
              <tr>
                <th>DWG</th>
                <th>Description</th>
                <th>Discipline</th>
                <th className="text-right">Budget hrs</th>
                <th className="text-right">Earned hrs</th>
                <th className="text-right">Δ hrs</th>
                <th className="text-right">% Complete</th>
              </tr>
            </thead>
            <tbody>
              {topDelta.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[color:var(--color-text-muted)] py-8">
                    No records yet.
                  </td>
                </tr>
              )}
              {topDelta.map((r) => {
                const delta = r.earned_hrs - r.budget_hrs;
                return (
                  <tr key={r.id}>
                    <td className="font-mono">{r.dwg ?? '—'}</td>
                    <td>{r.description}</td>
                    <td>{r.discipline_name ?? '—'}</td>
                    <td className="text-right font-mono">{fmt.int(r.budget_hrs)}</td>
                    <td className="text-right font-mono">{fmt.int(r.earned_hrs)}</td>
                    <td
                      className="text-right font-mono"
                      style={{
                        color:
                          delta > 0
                            ? 'var(--color-variance-favourable)'
                            : delta < 0
                              ? 'var(--color-variance-unfavourable)'
                              : 'var(--color-text)',
                      }}
                    >
                      {delta >= 0 ? '+' : ''}
                      {fmt.int(delta)}
                    </td>
                    <td className="text-right font-mono">{r.percent_complete.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
