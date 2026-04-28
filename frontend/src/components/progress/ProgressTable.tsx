import { fmt } from '@/lib/format';
import type { ProgressRecord } from '@/lib/queries';

type Props = {
  records: ProgressRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const headers = [
  'Rec', 'DWG', 'Rev', 'Discipline', 'Description', 'FLD QTY', 'UOM', 'FLD WHRS',
  'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8',
  'Earn %', 'ERN QTY', 'EARN WHRS',
];

export function ProgressTable({ records, selectedId, onSelect }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
      <table className="is-table" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap" style={{ padding: '10px 10px' }}>
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
                  ? 'var(--color-warn)'
                  : 'var(--color-text)';
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="cursor-pointer"
                style={
                  isSelected
                    ? { background: 'var(--color-primary-soft)' }
                    : undefined
                }
              >
                <td style={{ padding: '8px 10px' }} className="font-mono">{r.rec_no}</td>
                <td style={{ padding: '8px 10px' }} className="font-mono font-semibold">{r.dwg}</td>
                <td style={{ padding: '8px 10px' }}>{r.rev}</td>
                <td style={{ padding: '8px 10px' }}>{r.discipline_name}</td>
                <td style={{ padding: '8px 10px' }}>{r.description}</td>
                <td style={{ padding: '8px 10px' }} className="text-right font-mono">{r.fld_qty.toFixed(1)}</td>
                <td style={{ padding: '8px 10px' }}>{r.uom}</td>
                <td style={{ padding: '8px 10px' }} className="text-right font-mono">{r.fld_whrs.toFixed(1)}</td>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((seq) => {
                  const val = r.milestones.find((m) => m.seq === seq)?.value ?? 0;
                  const color =
                    val >= 1
                      ? 'var(--color-variance-favourable)'
                      : val > 0
                        ? 'var(--color-warn)'
                        : 'var(--color-text-subtle)';
                  return (
                    <td
                      key={seq}
                      style={{ padding: '8px 10px', color, fontSize: 12, textAlign: 'center' }}
                      className="font-mono"
                    >
                      {val >= 1 ? '1.0' : val > 0 ? val.toFixed(1) : '—'}
                    </td>
                  );
                })}
                <td style={{ padding: '8px 10px', color: pctColor }} className="text-right font-mono font-semibold">
                  {fmt.pct(r.earn_pct)}
                </td>
                <td style={{ padding: '8px 10px' }} className="text-right font-mono">{r.ern_qty.toFixed(1)}</td>
                <td style={{ padding: '8px 10px' }} className="text-right font-mono">{r.earn_whrs.toFixed(1)}</td>
              </tr>
            );
          })}
          {records.length === 0 && (
            <tr>
              <td
                colSpan={19}
                className="text-center text-[color:var(--color-text-muted)]"
                style={{ padding: '32px 16px' }}
              >
                No records match your filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
