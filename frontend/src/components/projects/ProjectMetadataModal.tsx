import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { fmt } from '@/lib/format';
import { useProjectCoaCodes } from '@/lib/queries';

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
};

type ProjectRow = {
  id: string;
  project_code: string;
  name: string;
  client: string;
  status: string;
  start_date: string;
  end_date: string;
  baseline_locked_at: string | null;
};

/**
 * Sandra UAT (#9): click project name → metadata popup with "everything"
 * about the current project without navigating away.
 */
export function ProjectMetadataModal({ open, onClose, projectId }: Props) {
  const { data: project, isLoading } = useQuery({
    queryKey: ['project-metadata', projectId] as const,
    enabled: open && !!projectId,
    queryFn: async (): Promise<ProjectRow | null> => {
      const { data, error } = await supabase
        .from('projects')
        .select(
          'id, project_code, name, client, status, start_date, end_date, baseline_locked_at',
        )
        .eq('id', projectId!)
        .maybeSingle();
      if (error) throw error;
      return data as ProjectRow | null;
    },
  });

  const { data: disciplineCount } = useQuery({
    queryKey: ['project-discipline-count', projectId] as const,
    enabled: open && !!projectId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('project_disciplines')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId!)
        .eq('is_active', true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const coaInScope = useProjectCoaCodes(projectId);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? `${project.project_code} — ${project.name}` : 'Project details'}
      caption="Read-only summary of the selected project."
      width={640}
    >
      {isLoading || !project ? (
        <div className="is-skeleton" style={{ height: 200, width: '100%' }} />
      ) : (
        <div className="grid gap-4 mt-2">
          <div className="flex items-center gap-2">
            <StatusChip kind={project.status} />
            {project.baseline_locked_at && (
              <span className="text-xs text-[color:var(--color-text-muted)]">
                Baseline locked {new Date(project.baseline_locked_at).toLocaleDateString()}
              </span>
            )}
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="is-stat-label">Project code</dt>
              <dd className="font-mono font-semibold mt-0.5">{project.project_code}</dd>
            </div>
            <div>
              <dt className="is-stat-label">Client</dt>
              <dd className="mt-0.5">{project.client || '—'}</dd>
            </div>
            <div>
              <dt className="is-stat-label">Start date</dt>
              <dd className="mt-0.5">{project.start_date || '—'}</dd>
            </div>
            <div>
              <dt className="is-stat-label">End date</dt>
              <dd className="mt-0.5">{project.end_date || '—'}</dd>
            </div>
            <div>
              <dt className="is-stat-label">Active disciplines</dt>
              <dd className="font-mono mt-0.5">{fmt.int(disciplineCount ?? 0)}</dd>
            </div>
            <div>
              <dt className="is-stat-label">COA codes in scope</dt>
              <dd className="font-mono mt-0.5">{fmt.int(coaInScope.data?.size ?? 0)}</dd>
            </div>
          </dl>

          <p className="text-xs text-[color:var(--color-text-muted)] border-t border-[color:var(--color-line)] pt-3">
            Edit metadata, pick in-scope codes, and upload baseline audits on{' '}
            <span className="font-semibold">Project Setup</span>.
          </p>
        </div>
      )}
    </Modal>
  );
}
