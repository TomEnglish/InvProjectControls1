import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useProjectStore } from '@/stores/project';
import { useProgressRecords, useCurrentUser, hasRole } from '@/lib/queries';
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
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newRecordOpen, setNewRecordOpen] = useState(false);

  const { data: records, isLoading, error } = useProgressRecords(projectId);

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

  const filtered = useMemo(() => {
    const all = records ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (discFilter !== 'All' && r.discipline_code !== discFilter) return false;
      if (!q) return true;
      return r.dwg.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
    });
  }, [records, discFilter, search]);

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
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            disabled={!canAddRecord}
            onClick={() => setNewRecordOpen(true)}
          >
            + New Record
          </Button>
          <Button variant="outline" disabled>
            Import IFC Qty
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
                  'Description',
                  'UOM',
                  'FLD QTY',
                  'FLD WHRS',
                  'M1',
                  'M2',
                  'M3',
                  'M4',
                  'M5',
                  'M6',
                  'M7',
                  'M8',
                  'Earn %',
                  'ERN QTY',
                  'EARN WHRS',
                  'COA Code',
                  'Status',
                ],
                filtered.map((r) => [
                  r.rec_no,
                  r.dwg,
                  r.rev,
                  r.discipline_name,
                  r.description,
                  r.uom,
                  r.fld_qty,
                  r.fld_whrs,
                  ...Array.from({ length: 8 }, (_, i) => r.milestones.find((m) => m.seq === i + 1)?.value ?? 0),
                  (r.earn_pct * 100).toFixed(1) + '%',
                  r.ern_qty.toFixed(2),
                  r.earn_whrs.toFixed(2),
                  r.coa_code,
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
