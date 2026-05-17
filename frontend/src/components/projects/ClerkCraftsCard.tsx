import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  useClerksWithCrafts,
  useAssignableProjects,
  type ClerkWithCrafts,
} from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { selectClass } from '@/components/ui/FormField';

// Mirrors the discipline_code enum in supabase/migrations/0001_init.sql
// + 20260511000000_add_foundations_discipline.sql. Keep this list in sync
// when the enum extends — there's no API to fetch enum values cheaply.
const CRAFTS = ['CIVIL', 'FOUNDATIONS', 'STEEL', 'PIPE', 'ELEC', 'MECH', 'INST', 'SITE'] as const;

/**
 * A20 Wave 4 — list every clerk in the tenant with their assigned
 * (project, craft) pairs. Click "Manage" on a clerk to assign or revoke
 * crafts on a specific project via the clerk_crafts_set SECURITY DEFINER
 * RPC.
 *
 * Caller role gating: the RPC requires admin / pm / super_admin and the
 * caller-must-be-project-member check is enforced PG-side. We surface
 * only projects the caller can act on via useAssignableProjects so the
 * UI doesn't dangle options that will RPC-fail.
 */
export function ClerkCraftsCard() {
  const { data: clerks, isLoading } = useClerksWithCrafts();
  const [selected, setSelected] = useState<ClerkWithCrafts | null>(null);

  if (isLoading) {
    return (
      <Card>
        <div className="is-skeleton" style={{ height: 200 }} />
      </Card>
    );
  }

  return (
    <>
      <Card padded={false}>
        <div className="px-6 pt-5 pb-3">
          <CardHeader
            eyebrow="Clerk craft permissions"
            title="Clerks"
            caption="Which crafts each clerk is permitted to submit weekly progress for, by project."
          />
        </div>
        <div className="overflow-x-auto">
          <table className="is-table">
            <thead>
              <tr>
                <th>Clerk</th>
                <th>Assignments</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(clerks ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center text-[color:var(--color-text-muted)] py-6">
                    No clerk-role users yet. Invite one via "Invite User" above with role=Clerk.
                  </td>
                </tr>
              )}
              {(clerks ?? []).map((c) => (
                <tr key={c.user_id}>
                  <td>
                    <div className="text-sm font-medium">
                      {c.display_name ?? c.email.split('@')[0]}
                    </div>
                    <div className="text-xs text-[color:var(--color-text-muted)] font-mono">
                      {c.email}
                    </div>
                  </td>
                  <td>
                    {c.assignments.length === 0 ? (
                      <span className="text-xs italic text-[color:var(--color-text-muted)]">
                        No crafts assigned — clerk can't submit until you set them.
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {c.assignments.map((a) => (
                          <span
                            key={a.project_id}
                            className="is-chip font-mono text-[10px]"
                            title={a.project_name ?? a.project_id}
                          >
                            {a.project_code ?? '—'}: {a.crafts.join(', ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setSelected(c)}>
                      <Pencil size={12} /> Manage
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ClerkCraftsModal clerk={selected} onClose={() => setSelected(null)} />
    </>
  );
}

type ModalProps = {
  clerk: ClerkWithCrafts | null;
  onClose: () => void;
};

function ClerkCraftsModal({ clerk, onClose }: ModalProps) {
  const qc = useQueryClient();
  const projects = useAssignableProjects();
  const [projectId, setProjectId] = useState('');
  const [crafts, setCrafts] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  // When the modal opens or the picked project changes, pre-fill the
  // craft set from the clerk's existing assignment for that project.
  useEffect(() => {
    if (!clerk) {
      setProjectId('');
      setCrafts(new Set());
      setError(null);
      return;
    }
    if (!projectId) {
      setCrafts(new Set());
      return;
    }
    const a = clerk.assignments.find((x) => x.project_id === projectId);
    setCrafts(new Set(a?.crafts ?? []));
  }, [clerk, projectId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!clerk || !projectId) throw new Error('pick a project');
      const { error: rpcErr } = await supabase.rpc('clerk_crafts_set', {
        p_project_id: projectId,
        p_user_id: clerk.user_id,
        p_crafts: Array.from(crafts).sort(),
      });
      if (rpcErr) throw rpcErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clerks-with-crafts'] });
      // Also invalidate the per-user craft cache so the clerk's own
      // /progress/upload dropdown refreshes.
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'project-clerk-crafts',
      });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  if (!clerk) return null;

  const toggleCraft = (c: string) => {
    setError(null);
    setCrafts((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  return (
    <Modal
      open={!!clerk}
      onClose={onClose}
      title={`Crafts for ${clerk.display_name ?? clerk.email}`}
      caption="Pick a project, then check the crafts this clerk can submit weekly progress for."
      width={520}
    >
      <div className="grid gap-4">
        <div>
          <label
            htmlFor="clerk-crafts-project"
            className="text-xs font-semibold text-[color:var(--color-text-muted)] block mb-1"
          >
            Project
          </label>
          <select
            id="clerk-crafts-project"
            className={selectClass}
            value={projectId}
            onChange={(e) => {
              setError(null);
              setProjectId(e.target.value);
            }}
          >
            <option value="">— pick project —</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_code} — {p.name}
              </option>
            ))}
          </select>
          {projects.data && projects.data.length === 0 && (
            <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
              You're not a member of any projects in this tenant. Ask a super-admin
              to add you to a project before assigning clerks.
            </p>
          )}
        </div>

        {projectId && (
          <fieldset className="border border-[color:var(--color-line)] rounded-md p-3">
            <legend className="text-xs font-semibold text-[color:var(--color-text-muted)] px-1">
              Crafts
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {CRAFTS.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={crafts.has(c)}
                    onChange={() => toggleCraft(c)}
                  />
                  <span className="font-mono">{c}</span>
                </label>
              ))}
            </div>
            {crafts.size === 0 && (
              <p className="text-xs text-[color:var(--color-warn)] mt-2">
                Saving with no crafts will remove this clerk from the project entirely.
              </p>
            )}
          </fieldset>
        )}

        {error && <div className="is-toast is-toast-danger">{error}</div>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!projectId || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save crafts'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
