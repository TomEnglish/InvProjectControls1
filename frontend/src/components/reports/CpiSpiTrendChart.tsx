import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import type { ProgressPeriod } from '@/lib/queries';

/**
 * CPI / SPI per locked period, plus a 1.0 reference line. Open (unlocked)
 * periods are skipped — their interim values aren't a fair comparison
 * against the locked snapshots.
 */
export function CpiSpiTrendChart({ periods }: { periods: ProgressPeriod[] }) {
  const locked = periods.filter((p) => p.locked_at && (p.bcws_hrs ?? 0) > 0);

  if (locked.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[color:var(--color-text-muted)]">
        No locked periods yet — CPI/SPI trend appears after the first period close.
      </div>
    );
  }

  const labels = locked.map((p) => `P${p.period_number}`);
  const cpi = locked.map((p) => {
    const bcwp = p.bcwp_hrs ?? 0;
    const acwp = p.acwp_hrs ?? 0;
    return acwp > 0 ? bcwp / acwp : null;
  });
  const spi = locked.map((p) => {
    const bcwp = p.bcwp_hrs ?? 0;
    const bcws = p.bcws_hrs ?? 0;
    return bcws > 0 ? bcwp / bcws : null;
  });
  const target = locked.map(() => 1);

  const data = {
    labels,
    datasets: [
      {
        label: 'CPI',
        data: cpi,
        borderColor: '#0369a1',
        backgroundColor: 'rgba(3, 105, 161, 0.1)',
        tension: 0.3,
        pointRadius: 4,
      },
      {
        label: 'SPI',
        data: spi,
        borderColor: '#0891b2',
        backgroundColor: 'rgba(8, 145, 178, 0.1)',
        tension: 0.3,
        pointRadius: 4,
      },
      {
        label: 'Target (1.00)',
        data: target,
        borderColor: 'rgba(100, 116, 139, 0.6)',
        borderDash: [6, 6],
        tension: 0,
        pointRadius: 0,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      y: {
        beginAtZero: false,
        suggestedMin: 0.7,
        suggestedMax: 1.3,
        ticks: { callback: (v) => Number(v).toFixed(2) },
      },
    },
  };

  return <Line data={data} options={options} />;
}
