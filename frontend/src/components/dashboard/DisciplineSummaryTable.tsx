import { useNavigate } from 'react-router-dom';
import { fmt } from '@/lib/format';
import type { DisciplineRollup } from '@/lib/queries';

const headers = [
  { label: 'Discipline', align: 'left' },
  { label: 'Records', align: 'right' },
  { label: 'Budget Hrs', align: 'right' },
  { label: 'Earned Hrs', align: 'right' },
  { label: 'Actual Hrs', align: 'right' },
  { label: '% Complete', align: 'right' },
  { label: 'CPI', align: 'right' },
  { label: 'Progress', align: 'left' },
] as const;

export function DisciplineSummaryTable({ disciplines }: { disciplines: DisciplineRollup[] }) {
  const nav = useNavigate();
  if (disciplines.length === 0) {
    return (
      <div className="is-empty py-10">
        <div className="is-empty-title">No active disciplines</div>
        <p className="is-empty-caption">
          Configure project disciplines to start tracking earned value.
        </p>
        <button type="button" className="is-btn is-btn-secondary" onClick={() => nav('/projects')}>
          Open Project Setup
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
      <table className="is-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h.label} style={{ textAlign: h.align }}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {disciplines.map((d) => {
            const cpiFav = d.cpi != null && d.cpi >= 1;
            const cpiWarn = d.cpi != null && d.cpi >= 0.95 && d.cpi < 1;
            const barColor = cpiFav
              ? 'var(--color-variance-favourable)'
              : cpiWarn
                ? 'var(--color-warn)'
                : 'var(--color-variance-unfavourable)';
            const cpiColor = cpiFav
              ? 'var(--color-variance-favourable)'
              : cpiWarn
                ? 'var(--color-warn)'
                : 'var(--color-variance-unfavourable)';
            return (
              <tr key={d.discipline_id}>
                <td className="font-semibold">{d.display_name}</td>
                <td className="text-right font-mono">{d.records}</td>
                <td className="text-right font-mono">{fmt.int(d.budget_hrs)}</td>
                <td className="text-right font-mono">{fmt.int(d.earned_hrs)}</td>
                <td className="text-right font-mono">{fmt.int(d.actual_hrs)}</td>
                <td className="text-right font-mono">{fmt.pct(d.earned_pct)}</td>
                <td className="text-right font-mono" style={{ color: cpiColor }}>
                  {fmt.ratio(d.cpi ?? undefined)}
                </td>
                <td style={{ width: 120 }}>
                  <div
                    className="rounded-full h-1.5 overflow-hidden"
                    style={{ background: 'var(--color-raised)' }}
                  >
                    <div
                      className="h-full transition-[width]"
                      style={{
                        width: `${Math.min(100, Math.max(0, d.earned_pct * 100))}%`,
                        background: barColor,
                      }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
