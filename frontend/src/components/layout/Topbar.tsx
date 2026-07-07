import { useQuery } from '@tanstack/react-query';
import { useMatches } from 'react-router-dom';
import { Info, Moon, Sun, LogOut, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useCurrentUser, hasRole } from '@/lib/queries';
import { useProjectStore } from '@/stores/project';
import { ProjectMetadataModal } from '@/components/projects/ProjectMetadataModal';
import { NewProjectModal } from '@/components/projects/NewProjectModal';

type Project = {
  id: string;
  project_code: string;
  name: string;
  status: string;
};

export function Topbar() {
  const matches = useMatches();
  const crumb = matches[matches.length - 1]?.handle as { title?: string } | undefined;
  const title = crumb?.title ?? 'Dashboard';

  const { user, signOut } = useAuth();
  const { data: me } = useCurrentUser();
  const canCreate = hasRole(me?.role, 'pm');
  const { currentProjectId, setCurrentProjectId } = useProjectStore();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('pc-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light';
  });
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const { data: projects, error: projectsError } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, project_code, name, status')
        .order('project_code');
      if (error) throw error;
      return data as Project[];
    },
  });

  const currentProject = projects?.find((p) => p.id === currentProjectId);

  // Keep closed projects out of the main switcher list but still reachable
  // (grouped at the bottom) so a mistakenly-closed one can be selected and
  // reopened. Auto-select prefers an open project.
  const openProjects = projects?.filter((p) => p.status !== 'closed') ?? [];
  const closedProjects = projects?.filter((p) => p.status === 'closed') ?? [];

  useEffect(() => {
    if (projects && projects.length > 0 && !currentProjectId) {
      const first = openProjects[0]?.id ?? projects[0]?.id ?? null;
      setCurrentProjectId(first);
    }
    // openProjects is derived from projects; depend on projects to avoid a
    // new-array-every-render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, currentProjectId, setCurrentProjectId]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pc-theme', theme);
  }, [theme]);

  const initials = (user?.email ?? 'U').slice(0, 2).toUpperCase();

  return (
    <header
      className="is-topbar sticky top-0 z-40 flex items-center justify-between px-6 bg-[color:var(--color-surface)] border-b border-[color:var(--color-line)]"
      style={{ height: 'var(--topbar-h)' }}
    >
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-[color:var(--color-text-subtle)]">
          ProjectControls
        </div>
        <h2 className="text-base font-semibold leading-tight truncate">{title}</h2>
      </div>

      <div className="flex items-center gap-2">
        {projectsError && (
          <span
            className="text-xs text-[color:var(--color-variance-unfavourable)]"
            title={projectsError.message}
          >
            Couldn't load projects — check your connection.
          </span>
        )}
        <div className="flex items-center gap-1">
          <select
            aria-label="Current project"
            className="is-form-select text-sm h-9 min-h-0 py-0"
            value={currentProjectId ?? ''}
            onChange={(e) => setCurrentProjectId(e.target.value || null)}
            style={{ minHeight: '36px' }}
          >
            <option value="">— Select project —</option>
            {openProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_code} — {p.name}
              </option>
            ))}
            {closedProjects.length > 0 && (
              <optgroup label="Closed">
                {closedProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {canCreate && (
            <button
              type="button"
              aria-label="New project"
              title="New project"
              onClick={() => setNewProjectOpen(true)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)] transition-colors"
            >
              <Plus size={16} />
            </button>
          )}
          {currentProject && (
            <button
              type="button"
              aria-label={`View details for ${currentProject.project_code}`}
              title={`${currentProject.project_code} — ${currentProject.name}`}
              onClick={() => setMetadataOpen(true)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)] transition-colors"
            >
              <Info size={16} />
            </button>
          )}
        </div>

        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)] transition-colors"
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
          style={{ background: 'var(--color-primary)' }}
          title={user?.email ?? ''}
        >
          {initials}
        </div>

        <button
          type="button"
          aria-label="Sign out"
          onClick={signOut}
          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)] hover:border-[color:var(--color-danger)] transition-colors"
        >
          <LogOut size={16} />
        </button>
      </div>

      <ProjectMetadataModal
        open={metadataOpen}
        onClose={() => setMetadataOpen(false)}
        projectId={currentProjectId}
      />

      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </header>
  );
}
