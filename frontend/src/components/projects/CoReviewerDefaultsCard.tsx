import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUser, hasRole } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { selectClass } from '@/components/ui/FormField';

type ReviewerRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
};

type DisciplineRow = {
  id: string;
  discipline_code: string;
  display_name: string;
};

type DefaultRow = {
  discipline_id: string;
  pc_reviewer_id: string | null;
  pm_id: string | null;
};

type Props = { projectId: string };

function labelFor(id: string | null, users: ReviewerRow[]): string {
  if (!id) return '— any —';
  const u = users.find((r) => r.id === id);
  if (!u) return '—';
  return u.display_name ?? u.email;
}

/**
 * Per-project, per-discipline default CO routing. Pre-fills the New CO
 * modal and drives co-notify when no per-CO override is set at submit.
 *
 * Writes go through project_co_reviewer_set (admin/pm/super_admin + project
 * member check enforced PG-side).
 */
export function CoReviewerDefaultsCard({ projectId }: Props) {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canEdit = hasRole(me?.role, 'pm');

  const disciplines = useQuery({
    queryKey: ['project-co-reviewer-disciplines', projectId] as const,
    queryFn: async (): Promise<DisciplineRow[]> => {
      const { data, error } = await supabase
        .from('project_disciplines')
        .select('id, discipline_code, display_name')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('discipline_code');
      if (error) throw error;
      return (data ?? []) as DisciplineRow[];
    },
  });

  const defaults = useQuery({
    queryKey: ['project-co-reviewers', projectId] as const,
    queryFn: async (): Promise<DefaultRow[]> => {
      const { data, error } = await supabase
        .from('project_co_reviewers')
        .select('discipline_id, pc_reviewer_id, pm_id')
        .eq('project_id', projectId);
      if (error) throw error;
      return (data ?? []) as DefaultRow[];
    },
  });

  const reviewers = useQuery({
    queryKey: ['co-eligible-reviewers'] as const,
    queryFn: async (): Promise<ReviewerRow[]> => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, email, display_name, role')
        .in('role', ['pc_reviewer', 'pm', 'admin', 'super_admin'])
        .order('email');
      if (error) throw error;
      return (data ?? []) as ReviewerRow[];
    },
  });

  const pcReviewers = useMemo(
    () =>
      (reviewers.data ?? []).filter((r) =>
        ['pc_reviewer', 'admin', 'super_admin'].includes(r.role),
      ),
    [reviewers.data],
  );
  const pms = useMemo(
    () =>
      (reviewers.data ?? []).filter((r) =>
        ['pm', 'admin', 'super_admin'].includes(r.role),
      ),
    [reviewers.data],
  );

  const [draft, setDraft] = useState<Record<string, { pc: string; pm: string }>>({});

  useEffect(() => {
    if (!disciplines.data) return;
    const byDisc = new Map(
      (defaults.data ?? []).map((r) => [r.discipline_id, r]),
    );
    const next: Record<string, { pc: string; pm: string }> = {};
    for (const d of disciplines.data) {
      const row = byDisc.get(d.id);
      next[d.id] = {
        pc: row?.pc_reviewer_id ?? '',
        pm: row?.pm_id ?? '',
      };
    }
    setDraft(next);
  }, [disciplines.data, defaults.data]);

  const dirty = useMemo(() => {
    if (!disciplines.data) return false;
    const byDisc = new Map(
      (defaults.data ?? []).map((r) => [r.discipline_id, r]),
    );
    return disciplines.data.some((d) => {
      const saved = byDisc.get(d.id);
      const cur = draft[d.id];
      if (!cur) return false;
      const savedPc = saved?.pc_reviewer_id ?? '';
      const savedPm = saved?.pm_id ?? '';
      return cur.pc !== savedPc || cur.pm !== savedPm;
    });
  }, [disciplines.data, defaults.data, draft]);

  const save = useMutation({
    mutationFn: async () => {
      if (!disciplines.data) return;
      for (const d of disciplines.data) {
        const row = draft[d.id] ?? { pc: '', pm: '' };
        const { error } = await supabase.rpc('project_co_reviewer_set', {
          p_project_id: projectId,
          p_discipline_id: d.id,
          p_pc_reviewer_id: row.pc || null,
          p_pm_id: row.pm || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-co-reviewers', projectId] });
    },
  });

  const loading = disciplines.isLoading || defaults.isLoading || reviewers.isLoading;
  const users = reviewers.data ?? [];

  if (loading) {
    return (
      <Card>
        <div className="is-skeleton" style={{ height: 160 }} />
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <div className="px-6 pt-5 pb-3">
        <CardHeader
          eyebrow="Change management"
          title="Default CO reviewers"
          caption="Pre-fills approval routing on new change orders and CO notification emails. Leave blank to notify all eligible reviewers in the tenant."
        />
      </div>
      <div className="overflow-x-auto">
        <table className="is-table">
          <thead>
            <tr>
              <th>Discipline</th>
              <th>Default PC reviewer</th>
              <th>Default PM</th>
            </tr>
          </thead>
          <tbody>
            {(disciplines.data ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-[color:var(--color-text-muted)] py-6">
                  Add active disciplines above to configure default reviewers.
                </td>
              </tr>
            )}
            {(disciplines.data ?? []).map((d) => {
              const row = draft[d.id] ?? { pc: '', pm: '' };
              if (!canEdit) {
                return (
                  <tr key={d.id}>
                    <td>
                      <div className="font-semibold">{d.display_name}</div>
                      <div className="text-xs font-mono text-[color:var(--color-text-muted)]">
                        {d.discipline_code}
                      </div>
                    </td>
                    <td className="text-sm">{labelFor(row.pc || null, users)}</td>
                    <td className="text-sm">{labelFor(row.pm || null, users)}</td>
                  </tr>
                );
              }
              return (
                <tr key={d.id}>
                  <td>
                    <div className="font-semibold">{d.display_name}</div>
                    <div className="text-xs font-mono text-[color:var(--color-text-muted)]">
                      {d.discipline_code}
                    </div>
                  </td>
                  <td>
                    <select
                      className={selectClass}
                      value={row.pc}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [d.id]: { ...row, pc: e.target.value },
                        }))
                      }
                    >
                      <option value="">— any PC reviewer —</option>
                      {pcReviewers.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.display_name ?? r.email}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className={selectClass}
                      value={row.pm}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [d.id]: { ...row, pm: e.target.value },
                        }))
                      }
                    >
                      <option value="">— any PM —</option>
                      {pms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.display_name ?? r.email}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (disciplines.data?.length ?? 0) > 0 && (
        <div className="px-6 pb-5 pt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save defaults'}
          </Button>
          {save.isSuccess && !dirty && (
            <span className="text-xs text-[color:var(--color-variance-favourable)]">Saved.</span>
          )}
          {save.isError && (
            <span className="text-xs text-[color:var(--color-variance-unfavourable)]">
              {(save.error as Error).message}
            </span>
          )}
        </div>
      )}
      {!canEdit && (disciplines.data?.length ?? 0) > 0 && (
        <p className="px-6 pb-5 text-xs text-[color:var(--color-text-muted)]">
          Controllers and PMs on this project can edit defaults.
        </p>
      )}
    </Card>
  );
}
