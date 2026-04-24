import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useProjectStore } from '@/stores/project';
import { useProgressRecords } from '@/lib/queries';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/FormField';
import { ProgressTable } from '@/components/progress/ProgressTable';
import { RecordDetail } from '@/components/progress/RecordDetail';

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
  const [discFilter, setDiscFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        <div className="h-6 bg-[color:var(--color-canvas)] rounded w-48 animate-pulse mb-3" />
        <div className="h-[400px] bg-[color:var(--color-canvas)] rounded animate-pulse" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="text-sm text-[color:var(--color-variance-unfavourable)]">
          Failed to load records: {(error as Error).message}
        </div>
      </Card>
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
          <Button variant="primary" disabled>
            + New Record
          </Button>
          <Button variant="outline" disabled>
            Import IFC Qty
          </Button>
          <Button variant="outline" disabled>
            Export
          </Button>
        </div>
      </div>

      <Card>
        <ProgressTable records={filtered} selectedId={selectedId} onSelect={setSelectedId} />
      </Card>

      {selected && (
        <RecordDetail
          record={selected}
          projectId={projectId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
