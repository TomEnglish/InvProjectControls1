import { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import { useDashboardSummary, useProgressRows } from '@/lib/queries';
import type { ProgressRow } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { KpiCard, KpiCardSkeleton } from '@/components/dashboard/KpiCard';
import { EarnedValueByDisciplineChart } from '@/components/dashboard/EarnedValueByDisciplineChart';
import { FilterDropdown } from '@/components/progress/FilterDropdown';
import { fmt } from '@/lib/format';

function NoProject() {
  return (
    <Card>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Pick a project in the top bar to view earned-value details.
      </p>
    </Card>
  );
}

type SortKey = 'dwg' | 'description' | 'discipline' | 'budget' | 'earned' | 'remaining' | 'percent';
type SortDir = 'asc' | 'desc';

const PCT_BUCKETS: { value: string; label: string; test: (p: number) => boolean }[] = [
  { value: '0', label: 'Not started (0%)', test: (p) => p === 0 },
  { value: '1-25', label: '1–25%', test: (p) => p > 0 && p <= 25 },
  { value: '26-50', label: '26–50%', test: (p) => p > 25 && p <= 50 },
  { value: '51-75', label: '51–75%', test: (p) => p > 50 && p <= 75 },
  { value: '76-99', label: '76–99%', test: (p) => p > 75 && p < 100 },
  { value: '100', label: 'Complete (100%)', test: (p) => p >= 100 },
];

export function EarnedValuePage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const summary = useDashboardSummary(projectId);
  const rows = useProgressRows(projectId);

  const [discFilter, setDiscFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [pctFilter, setPctFilter] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'remaining', dir: 'desc' });

  // Memoise so the `[]` fallback identity is stable across renders — without
  // it useMemo dependencies below would change every render and the lint
  // rule fires.
  const allRows = useMemo(() => rows.data ?? [], [rows.data]);

  const distinctStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) set.add(r.status);
    return Array.from(set).sort();
  }, [allRows]);

  const filtered = useMemo(() => {
    return allRows.filter((r) => {
      if (discFilter.size > 0 && (!r.discipline_code || !discFilter.has(r.discipline_code))) return false;
      if (statusFilter.size > 0 && !statusFilter.has(r.status)) return false;
      if (pctFilter.size > 0) {
        const matches = PCT_BUCKETS.some((b) => pctFilter.has(b.value) && b.test(r.percent_complete));
        if (!matches) return false;
      }
      return true;
    });
  }, [allRows, discFilter, statusFilter, pctFilter]);

  const sorted = useMemo(() => {
    const list = filtered.slice();
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = sort.key;
    list.sort((a, b) => {
      // Done rows always sink to the bottom regardless of the user's sort
      // direction — Sandra's UAT feedback was that mixing completed records
      // with in-progress ones makes the "what's still open" read hard.
      const aDone = a.percent_complete >= 100;
      const bDone = b.percent_complete >= 100;
      if (aDone !== bDone) return aDone ? 1 : -1;

      const get = (r: ProgressRow): number | string => {
        switch (key) {
          case 'dwg': return r.dwg ?? '';
          case 'description': return r.description;
          case 'discipline': return r.discipline_name ?? '';
          case 'budget': return r.budget_hrs;
          case 'earned': return r.earned_hrs;
          case 'remaining': return Math.abs(r.budget_hrs - r.earned_hrs);
          case 'percent': return r.percent_complete;
        }
      };
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return showAll ? list : list.slice(0, 20);
  }, [filtered, sort, showAll]);

  const activeFilterCount = discFilter.size + statusFilter.size + pctFilter.size;
  const clearAll = () => {
    setDiscFilter(new Set());
    setStatusFilter(new Set());
    setPctFilter(new Set());
  };

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  if (!projectId) return <NoProject />;
  if (summary.isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (summary.error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load earned value: {summary.error.message}
      </div>
    );
  }
  const s = summary.data;
  if (!s) return <NoProject />;

  const cpiTone = s.cpi == null ? 'neutral' : s.cpi >= 1 ? 'favourable' : 'unfavourable';
  const spiTone = s.spi == null ? 'neutral' : s.spi >= 1 ? 'favourable' : 'unfavourable';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Earned %"
          value={fmt.pct(s.overall_pct)}
          subtext={`${fmt.int(s.total_earned_hrs)} / ${fmt.int(s.total_budget_hrs)} hrs`}
        />
        <KpiCard label="Total Earned" value={fmt.int(s.total_earned_hrs)} subtext="Hours earned" />
        <KpiCard
          label="Total Budget"
          value={fmt.int(s.total_budget_hrs)}
          subtext="Hours budgeted"
        />
        <KpiCard
          label="CPI"
          value={fmt.ratio(s.cpi)}
          subtext={s.cpi == null ? 'No actuals' : s.cpi >= 1 ? 'Under budget' : 'Over budget'}
          tone={cpiTone}
        />
        <KpiCard
          label="SPI"
          value={fmt.ratio(s.spi)}
          subtext={s.spi == null ? 'No baseline' : s.spi >= 1 ? 'Ahead' : 'Behind'}
          tone={spiTone}
        />
      </div>

      <Card>
        <CardHeader
          eyebrow="By discipline"
          title="Budget vs earned vs actual"
          caption="Hours per discipline."
        />
        {s.disciplines.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-[color:var(--color-text-muted)]">
            No active disciplines yet.
          </div>
        ) : (
          <div className="h-72">
            <EarnedValueByDisciplineChart disciplines={s.disciplines} />
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="px-6 pt-5 pb-3">
          <CardHeader
            eyebrow={showAll ? 'All records' : 'Top 20'}
            title="Records by remaining hours"
            caption="Filter, sort, and switch between a focused top-20 view and the full record list. Negative remaining = over budget."
          />
        </div>

        <div className="px-6 pb-3 flex flex-wrap items-center gap-2">
          <FilterDropdown
            label="Discipline"
            selected={discFilter}
            onChange={setDiscFilter}
            options={s.disciplines.map((d) => ({ value: d.discipline_code, label: d.display_name }))}
          />
          <FilterDropdown
            label="Status"
            selected={statusFilter}
            onChange={setStatusFilter}
            options={distinctStatuses.map((st) => ({ value: st, label: st }))}
          />
          <FilterDropdown
            label="% Complete"
            selected={pctFilter}
            onChange={setPctFilter}
            options={PCT_BUCKETS.map((b) => ({ value: b.value, label: b.label }))}
          />

          <div
            role="group"
            aria-label="View toggle"
            className="ml-auto inline-flex rounded-md border border-[color:var(--color-line-strong)] overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                background: !showAll ? 'var(--color-primary)' : 'transparent',
                color: !showAll ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              }}
            >
              Top 20
            </button>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                background: showAll ? 'var(--color-primary)' : 'transparent',
                color: showAll ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              }}
            >
              All
            </button>
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="px-6 pb-2 text-xs text-[color:var(--color-text-muted)]">
          Showing {sorted.length} of {filtered.length}
          {filtered.length !== allRows.length && ` filtered (of ${allRows.length} total)`}
          {!showAll && filtered.length > 20 && ' · top 20'}
        </div>

        <div className="overflow-x-auto">
          <table className="is-table">
            <thead>
              <tr>
                <SortHeader label="DWG" k="dwg" sort={sort} onClick={toggleSort} />
                <SortHeader label="Description" k="description" sort={sort} onClick={toggleSort} />
                <SortHeader label="Discipline" k="discipline" sort={sort} onClick={toggleSort} />
                <SortHeader label="Budget hrs" k="budget" sort={sort} onClick={toggleSort} align="right" />
                <SortHeader label="Earned hrs" k="earned" sort={sort} onClick={toggleSort} align="right" />
                <SortHeader label="Hrs remaining" k="remaining" sort={sort} onClick={toggleSort} align="right" />
                <SortHeader label="% Complete" k="percent" sort={sort} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[color:var(--color-text-muted)] py-8">
                    {allRows.length === 0 ? 'No records yet.' : 'No records match your filters.'}
                  </td>
                </tr>
              )}
              {sorted.map((r) => {
                const remaining = r.budget_hrs - r.earned_hrs;
                return (
                  <tr key={r.id}>
                    <td className="font-mono">{r.dwg ?? '—'}</td>
                    <td>{r.description}</td>
                    <td>{r.discipline_name ?? '—'}</td>
                    <td className="text-right font-mono">{fmt.int(r.budget_hrs)}</td>
                    <td className="text-right font-mono">{fmt.int(r.earned_hrs)}</td>
                    <td
                      className="text-right font-mono"
                      style={{
                        color:
                          remaining < 0
                            ? 'var(--color-variance-unfavourable)'
                            : 'var(--color-text)',
                      }}
                    >
                      {fmt.int(remaining)}
                    </td>
                    <td className="text-right font-mono">{r.percent_complete.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sort,
  onClick,
  align,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onClick: (k: SortKey) => void;
  align?: 'right';
}) {
  const active = sort.key === k;
  const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className="inline-flex items-center gap-1 hover:text-[color:var(--color-text)] transition-colors"
        style={{ color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}
      >
        {label}
        {active && <Icon size={12} />}
      </button>
    </th>
  );
}
