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
        // sky-700 @ 18%
        backgroundColor: 'rgba(3, 105, 161, 0.18)',
        borderColor: '#0369a1',
        borderWidth: 1,
      },
      {
        label: 'Earned Hrs',
        data: disciplines.map((d) => d.earned_hrs),
        // emerald-600 @ 60%
        backgroundColor: 'rgba(5, 150, 105, 0.6)',
        borderColor: '#059669',
        borderWidth: 1,
      },
      {
        label: 'Actual Hrs',
        data: disciplines.map((d) => d.actual_hrs),
        // cyan-600 @ 55%
        backgroundColor: 'rgba(8, 145, 178, 0.55)',
        borderColor: '#0891b2',
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
