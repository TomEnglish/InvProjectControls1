import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useProjectStore } from '@/stores/project';
import { useProgressRows, useIwps, useCurrentUser, hasRole } from '@/lib/queries';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/FormField';
import { ProgressTable } from '@/components/progress/ProgressTable';
import { RecordDetail } from '@/components/progress/RecordDetail';
import { NewRecordModal } from '@/components/progress/NewRecordModal';
import { FilterDropdown } from '@/components/progress/FilterDropdown';
import { downloadCsv } from '@/lib/export';

function NoProject() {
  return (
    <Card>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Pick a project in the top bar to view records.
      </p>
    </Card>
  );
}

const emptySet = (): Set<string> => new Set();

export function ProgressPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: me } = useCurrentUser();
  const canAddRecord = hasRole(me?.role, 'editor');

  const [discFilter, setDiscFilter] = useState<Set<string>>(emptySet);
  const [iwpFilter, setIwpFilter] = useState<Set<string>>(emptySet);
  const [foremanFilter, setForemanFilter] = useState<Set<string>>(emptySet);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(emptySet);
  const [sizeFilter, setSizeFilter] = useState<Set<string>>(emptySet);
  const [specFilter, setSpecFilter] = useState<Set<string>>(emptySet);
  const [lineArea, setLineArea] = useState('');
  const [search, setSearch] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newRecordOpen, setNewRecordOpen] = useState(false);

  const { data: records, isLoading, error } = useProgressRows(projectId);
  const { data: iwps } = useIwps(projectId);

  const { data: disciplines } = useQuery({
    queryKey: ['project-disciplines-simple', projectId] as const,
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_disciplines')
        .select('discipline_code, display_name')
        .eq('project_id', projectId!)
        .order('discipline_code');
      if (error) throw error;
      return data;
    },
  });

  const distinct = useMemo(() => {
    const foremen = new Set<string>();
    const types = new Set<string>();
    const sizes = new Set<string>();
    const specs = new Set<string>();
    for (const r of records ?? []) {
      if (r.foreman_name) foremen.add(r.foreman_name);
      if (r.attr_type) types.add(r.attr_type);
      if (r.attr_size) sizes.add(r.attr_size);
      if (r.attr_spec) specs.add(r.attr_spec);
    }
    const sort = (s: Set<string>) => Array.from(s).sort();
    return {
      foremen: sort(foremen),
      types: sort(types),
      sizes: sort(sizes),
      specs: sort(specs),
    };
  }, [records]);

  const filtered = useMemo(() => {
    const all = records ?? [];
    const q = search.trim().toLowerCase();
    const la = lineArea.trim().toLowerCase();
    return all.filter((r) => {
      if (discFilter.size > 0 && (!r.discipline_code || !discFilter.has(r.discipline_code))) return false;
      if (iwpFilter.size > 0 && (!r.iwp_id || !iwpFilter.has(r.iwp_id))) return false;
      if (foremanFilter.size > 0 && (!r.foreman_name || !foremanFilter.has(r.foreman_name))) return false;
      if (typeFilter.size > 0 && (!r.attr_type || !typeFilter.has(r.attr_type))) return false;
      if (sizeFilter.size > 0 && (!r.attr_size || !sizeFilter.has(r.attr_size))) return false;
      if (specFilter.size > 0 && (!r.attr_spec || !specFilter.has(r.attr_spec))) return false;
      if (la && !(r.line_area ?? '').toLowerCase().includes(la)) return false;
      if (!q) return true;
      return (
        (r.dwg ?? '').toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (r.line_area ?? '').toLowerCase().includes(q)
      );
    });
  }, [records, discFilter, iwpFilter, foremanFilter, typeFilter, sizeFilter, specFilter, lineArea, search]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  const activeFilterCount =
    discFilter.size +
    iwpFilter.size +
    foremanFilter.size +
    typeFilter.size +
    sizeFilter.size +
    specFilter.size +
    (lineArea ? 1 : 0);

  const clearAll = () => {
    setDiscFilter(emptySet());
    setIwpFilter(emptySet());
    setForemanFilter(emptySet());
    setTypeFilter(emptySet());
    setSizeFilter(emptySet());
    setSpecFilter(emptySet());
    setLineArea('');
  };

  if (!projectId) return <NoProject />;

  if (isLoading) {
    return (
      <Card>
        <div className="is-skeleton mb-3" style={{ width: 200 }} />
        <div className="is-skeleton" style={{ height: 400, width: '100%' }} />
      </Card>
    );
  }

  if (error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load records: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <FilterDropdown
            label="Discipline"
            selected={discFilter}
            onChange={setDiscFilter}
            options={(disciplines ?? []).map((d) => ({
              value: d.discipline_code,
              label: d.display_name,
            }))}
          />
          <FilterDropdown
            label="IWP"
            selected={iwpFilter}
            onChange={setIwpFilter}
            options={(iwps ?? []).map((i) => ({ value: i.id, label: i.name }))}
          />
          <FilterDropdown
            label="Foreman"
            selected={foremanFilter}
            onChange={setForemanFilter}
            options={distinct.foremen.map((f) => ({ value: f, label: f }))}
          />
          <FilterDropdown
            label="Type"
            selected={typeFilter}
            onChange={setTypeFilter}
            options={distinct.types.map((t) => ({ value: t, label: t }))}
          />
          <FilterDropdown
            label="Size"
            selected={sizeFilter}
            onChange={setSizeFilter}
            options={distinct.sizes.map((s) => ({ value: s, label: s }))}
          />
          <FilterDropdown
            label="Spec"
            selected={specFilter}
            onChange={setSpecFilter}
            options={distinct.specs.map((s) => ({ value: s, label: s }))}
          />
          <input
            className={inputClass}
            placeholder="Line area contains…"
            value={lineArea}
            onChange={(e) => setLineArea(e.target.value)}
            style={{ width: 180 }}
          />
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--color-text-muted)]"
            />
            <input
              className={`${inputClass} pl-8 w-64`}
              placeholder="Search DWG, description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X size={14} /> Clear filters
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            disabled={!canAddRecord}
            onClick={() => setNewRecordOpen(true)}
          >
            + New Record
          </Button>
          <Button
            variant="outline"
            disabled={filtered.length === 0}
            onClick={() =>
              downloadCsv(
                `progress-${new Date().toISOString().slice(0, 10)}.csv`,
                [
                  'Rec',
                  'Source Row',
                  'DWG',
                  'Rev',
                  'Code',
                  'Discipline',
                  'IWP',
                  'CWP',
                  'Test Pkg',
                  'Sched ID',
                  'System',
                  'CAREA',
                  'Line / Area',
                  'Var Area',
                  'Foreman',
                  'Gen Foreman',
                  'Description',
                  'UOM',
                  'Type',
                  'Size',
                  'Material Spec',
                  'Paint Spec',
                  'Insu Spec',
                  'Heat Trace Spec',
                  'Spool Cnt',
                  'TA Bank',
                  'TA Bay',
                  'TA Level',
                  'PSLIP',
                  'Budget Qty',
                  'Actual Qty',
                  'Imported Earned Qty',
                  'Budget Hrs',
                  'Hrs/Unit',
                  'Actual Hrs',
                  'Imported Earned Hrs',
                  'M1',
                  'M2',
                  'M3',
                  'M4',
                  'M5',
                  'M6',
                  'M7',
                  'M8',
                  'Earn %',
                  'Earned Qty',
                  'Earned Hrs',
                  'Status',
                ],
                filtered.map((r) => [
                  r.record_no ?? '',
                  r.source_row ?? '',
                  r.dwg ?? '',
                  r.rev ?? '',
                  r.code ?? '',
                  r.discipline_name ?? '',
                  r.iwp_name ?? '',
                  r.cwp ?? '',
                  r.test_pkg ?? '',
                  r.sched_id ?? '',
                  r.system ?? '',
                  r.carea ?? '',
                  r.line_area ?? '',
                  r.var_area ?? '',
                  r.foreman_name ?? '',
                  r.gen_foreman_name ?? '',
                  r.description,
                  r.uom,
                  r.attr_type ?? '',
                  r.attr_size ?? '',
                  r.attr_spec ?? '',
                  r.paint_spec ?? '',
                  r.insu_spec ?? '',
                  r.heat_trace_spec ?? '',
                  r.spl_cnt ?? '',
                  r.ta_bank ?? '',
                  r.ta_bay ?? '',
                  r.ta_level ?? '',
                  r.pslip ?? '',
                  r.budget_qty ?? '',
                  r.actual_qty ?? '',
                  r.earned_qty_imported ?? '',
                  r.budget_hrs,
                  r.whrs_unit ?? '',
                  r.actual_hrs,
                  r.earn_whrs_imported ?? '',
                  ...Array.from({ length: 8 }, (_, i) => r.milestones.find((m) => m.seq === i + 1)?.value ?? 0),
                  (r.earn_pct * 100).toFixed(1) + '%',
                  r.earned_qty ?? '',
                  r.earned_hrs.toFixed(2),
                  r.status,
                ]),
              )
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="text-xs text-[color:var(--color-text-muted)]">
        Showing {filtered.length} of {records?.length ?? 0} records
        {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`}
      </div>

      <ProgressTable records={filtered} selectedId={selectedId} onSelect={setSelectedId} />

      {selected && (
        <RecordDetail
          record={selected}
          projectId={projectId}
          onClose={() => setSelectedId(null)}
        />
      )}

      <NewRecordModal
        open={newRecordOpen}
        onClose={() => setNewRecordOpen(false)}
        projectId={projectId}
      />
    </div>
  );
}
