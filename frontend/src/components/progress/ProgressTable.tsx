import { fmt } from '@/lib/format';
import type { ProgressRecord } from '@/lib/queries';

type Props = {
  records: ProgressRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ProgressTable({ records, selectedId, onSelect }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-[color:var(--color-canvas)]">
            {[
              'Rec', 'DWG', 'Rev', 'Discipline', 'Description', 'FLD QTY', 'UOM', 'FLD WHRS',
              'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8',
              'Earn %', 'ERN QTY', 'EARN WHRS',
            ].map((h) => (
              <th
                key={h}
                className="px-2 py-2 text-left font-semibold text-[10px] uppercase tracking-wide text-[color:var(--color-text-muted)] border-b-2 border-[color:var(--color-line)] whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const isSelected = r.id === selectedId;
            const pctColor =
              r.earn_pct >= 0.8
                ? 'var(--color-variance-favourable)'
                : r.earn_pct >= 0.4
                ? 'var(--color-accent)'
                : 'var(--color-text)';
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={`cursor-pointer border-b border-[color:var(--color-line)] ${
                  isSelected ? 'bg-[color:var(--color-status-locked-bg)]' : 'hover:bg-[color:var(--color-canvas)]'
                }`}
              >
                <td className="px-2 py-1.5 font-mono">{r.rec_no}</td>
                <td className="px-2 py-1.5 font-mono"><strong>{r.dwg}</strong></td>
                <td className="px-2 py-1.5">{r.rev}</td>
                <td className="px-2 py-1.5">{r.discipline_name}</td>
                <td className="px-2 py-1.5">{r.description}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.fld_qty.toFixed(1)}</td>
                <td className="px-2 py-1.5">{r.uom}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.fld_whrs.toFixed(1)}</td>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((seq) => {
                  const val = r.milestones.find((m) => m.seq === seq)?.value ?? 0;
                  const color =
                    val >= 1
                      ? 'var(--color-variance-favourable)'
                      : val > 0
                      ? 'var(--color-accent)'
                      : 'var(--color-line)';
                  return (
                    <td
                      key={seq}
                      className="px-2 py-1.5 text-center font-mono"
                      style={{ color, fontSize: 11 }}
                    >
                      {val >= 1 ? '1.0' : val > 0 ? val.toFixed(1) : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right font-mono font-semibold" style={{ color: pctColor }}>
                  {fmt.pct(r.earn_pct)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{r.ern_qty.toFixed(1)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.earn_whrs.toFixed(1)}</td>
              </tr>
            );
          })}
          {records.length === 0 && (
            <tr>
              <td colSpan={19} className="px-3 py-6 text-center text-sm text-[color:var(--color-text-muted)]">
                No records match your filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
