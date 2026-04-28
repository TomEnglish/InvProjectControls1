import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { fmt } from '@/lib/format';
import type { DisciplineRollup } from '@/lib/queries';

type Props = {
  disciplines: DisciplineRollup[];
  /** Approved CO impact per discipline; we don't have this granular yet, so total is split pro-rata. */
  approvedHrs: number;
  pendingHrs: number;
};

/**
 * Three-budget grouped bar — Original / Current / Forecast budget per discipline.
 * Pro-rates the project-level approved/pending CO impact to disciplines proportional to
 * each discipline's budget_hrs. Once per-CO discipline_id is plumbed into budget_rollup,
 * swap this for true per-discipline allocations.
 */
export function BudgetByDisciplineChart({ disciplines, approvedHrs, pendingHrs }: Props) {
  const totalBudget = disciplines.reduce((s, d) => s + d.budget_hrs, 0);
  const proRata = (hrs: number, share: number) =>
    totalBudget > 0 ? hrs * (share / totalBudget) : 0;

  const labels = disciplines.map((d) => d.display_name);
  const original = disciplines.map((d) => d.budget_hrs);
  const current = disciplines.map((d) => d.budget_hrs + proRata(approvedHrs, d.budget_hrs));
  const forecast = disciplines.map(
    (d) =>
      d.budget_hrs + proRata(approvedHrs, d.budget_hrs) + proRata(pendingHrs, d.budget_hrs),
  );

  const data = {
    labels,
    datasets: [
      {
        label: 'Original',
        data: original,
        backgroundColor: 'rgba(3, 105, 161, 0.85)',
        borderColor: '#0369a1',
        borderWidth: 1,
      },
      {
        label: 'Current',
        data: current,
        backgroundColor: 'rgba(8, 145, 178, 0.75)',
        borderColor: '#0891b2',
        borderWidth: 1,
      },
      {
        label: 'Forecast',
        data: forecast,
        backgroundColor: 'rgba(217, 119, 6, 0.6)',
        borderColor: '#d97706',
        borderWidth: 1,
      },
    ],
  };

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${fmt.int(Number(ctx.raw))} hrs`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { callback: (v) => fmt.int(Number(v)) },
      },
    },
  };

  return <Bar data={data} options={options} />;
}
