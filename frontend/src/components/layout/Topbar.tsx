import { useQuery } from '@tanstack/react-query';
import { useMatches } from 'react-router-dom';
import { Moon, Sun, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useProjectStore } from '@/stores/project';

type Project = {
  id: string;
  project_code: string;
  name: string;
  status: string;
};

export function Topbar() {
  const matches = useMatches();
  const crumb = matches[matches.length - 1]?.handle as { title?: string } | undefined;
  const title = crumb?.title ?? 'Invenio ProjectControls';

  const { user, signOut } = useAuth();
  const { currentProjectId, setCurrentProjectId } = useProjectStore();
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light',
  );

  const { data: projects } = useQuery({
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

  useEffect(() => {
    if (projects && projects.length > 0 && !currentProjectId) {
      setCurrentProjectId(projects[0]?.id ?? null);
    }
  }, [projects, currentProjectId, setCurrentProjectId]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between px-6 bg-[color:var(--color-surface)] border-b border-[color:var(--color-line)]"
      style={{ height: 'var(--topbar-h)' }}
    >
      <div>
        <div className="text-xs text-[color:var(--color-text-muted)]">
          Home &rsaquo; <span className="text-[color:var(--color-accent)]">{title}</span>
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="flex items-center gap-2">
        <select
          aria-label="Current project"
          className="px-2.5 py-1.5 border border-[color:var(--color-line)] rounded-md text-sm bg-[color:var(--color-surface)]"
          value={currentProjectId ?? ''}
          onChange={(e) => setCurrentProjectId(e.target.value || null)}
        >
          <option value="">— Select project —</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_code} — {p.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="p-2 rounded-md border border-[color:var(--color-line)] hover:bg-[color:var(--color-canvas)]"
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
          style={{ background: 'var(--color-primary)' }}
          title={user?.email ?? ''}
        >
          {(user?.email ?? 'U').slice(0, 2).toUpperCase()}
        </div>

        <button
          type="button"
          aria-label="Sign out"
          onClick={signOut}
          className="p-2 rounded-md border border-[color:var(--color-line)] hover:bg-[color:var(--color-canvas)]"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
