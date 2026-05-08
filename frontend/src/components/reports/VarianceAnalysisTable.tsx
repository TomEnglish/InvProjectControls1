import { fmt } from '@/lib/format';
import { VarianceCell } from '@/components/ui/VarianceCell';
import type { DisciplineRollup, ProjectSummary } from '@/lib/queries';

/**
 * Per-discipline variance: BCWP / ACWP / CV / CPI / EAC. Bottom row totals
 * the project, including SPI from the period rollup.
 *
 * BCWS at the discipline level requires time-phased planning data we don't
 * have yet (only the project-level S-curve has BCWS), so SV/SPI are
 * project-level only. When BCWS gets per-discipline-period coverage, add
 * the columns here.
 */
export function VarianceAnalysisTable({
  disciplines,
  summary,
  projectBcws,
}: {
  disciplines: DisciplineRollup[];
  summary: ProjectSummary;
  projectBcws: number;
}) {
  if (disciplines.length === 0) {
    return (
      <div className="text-sm text-[color:var(--color-text-muted)] py-6 text-center">
        No active disciplines.
      </div>
    );
  }

  const rows = disciplines.map((d) => {
    const cv = d.earned_hrs - d.actual_hrs;
    const cpi = d.actual_hrs > 0 ? d.earned_hrs / d.actual_hrs : null;
    const eac = cpi && cpi > 0 ? d.budget_hrs / cpi : null;
    return { d, cv, cpi, eac };
  });

  const totalBudget = summary.total_budget_hrs;
  const totalEarned = summary.total_earned_hrs;
  const totalActual = summary.total_actual_hrs;
  const totalCv = totalEarned - totalActual;
  const totalSv = totalEarned - projectBcws;
  const totalCpi = summary.cpi;
  const totalSpi = summary.spi;
  const totalEac = totalCpi && totalCpi > 0 ? totalBudget / totalCpi : null;

  return (
    <div className="rounded-md border border-[color:var(--color-line)]" style={{ overflow: 'visible' }}>
      <table className="is-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Discipline</th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Budget hours — total planned work for the discipline."
            >
              Budget
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Budgeted Cost of Work Performed — earned hours, computed from milestone progress × ROC weights × budget hours."
            >
              BCWP
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Actual Cost of Work Performed — actual hours booked against the discipline."
            >
              ACWP
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Cost Variance = BCWP − ACWP. Positive = under budget on work done."
            >
              CV
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Cost Performance Index = BCWP ÷ ACWP. ≥1 favourable; <1 over budget."
            >
              CPI
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Estimate at Completion = Budget ÷ CPI. Projected total hours at finish if the current cost trend continues."
            >
              EAC
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, cv, cpi, eac }) => (
            <tr key={d.discipline_id}>
              <td className="font-semibold">{d.display_name}</td>
              <td className="text-right font-mono">{fmt.int(d.budget_hrs)}</td>
              <td className="text-right font-mono">{fmt.int(d.earned_hrs)}</td>
              <td className="text-right font-mono">{fmt.int(d.actual_hrs)}</td>
              <td className="text-right font-mono">
                <VarianceCell value={cv} format={(v) => `${v >= 0 ? '+' : ''}${fmt.int(v)}`} />
              </td>
              <td className="text-right font-mono">
                {cpi != null ? (
                  <VarianceCell value={cpi} neutral={1} format={(v) => v.toFixed(3)} />
                ) : (
                  '—'
                )}
              </td>
              <td className="text-right font-mono">{eac != null ? fmt.int(eac) : '—'}</td>
            </tr>
          ))}
          <tr style={{ background: 'var(--color-raised)' }}>
            <td className="font-bold">Project total</td>
            <td className="text-right font-mono font-bold">{fmt.int(totalBudget)}</td>
            <td className="text-right font-mono font-bold">{fmt.int(totalEarned)}</td>
            <td className="text-right font-mono font-bold">{fmt.int(totalActual)}</td>
            <td className="text-right font-mono font-bold">
              <VarianceCell value={totalCv} format={(v) => `${v >= 0 ? '+' : ''}${fmt.int(v)}`} />
            </td>
            <td className="text-right font-mono font-bold">
              {totalCpi != null ? (
                <VarianceCell value={totalCpi} neutral={1} format={(v) => v.toFixed(3)} />
              ) : (
                '—'
              )}
            </td>
            <td className="text-right font-mono font-bold">{totalEac != null ? fmt.int(totalEac) : '—'}</td>
          </tr>
          {projectBcws > 0 && (
            <tr style={{ background: 'var(--color-raised)' }}>
              <td className="font-semibold text-[color:var(--color-text-muted)]" colSpan={4}>
                Schedule variance (BCWS = {fmt.int(projectBcws)})
              </td>
              <td className="text-right font-mono">
                <VarianceCell value={totalSv} format={(v) => `${v >= 0 ? '+' : ''}${fmt.int(v)}`} />
              </td>
              <td className="text-right font-mono" colSpan={2}>
                SPI{' '}
                {totalSpi != null ? (
                  <VarianceCell value={totalSpi} neutral={1} format={(v) => v.toFixed(3)} />
                ) : (
                  '—'
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
