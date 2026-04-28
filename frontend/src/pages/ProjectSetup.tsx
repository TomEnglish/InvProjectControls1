import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useProjectStore } from '@/stores/project';
import { useCurrentUser, hasRole } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import { StatusChip } from '@/components/ui/StatusChip';
import { fmt } from '@/lib/format';
import { AddDisciplineModal } from '@/components/projects/AddDisciplineModal';

type Project = {
  id: string;
  tenant_id: string;
  project_code: string;
  name: string;
  client: string;
  status: string;
  start_date: string;
  end_date: string;
  manager_id: string | null;
  baseline_locked_at: string | null;
};

type Discipline = {
  id: string;
  discipline_code: string;
  display_name: string;
  budget_hrs: number;
  is_active: boolean;
  roc_template_id: string | null;
};

function NoProjectSelected() {
  return (
    <Card>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Pick a project in the top bar to view its setup.
      </p>
    </Card>
  );
}

export function ProjectSetupPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canEdit = hasRole(me?.role, 'pm');

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<Project | null> => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId!)
        .maybeSingle();
      if (error) throw error;
      return data as Project | null;
    },
  });

  const { data: disciplines } = useQuery({
    queryKey: ['disciplines', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<Discipline[]> => {
      const { data, error } = await supabase
        .from('project_disciplines')
        .select('id, discipline_code, display_name, budget_hrs, is_active, roc_template_id')
        .eq('project_id', projectId!)
        .order('discipline_code');
      if (error) throw error;
      return (data ?? []) as Discipline[];
    },
  });

  const [draft, setDraft] = useState<Project | null>(null);
  useEffect(() => {
    setDraft(project ?? null);
  }, [project]);

  const [addDisciplineOpen, setAddDisciplineOpen] = useState(false);

  const saveProject = useMutation({
    mutationFn: async (payload: Partial<Project>) => {
      const { error } = await supabase
        .from('projects')
        .update({
          name: payload.name,
          client: payload.client,
          start_date: payload.start_date,
          end_date: payload.end_date,
        })
        .eq('id', projectId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  if (!projectId) return <NoProjectSelected />;
  if (loadingProject || !project || !draft) {
    return (
      <Card>
        <div className="h-6 bg-[color:var(--color-canvas)] rounded w-48 animate-pulse" />
      </Card>
    );
  }

  const locked = project.status !== 'draft';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Project Information"
          actions={<StatusChip kind={project.status} />}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Project Code">
            <input className={inputClass} value={draft.project_code} readOnly />
          </Field>
          <Field label="Project Name">
            <input
              className={inputClass}
              value={draft.name}
              disabled={locked || !canEdit}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Client">
            <input
              className={inputClass}
              value={draft.client}
              disabled={locked || !canEdit}
              onChange={(e) => setDraft({ ...draft, client: e.target.value })}
            />
          </Field>
          <Field label="Start Date">
            <input
              type="date"
              className={inputClass}
              value={draft.start_date}
              disabled={locked || !canEdit}
              onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
            />
          </Field>
          <Field label="End Date">
            <input
              type="date"
              className={inputClass}
              value={draft.end_date}
              disabled={locked || !canEdit}
              onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
            />
          </Field>
          <Field label="Baseline Locked">
            <input
              className={inputClass}
              readOnly
              value={project.baseline_locked_at ? new Date(project.baseline_locked_at).toLocaleDateString() : '—'}
            />
          </Field>
        </div>
        {canEdit && (
          <div className="mt-4 flex gap-2 items-center">
            <Button
              variant="primary"
              disabled={locked || saveProject.isPending}
              onClick={() => saveProject.mutate(draft)}
            >
              {saveProject.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
            {locked && (
              <span className="text-xs text-[color:var(--color-text-muted)]">
                Baseline locked — changes to budget/scope require a Change Order.
              </span>
            )}
            {saveProject.isSuccess && (
              <span className="text-xs text-[color:var(--color-variance-favourable)]">Saved.</span>
            )}
            {saveProject.isError && (
              <span className="text-xs text-[color:var(--color-variance-unfavourable)]">
                {(saveProject.error as Error).message}
              </span>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Active Disciplines"
          actions={
            canEdit && !locked ? (
              <Button variant="outline" size="sm" onClick={() => setAddDisciplineOpen(true)}>
                + Add Discipline
              </Button>
            ) : undefined
          }
        />
        <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
          <table className="is-table">
            <thead>
              <tr>
                <th>Discipline</th>
                <th>Code</th>
                <th style={{ textAlign: 'right' }}>Budget Hours</th>
                <th>ROC Template</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(disciplines ?? []).map((d) => (
                <tr key={d.id}>
                  <td className="font-semibold">{d.display_name}</td>
                  <td className="font-mono">{d.discipline_code}</td>
                  <td className="text-right font-mono">{fmt.int(d.budget_hrs)}</td>
                  <td className="text-[color:var(--color-text-muted)]">
                    {d.roc_template_id ? `${d.discipline_code} Standard (8 milestones)` : '— none —'}
                  </td>
                  <td>
                    <StatusChip kind={d.is_active ? 'active' : 'closed'} />
                  </td>
                </tr>
              ))}
              {disciplines && disciplines.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-[color:var(--color-text-muted)] py-6">
                    No disciplines yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Quantity Takeoff Import"
          caption="61-column unified audit workbook. Validation runs row-by-row; the file is rejected whole on any failure."
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() =>
              alert(
                'Import edge function arrives in Phase 3. For now use the seed script or direct SQL inserts.',
              )
            }
          >
            <Upload size={14} /> Upload Workbook
          </Button>
          <Button variant="outline" disabled>
            <Download size={14} /> Download Template
          </Button>
        </div>
      </Card>

      <AddDisciplineModal
        open={addDisciplineOpen}
        onClose={() => setAddDisciplineOpen(false)}
        projectId={projectId}
        existingCodes={(disciplines ?? []).map((d) => d.discipline_code)}
      />
    </div>
  );
}
