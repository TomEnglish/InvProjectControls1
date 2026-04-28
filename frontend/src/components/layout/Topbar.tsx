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
  const title = crumb?.title ?? 'Dashboard';

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
        <select
          aria-label="Current project"
          className="is-form-select text-sm h-9 min-h-0 py-0"
          value={currentProjectId ?? ''}
          onChange={(e) => setCurrentProjectId(e.target.value || null)}
          style={{ minHeight: '36px' }}
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
    </header>
  );
}
