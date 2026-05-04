import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useProjectStore } from '@/stores/project';
import { useProgressRows, useIwps, useCurrentUser, hasRole } from '@/lib/queries';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/FormField';
import { ProgressTable } from '@/components/progress/ProgressTable';
import { RecordDetail } from '@/components/progress/RecordDetail';
import { NewRecordModal } from '@/components/progress/NewRecordModal';
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

export function ProgressPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: me } = useCurrentUser();
  const canAddRecord = hasRole(me?.role, 'editor');
  const [discFilter, setDiscFilter] = useState<string>('All');
  const [iwpFilter, setIwpFilter] = useState<string>('All');
  const [foremanFilter, setForemanFilter] = useState<string>('All');
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

  // Distinct foreman names present in current records.
  const foremen = useMemo(() => {
    const set = new Set<string>();
    for (const r of records ?? []) if (r.foreman_name) set.add(r.foreman_name);
    return Array.from(set).sort();
  }, [records]);

  const filtered = useMemo(() => {
    const all = records ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (discFilter !== 'All' && r.discipline_code !== discFilter) return false;
      if (iwpFilter !== 'All' && r.iwp_id !== iwpFilter) return false;
      if (foremanFilter !== 'All' && r.foreman_name !== foremanFilter) return false;
      if (!q) return true;
      return (
        (r.dwg ?? '').toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (r.line_area ?? '').toLowerCase().includes(q)
      );
    });
  }, [records, discFilter, iwpFilter, foremanFilter, search]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

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
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            aria-label="Discipline filter"
            className={inputClass}
            value={discFilter}
            onChange={(e) => setDiscFilter(e.target.value)}
          >
            <option value="All">All Disciplines</option>
            {disciplines?.map((d) => (
              <option key={d.discipline_code} value={d.discipline_code}>
                {d.display_name}
              </option>
            ))}
          </select>
          <select
            aria-label="IWP filter"
            className={inputClass}
            value={iwpFilter}
            onChange={(e) => setIwpFilter(e.target.value)}
          >
            <option value="All">All IWPs</option>
            {iwps?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Foreman filter"
            className={inputClass}
            value={foremanFilter}
            onChange={(e) => setForemanFilter(e.target.value)}
          >
            <option value="All">All Foremen</option>
            {foremen.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--color-text-muted)]"
            />
            <input
              className={`${inputClass} pl-8 w-64`}
              placeholder="Search DWG, description, line area…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
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
                  'DWG',
                  'Rev',
                  'Discipline',
                  'IWP',
                  'Foreman',
                  'Description',
                  'UOM',
                  'Budget Qty',
                  'Budget Hrs',
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
                  r.dwg ?? '',
                  r.rev ?? '',
                  r.discipline_name ?? '',
                  r.iwp_name ?? '',
                  r.foreman_name ?? '',
                  r.description,
                  r.uom,
                  r.budget_qty ?? '',
                  r.budget_hrs,
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
