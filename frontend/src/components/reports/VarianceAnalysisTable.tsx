import { fmt } from '@/lib/format';
import { VarianceCell } from '@/components/ui/VarianceCell';
import type { DisciplineRollup, ProjectSummary } from '@/lib/queries';

/**
 * Client-facing variance table: Budget / Earned / Actual / Buffer / CPI / EAC.
 * Raw signed CV is internal-only — buffer shows max(0, earned − actual).
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
    const buffer = Math.max(0, cv);
    const cpi = d.actual_hrs > 0 ? d.earned_hrs / d.actual_hrs : null;
    const eac = cpi && cpi > 0 ? d.current_budget_hrs / cpi : null;
    return { d, cv, buffer, cpi, eac };
  });

  const totalBudget = summary.total_budget_hrs;
  const totalEarned = summary.total_earned_hrs;
  const totalActual = summary.total_actual_hrs;
  const totalCv = totalEarned - totalActual;
  const totalBuffer = Math.max(0, totalCv);
  const totalUnbudgeted = Math.max(0, totalActual - totalEarned);
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
              data-tip="Current budget hours for the discipline (baseline + approved change orders)."
            >
              Budget
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Earned hours from milestone progress × budget."
            >
              Earned
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Actual hours booked against the discipline."
            >
              Actual
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Buffer remaining = max(0, Earned − Actual). Never shown negative on client reports."
            >
              Buffer
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Cost Performance Index = Earned ÷ Actual. Target ≥ 1.00."
            >
              CPI
            </th>
            <th
              className="is-tip"
              style={{ textAlign: 'right', cursor: 'help' }}
              data-tip="Forecast at Completion = Budget ÷ CPI."
            >
              FAC
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, buffer, cpi, eac }) => (
            <tr key={d.discipline_id}>
              <td className="font-semibold">{d.display_name}</td>
              <td className="text-right font-mono">{fmt.int(d.current_budget_hrs)}</td>
              <td className="text-right font-mono">{fmt.int(d.earned_hrs)}</td>
              <td className="text-right font-mono">{fmt.int(d.actual_hrs)}</td>
              <td className="text-right font-mono">{fmt.int(buffer)}</td>
              <td className="text-right font-mono">
                {cpi != null ? (
                  <VarianceCell value={cpi} neutral={1} variant="ratio" format={(v) => v.toFixed(3)} />
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
            <td className="text-right font-mono font-bold">{fmt.int(totalBuffer)}</td>
            <td className="text-right font-mono font-bold">
              {totalCpi != null ? (
                <VarianceCell value={totalCpi} neutral={1} variant="ratio" format={(v) => v.toFixed(3)} />
              ) : (
                '—'
              )}
            </td>
            <td className="text-right font-mono font-bold">{totalEac != null ? fmt.int(totalEac) : '—'}</td>
          </tr>
          {projectBcws > 0 && (
            <tr style={{ background: 'var(--color-raised)' }}>
              <td className="font-semibold text-[color:var(--color-text-muted)]" colSpan={4}>
                Schedule variance (planned = {fmt.int(projectBcws)} hrs)
              </td>
              <td className="text-right font-mono" colSpan={3}>
                {totalSv >= 0
                  ? `${fmt.int(totalSv)} hrs ahead · SPI `
                  : `${fmt.int(Math.abs(totalSv))} hrs behind · SPI `}
                {totalSpi != null ? (
                  <VarianceCell value={totalSpi} neutral={1} variant="ratio" format={(v) => v.toFixed(3)} />
                ) : (
                  '—'
                )}
              </td>
            </tr>
          )}
          {totalUnbudgeted > 0 && (
            <tr className="is-internal-only" style={{ background: 'var(--color-raised)' }}>
              <td className="font-semibold text-[color:var(--color-text-muted)]" colSpan={4}>
                Internal — unbudgeted actuals
              </td>
              <td className="text-right font-mono font-semibold" colSpan={3}>
                {fmt.int(totalUnbudgeted)} hrs (actual exceeds earned budget — CO required)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
