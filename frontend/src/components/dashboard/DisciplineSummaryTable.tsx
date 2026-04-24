import { useNavigate } from 'react-router-dom';
import { fmt } from '@/lib/format';
import type { DisciplineRollup } from '@/lib/queries';

export function DisciplineSummaryTable({ disciplines }: { disciplines: DisciplineRollup[] }) {
  const nav = useNavigate();
  if (disciplines.length === 0) {
    return (
      <div className="text-sm text-[color:var(--color-text-muted)]">
        No active disciplines yet. Configure them in{' '}
        <button
          type="button"
          className="underline text-[color:var(--color-primary)]"
          onClick={() => nav('/projects')}
        >
          Project Setup
        </button>
        .
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {['Discipline', 'Records', 'Budget Hrs', 'Earned Hrs', 'Actual Hrs', '% Complete', 'CPI', 'Progress'].map(
              (h) => (
                <th
                  key={h}
                  className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wide font-semibold text-[color:var(--color-text-muted)] bg-[color:var(--color-canvas)] border-b-2 border-[color:var(--color-line)]"
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {disciplines.map((d) => {
            const cpiFav = d.cpi != null && d.cpi >= 1;
            const cpiWarn = d.cpi != null && d.cpi >= 0.95 && d.cpi < 1;
            const cpiColor = cpiFav
              ? 'var(--color-variance-favourable)'
              : cpiWarn
              ? 'var(--color-accent)'
              : 'var(--color-variance-unfavourable)';
            const barColor = cpiFav
              ? 'var(--color-variance-favourable)'
              : cpiWarn
              ? 'var(--color-accent)'
              : 'var(--color-variance-unfavourable)';
            return (
              <tr key={d.discipline_id} className="hover:bg-[color:var(--color-canvas)]">
                <td className="px-3 py-2 border-b border-[color:var(--color-line)]">
                  <strong>{d.display_name}</strong>
                </td>
                <td className="px-3 py-2 border-b border-[color:var(--color-line)]">{d.records}</td>
                <td className="px-3 py-2 text-right font-mono border-b border-[color:var(--color-line)]">
                  {fmt.int(d.budget_hrs)}
                </td>
                <td className="px-3 py-2 text-right font-mono border-b border-[color:var(--color-line)]">
                  {fmt.int(d.earned_hrs)}
                </td>
                <td className="px-3 py-2 text-right font-mono border-b border-[color:var(--color-line)]">
                  {fmt.int(d.actual_hrs)}
                </td>
                <td className="px-3 py-2 text-right font-mono border-b border-[color:var(--color-line)]">
                  {fmt.pct(d.earned_pct)}
                </td>
                <td
                  className="px-3 py-2 text-right font-mono border-b border-[color:var(--color-line)]"
                  style={{ color: cpiColor }}
                >
                  {fmt.ratio(d.cpi ?? undefined)}
                </td>
                <td className="px-3 py-2 border-b border-[color:var(--color-line)]" style={{ width: 120 }}>
                  <div className="bg-[color:var(--color-canvas)] rounded h-2 overflow-hidden">
                    <div
                      className="h-full rounded transition-[width]"
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
