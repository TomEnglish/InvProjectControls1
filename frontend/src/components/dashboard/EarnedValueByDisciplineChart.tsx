import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { fmt } from '@/lib/format';
import type { DisciplineRollup } from '@/lib/queries';

export function EarnedValueByDisciplineChart({ disciplines }: { disciplines: DisciplineRollup[] }) {
  const labels = disciplines.map((d) => d.display_name);

  const data = {
    labels,
    datasets: [
      {
        label: 'Budget Hrs',
        data: disciplines.map((d) => d.budget_hrs),
        backgroundColor: 'rgba(26, 54, 93, 0.15)',
        borderColor: 'var(--color-primary)',
        borderWidth: 1,
      },
      {
        label: 'Earned Hrs',
        data: disciplines.map((d) => d.earned_hrs),
        backgroundColor: 'rgba(56, 161, 105, 0.6)',
        borderColor: 'var(--color-variance-favourable)',
        borderWidth: 1,
      },
      {
        label: 'Actual Hrs',
        data: disciplines.map((d) => d.actual_hrs),
        backgroundColor: 'rgba(221, 107, 32, 0.5)',
        borderColor: 'var(--color-accent)',
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
          label: (ctx) => `${ctx.dataset.label}: ${fmt.int(Number(ctx.raw))}`,
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
