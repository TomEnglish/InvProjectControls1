import { fmt } from '@/lib/format';
import type { QmrCraft, QmrTotals } from '@/lib/qmrTypes';

const COL_COUNT = 14;

type Props = {
  crafts: QmrCraft[];
  grandTotals: QmrTotals;
  grandPct: number;
  /** Extra class on the scroll wrapper (e.g. expanded modal sizing). */
  scrollClassName?: string;
};

export function QmrTable({ crafts, grandTotals, grandPct, scrollClassName = '' }: Props) {
  return (
    <div className={`is-qmr-scroll ${scrollClassName}`.trim()}>
      <table className="is-table is-qmr-table">
        <thead>
          <tr>
            <th className="is-qmr-col-code">Code</th>
            <th className="is-qmr-col-desc">Description</th>
            <th className="is-qmr-col-um">UM</th>
            <th className="is-qmr-col-num" style={{ textAlign: 'right' }}>
              % Cmp
            </th>
            <th className="is-qmr-col-num" style={{ textAlign: 'right' }}>
              Bdgt Qty
            </th>
            <th className="is-qmr-col-num" style={{ textAlign: 'right' }}>
              Ern Qty
            </th>
            <th className="is-qmr-col-num" style={{ textAlign: 'right' }}>
              Inst Qty
            </th>
            <th className="is-qmr-col-num" style={{ textAlign: 'right' }}>
              Rem Qty
            </th>
            <th className="is-qmr-col-num" style={{ textAlign: 'right' }}>
              Bdgt Hrs
            </th>
            <th className="is-qmr-col-num" style={{ textAlign: 'right' }}>
              Spent
            </th>
            <th className="is-qmr-col-num" style={{ textAlign: 'right' }}>
              Ern Hrs
            </th>
            <th className="is-qmr-col-num" style={{ textAlign: 'right' }}>
              Rem Hrs
            </th>
            <th className="is-qmr-col-num is-internal-col" style={{ textAlign: 'right' }}>
              Cur U/R
            </th>
            <th className="is-qmr-col-num is-internal-col" style={{ textAlign: 'right' }}>
              Act/Ern U/R
            </th>
          </tr>
        </thead>
        <tbody>
          {crafts.map((craft) => (
            <CraftBlock key={craft.prime} craft={craft} />
          ))}
          <tr style={{ background: 'var(--color-primary-soft)' }}>
            <td className="font-bold" colSpan={3}>
              PROJECT TOTAL
            </td>
            <td className="text-right font-mono font-bold">{grandPct.toFixed(1)}%</td>
            <td className="text-right font-mono font-bold">{fmt.int(grandTotals.budget_qty)}</td>
            <td className="text-right font-mono font-bold">{fmt.int(grandTotals.earned_qty)}</td>
            <td className="text-right font-mono font-bold">{fmt.int(grandTotals.installed_qty)}</td>
            <td className="text-right font-mono font-bold">
              {fmt.int(Math.max(0, grandTotals.budget_qty - grandTotals.earned_qty))}
            </td>
            <td className="text-right font-mono font-bold">{fmt.int(grandTotals.budget_hrs)}</td>
            <td className="text-right font-mono font-bold">{fmt.int(grandTotals.spent_hrs)}</td>
            <td className="text-right font-mono font-bold">{fmt.int(grandTotals.earned_hrs)}</td>
            <td className="text-right font-mono font-bold">
              {fmt.int(Math.max(0, grandTotals.budget_hrs - grandTotals.earned_hrs))}
            </td>
            <td className="is-internal-col text-right font-mono font-bold">
              {grandTotals.budget_qty > 0
                ? (grandTotals.budget_hrs / grandTotals.budget_qty).toFixed(2)
                : '—'}
            </td>
            <td className="is-internal-col text-right font-mono font-bold">
              {grandTotals.earned_hrs > 0
                ? (grandTotals.spent_hrs / grandTotals.earned_hrs).toFixed(2)
                : '—'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CraftBlock({ craft }: { craft: QmrCraft }) {
  return (
    <>
      <tr className="is-qmr-craft-row" style={{ background: 'var(--color-raised)' }}>
        <td className="font-bold uppercase" colSpan={COL_COUNT}>
          {craft.prime} {craft.display_name}
        </td>
      </tr>
      {craft.leaves.map((leaf) => {
        const remQty = Math.max(0, leaf.budget_qty - leaf.earned_qty);
        const remHrs = Math.max(0, leaf.budget_hrs - leaf.earned_hrs);
        const curUr = leaf.budget_qty > 0 ? leaf.budget_hrs / leaf.budget_qty : null;
        const actErnUr = leaf.earned_hrs > 0 ? leaf.spent_hrs / leaf.earned_hrs : null;
        return (
          <tr key={leaf.code}>
            <td className="font-mono is-qmr-col-code">{leaf.code}</td>
            <td className="is-qmr-col-desc">{leaf.description}</td>
            <td className="is-qmr-col-um">{leaf.uom}</td>
            <td className="text-right font-mono">{leaf.percent_complete.toFixed(1)}%</td>
            <td className="text-right font-mono">{fmt.int(leaf.budget_qty)}</td>
            <td className="text-right font-mono">{fmt.int(leaf.earned_qty)}</td>
            <td className="text-right font-mono">{fmt.int(leaf.installed_qty)}</td>
            <td className="text-right font-mono">{fmt.int(remQty)}</td>
            <td className="text-right font-mono">{fmt.int(leaf.budget_hrs)}</td>
            <td className="text-right font-mono">{fmt.int(leaf.spent_hrs)}</td>
            <td className="text-right font-mono">{fmt.int(leaf.earned_hrs)}</td>
            <td className="text-right font-mono">{fmt.int(remHrs)}</td>
            <td className="is-internal-col text-right font-mono">
              {curUr != null ? curUr.toFixed(2) : '—'}
            </td>
            <td className="is-internal-col text-right font-mono">
              {actErnUr != null ? actErnUr.toFixed(2) : '—'}
            </td>
          </tr>
        );
      })}
      {(() => {
        const remQty = Math.max(0, craft.totals.budget_qty - craft.totals.earned_qty);
        const remHrs = Math.max(0, craft.totals.budget_hrs - craft.totals.earned_hrs);
        const curUr =
          craft.totals.budget_qty > 0
            ? craft.totals.budget_hrs / craft.totals.budget_qty
            : null;
        const actErnUr =
          craft.totals.earned_hrs > 0
            ? craft.totals.spent_hrs / craft.totals.earned_hrs
            : null;
        return (
          <tr style={{ background: 'var(--color-surface)' }}>
            <td className="font-semibold" colSpan={3}>
              {craft.display_name} subtotal
            </td>
            <td className="text-right font-mono font-semibold">
              {craft.totals.percent_complete.toFixed(1)}%
            </td>
            <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.budget_qty)}</td>
            <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.earned_qty)}</td>
            <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.installed_qty)}</td>
            <td className="text-right font-mono font-semibold">{fmt.int(remQty)}</td>
            <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.budget_hrs)}</td>
            <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.spent_hrs)}</td>
            <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.earned_hrs)}</td>
            <td className="text-right font-mono font-semibold">{fmt.int(remHrs)}</td>
            <td className="is-internal-col text-right font-mono font-semibold">
              {curUr != null ? curUr.toFixed(2) : '—'}
            </td>
            <td className="is-internal-col text-right font-mono font-semibold">
              {actErnUr != null ? actErnUr.toFixed(2) : '—'}
            </td>
          </tr>
        );
      })()}
    </>
  );
}
