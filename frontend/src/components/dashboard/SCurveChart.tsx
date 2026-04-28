import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import type { ProgressPeriod, ProjectSummary } from '@/lib/queries';

type Props = {
  periods: ProgressPeriod[];
  summary: ProjectSummary;
};

/**
 * The S-curve draws cumulative hours across periods. For each period:
 *   planned = cumulative BCWS
 *   earned  = cumulative BCWP (from locked periods) + current BCWP for the open period
 *   actual  = cumulative ACWP (from locked periods) + current ACWP for the open period
 *
 * The open (unlocked) period's earned/actual are taken from the current
 * project_summary totals so the line extends all the way to "today".
 * Locked periods have their frozen values.
 */
export function SCurveChart({ periods, summary }: Props) {
  if (periods.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[color:var(--color-text-muted)]">
        No periods yet — create one via Period Close.
      </div>
    );
  }

  const labels = periods.map((p) => `P${p.period_number}`);

  let cumPlanned = 0;
  let cumEarned = 0;
  let cumActual = 0;

  const plannedSeries: (number | null)[] = [];
  const earnedSeries: (number | null)[] = [];
  const actualSeries: (number | null)[] = [];

  for (const p of periods) {
    cumPlanned += p.bcws_hrs ?? 0;
    plannedSeries.push(cumPlanned);

    if (p.locked_at) {
      cumEarned += p.bcwp_hrs ?? 0;
      cumActual += p.acwp_hrs ?? 0;
      earnedSeries.push(cumEarned);
      actualSeries.push(cumActual);
    } else {
      // Open period — pull live project_summary totals so the curve reaches "now".
      earnedSeries.push(summary.total_earned_hrs);
      actualSeries.push(summary.total_actual_hrs);
    }
  }

  const data = {
    labels,
    datasets: [
      {
        label: 'Planned (BCWS)',
        data: plannedSeries,
        borderColor: '#0369a1',
        backgroundColor: 'rgba(3, 105, 161, 0.08)',
        borderDash: [5, 5],
        tension: 0.3,
        pointRadius: 3,
        fill: false,
      },
      {
        label: 'Earned (BCWP)',
        data: earnedSeries,
        borderColor: '#059669',
        backgroundColor: 'rgba(5, 150, 105, 0.1)',
        tension: 0.3,
        pointRadius: 4,
        fill: false,
      },
      {
        label: 'Actual (ACWP)',
        data: actualSeries,
        borderColor: '#0891b2',
        backgroundColor: 'rgba(8, 145, 178, 0.1)',
        tension: 0.3,
        pointRadius: 4,
        fill: false,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: (v) => new Intl.NumberFormat('en-US').format(Number(v)),
        },
      },
    },
  };

  return <Line data={data} options={options} />;
}
