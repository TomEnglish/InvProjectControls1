import { useMemo, useState } from 'react';
import { Plus, Pencil, Search, ListTree } from 'lucide-react';
import { useCoaCodes, useCurrentUser, hasRole, type CoaCodeRow } from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { selectClass } from '@/components/ui/FormField';
import { CoaCodeModal } from '@/components/coa/CoaCodeModal';
import { fmt } from '@/lib/format';

export function CoaPage() {
  const { data: codes, isLoading, error } = useCoaCodes();
  const { data: me } = useCurrentUser();
  const canEdit = hasRole(me?.role, 'admin');

  const [primeFilter, setPrimeFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CoaCodeRow | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  const primes = useMemo(() => {
    const set = new Set<string>();
    for (const c of codes ?? []) set.add(c.prime);
    return Array.from(set).sort();
  }, [codes]);

  const filtered = useMemo(() => {
    const all = codes ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((c) => {
      if (primeFilter !== 'All' && c.prime !== primeFilter) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    });
  }, [codes, primeFilter, search]);

  if (isLoading) {
    return (
      <div className="is-surface p-6">
        <div className="is-skeleton mb-3" style={{ width: 220 }} />
        <div className="is-skeleton" style={{ height: 360, width: '100%' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load COA: {(error as Error).message}
      </div>
    );
  }

  if ((codes ?? []).length === 0) {
    return (
      <div className="is-surface is-empty">
        <div className="is-empty-icon">
          <ListTree size={28} />
        </div>
        <div className="is-empty-title">No cost codes yet</div>
        <p className="is-empty-caption">
          Add your first code, or import a COA workbook in Project Setup.
        </p>
        {canEdit && (
          <Button variant="primary" onClick={() => setCreatingNew(true)}>
            <Plus size={14} /> Add cost code
          </Button>
        )}
        <CoaCodeModal open={creatingNew} onClose={() => setCreatingNew(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            aria-label="Prime filter"
            className={selectClass}
            style={{ width: 160 }}
            value={primeFilter}
            onChange={(e) => setPrimeFilter(e.target.value)}
          >
            <option value="All">All Primes</option>
            {primes.map((p) => (
              <option key={p} value={p}>
                Prime {p}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--color-text-muted)]"
            />
            <input
              className="is-form-input pl-8"
              style={{ width: 280 }}
              placeholder="Search code or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={() => setCreatingNew(true)}>
            <Plus size={14} /> Add cost code
          </Button>
        )}
      </div>

      <div className="is-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-[color:var(--color-line)] flex items-baseline justify-between">
          <div>
            <h3 className="text-sm font-semibold">Cost codes</h3>
            <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
              {filtered.length} of {codes!.length} codes
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="is-table">
            <thead>
              <tr>
                <th>Prime</th>
                <th>Code</th>
                <th>Description</th>
                <th>Parent</th>
                <th style={{ textAlign: 'right' }}>Level</th>
                <th>UOM</th>
                <th style={{ textAlign: 'right' }}>Base U/R</th>
                <th style={{ textAlign: 'right' }}>PF Adj</th>
                <th style={{ textAlign: 'right' }}>PF U/R</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono">{c.prime}</td>
                  <td className="font-mono font-semibold">{c.code}</td>
                  <td>{c.description}</td>
                  <td className="font-mono text-[color:var(--color-text-muted)]">
                    {c.parent ?? '—'}
                  </td>
                  <td className="text-right font-mono">{c.level}</td>
                  <td>{c.uom}</td>
                  <td className="text-right font-mono">{fmt.rate(c.base_rate)}</td>
                  <td className="text-right font-mono">{c.pf_adj.toFixed(4)}</td>
                  <td className="text-right font-mono font-semibold">
                    {fmt.rate(c.pf_rate)}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        onClick={() => setEditing(c)}
                        aria-label={`Edit ${c.code}`}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-soft)] transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={canEdit ? 10 : 9}
                    className="text-center text-[color:var(--color-text-muted)] py-6"
                  >
                    No codes match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CoaCodeModal open={creatingNew} onClose={() => setCreatingNew(false)} />
      <CoaCodeModal open={!!editing} onClose={() => setEditing(null)} initial={editing} />
    </div>
  );
}
