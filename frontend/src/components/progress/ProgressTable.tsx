import { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { fmt } from '@/lib/format';
import type { ProgressRow, WorkTypeMilestone } from '@/lib/queries';

type Props = {
  records: ProgressRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  getMilestones: (record: ProgressRow) => WorkTypeMilestone[];
  /** Unfiltered record count — distinguishes "no records yet" from "filters match nothing". */
  totalCount: number;
};

function milestoneTooltip(meta: WorkTypeMilestone, seq: number): string {
  return `M${seq}: ${meta.label}\nWeight: ${fmt.pct(meta.weight)}`;
}

type SortKey = 'record_no' | 'dwg' | 'code' | 'discipline' | 'description' | 'budget_hrs' | 'earn_pct';
type SortDir = 'asc' | 'desc';

const headers: { label: string; key: SortKey | null; align?: 'right' }[] = [
  { label: 'Rec', key: 'record_no' },
  { label: 'DWG', key: 'dwg' },
  { label: 'Rev', key: null },
  { label: 'Account code', key: 'code' },
  { label: 'Discipline', key: 'discipline' },
  { label: 'IWP', key: null },
  { label: 'Foreman', key: null },
  { label: 'Description', key: 'description' },
  { label: 'Budget Qty', key: null },
  { label: 'UOM', key: null },
  { label: 'Budget Hrs', key: 'budget_hrs', align: 'right' },
  { label: 'M1', key: null },
  { label: 'M2', key: null },
  { label: 'M3', key: null },
  { label: 'M4', key: null },
  { label: 'M5', key: null },
  { label: 'M6', key: null },
  { label: 'M7', key: null },
  { label: 'M8', key: null },
  { label: 'Earn %', key: 'earn_pct', align: 'right' },
  { label: 'Earned Qty', key: null },
  { label: 'Earned Hrs', key: null },
];

export function ProgressTable({ records, selectedId, onSelect, getMilestones, totalCount }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'record_no', dir: 'asc' });

  const sorted = useMemo(() => {
    const list = records.slice();
    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const get = (r: ProgressRow): number | string => {
        switch (sort.key) {
          case 'record_no': return r.record_no ?? 0;
          case 'dwg': return r.dwg ?? '';
          case 'code': return r.code ?? '';
          case 'discipline': return r.discipline_name ?? '';
          case 'description': return r.description;
          case 'budget_hrs': return r.budget_hrs;
          case 'earn_pct': return r.earn_pct;
        }
      };
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return list;
  }, [records, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  return (
    <div className="overflow-auto rounded-md border border-[color:var(--color-line)]" style={{ maxHeight: '60vh' }}>
      <table className="is-table" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h.label}
                className={`whitespace-nowrap ${h.align === 'right' ? 'text-right' : ''}`}
                style={{ padding: '10px 10px', position: 'sticky', top: 0, zIndex: 1 }}
              >
                {h.key ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(h.key!)}
                    className="inline-flex items-center gap-1 hover:text-[color:var(--color-text)] transition-colors"
                    style={{
                      color: sort.key === h.key ? 'var(--color-text)' : 'var(--color-text-muted)',
                    }}
                  >
                    {h.label}
                    {sort.key === h.key && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                ) : (
                  h.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const isSelected = r.id === selectedId;
            const milestoneDefs = getMilestones(r);
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
                tabIndex={0}
                aria-selected={isSelected}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r.id);
                  }
                }}
                className="cursor-pointer"
                style={isSelected ? { background: 'var(--color-primary-soft)' } : undefined}
              >
                <td style={{ padding: '8px 10px' }} className="font-mono">{r.record_no ?? '—'}</td>
                <td style={{ padding: '8px 10px' }} className="font-mono font-semibold">{r.dwg ?? '—'}</td>
                <td style={{ padding: '8px 10px' }}>{r.rev ?? '—'}</td>
                <td style={{ padding: '8px 10px' }} className="font-mono">{r.code ?? '—'}</td>
                <td style={{ padding: '8px 10px' }}>{r.discipline_name ?? '—'}</td>
                <td style={{ padding: '8px 10px' }}>{r.iwp_name ?? '—'}</td>
                <td style={{ padding: '8px 10px' }}>{r.foreman_name ?? '—'}</td>
                <td style={{ padding: '8px 10px' }}>{r.description}</td>
                <td style={{ padding: '8px 10px' }} className="text-right font-mono">
                  {r.budget_qty != null ? r.budget_qty.toFixed(1) : '—'}
                </td>
                <td style={{ padding: '8px 10px' }}>{r.uom}</td>
                <td style={{ padding: '8px 10px' }} className="text-right font-mono">{r.budget_hrs.toFixed(1)}</td>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((seq) => {
                  const val = r.milestones.find((m) => m.seq === seq)?.value ?? 0;
                  const meta = milestoneDefs.find((m) => m.seq === seq);
                  const tip = meta ? milestoneTooltip(meta, seq) : undefined;
                  const color =
                    val >= 100
                      ? 'var(--color-variance-favourable)'
                      : val > 0
                        ? 'var(--color-warn)'
                        : 'var(--color-text-subtle)';
                  return (
                    <td
                      key={seq}
                      style={{ padding: '8px 10px', color, fontSize: 12, textAlign: 'center' }}
                      className={`font-mono ${tip ? 'is-tip cursor-help' : ''}`}
                      data-tip={tip}
                    >
                      {val >= 100 ? '100' : val > 0 ? val.toFixed(0) : '—'}
                    </td>
                  );
                })}
                <td
                  style={{ padding: '8px 10px', color: pctColor }}
                  className="text-right font-mono font-semibold"
                >
                  {fmt.pct(r.earn_pct)}
                </td>
                <td style={{ padding: '8px 10px' }} className="text-right font-mono">
                  {r.earned_qty != null ? r.earned_qty.toFixed(1) : '—'}
                </td>
                <td style={{ padding: '8px 10px' }} className="text-right font-mono">
                  {r.earned_hrs.toFixed(1)}
                </td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={headers.length}
                className="text-center text-[color:var(--color-text-muted)]"
                style={{ padding: '32px 16px' }}
              >
                {totalCount === 0
                  ? 'No records yet — add one with “+ New Record” or import an audit file on the Upload page.'
                  : 'No records match your filters.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
