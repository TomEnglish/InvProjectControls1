import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, LockOpen } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, inputClass } from '@/components/ui/FormField';

/**
 * Counterpart to LockBaselineCard, rendered in the same Project Setup slot
 * once the project is active. Unlocking (RPC project_unlock_baseline) flips
 * status back to draft so scope can be fixed, cleared, or reloaded, then
 * re-locked. The locked snapshot in `baselines` is kept; re-locking stores
 * a new one. Render-gated by the caller on pm+ and active status — the RPC
 * re-asserts both.
 */
type Props = {
  projectId: string;
  projectCode: string;
  projectName: string;
  lockedAt: string | null;
};

export function UnlockBaselineCard({ projectId, projectCode, projectName, lockedAt }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');

  const unlock = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('project_unlock_baseline', {
        p_project_id: projectId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['budget-rollup', projectId] });
      qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['discipline-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['disciplines', projectId] });
      qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
      setConfirm('');
      setOpen(false);
    },
  });

  const expected = `UNLOCK ${projectCode}`;
  const canSubmit = confirm.trim() === expected;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    unlock.mutate();
  };

  return (
    <Card>
      <CardHeader
        eyebrow="Baseline"
        title="Baseline locked"
        caption={
          (lockedAt
            ? `Locked ${new Date(lockedAt).toLocaleDateString()}. `
            : '') +
          'Scope and budgets are read-only; changes go through Change Orders. If the baseline ' +
          'was locked too early or loaded wrong, unlock to return the project to Draft — fix or ' +
          'reload the records, verify on Data Check, then lock again.'
        }
        actions={
          <Button variant="outline" onClick={() => setOpen(true)}>
            <LockOpen size={14} /> Unlock Baseline…
          </Button>
        }
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Unlock baseline"
        caption={`${projectCode} — ${projectName}`}
      >
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="is-toast is-toast-warn">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">The project returns to Draft.</div>
              <div className="opacity-90 mt-0.5">
                Record scope and budgets become editable again and the baseline can be cleared or
                reloaded — bypassing Change Orders until it is re-locked. No progress data is
                deleted, and the locked snapshot is kept in history; locking again stores a new
                snapshot with a new effective date.
              </div>
            </div>
          </div>

          <Field
            label="Type the confirmation phrase to proceed"
            required
            hint={
              <>
                Type <span className="font-mono font-semibold">{expected}</span> exactly.
              </>
            }
          >
            <input
              className={inputClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={expected}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>

          {unlock.error && (
            <div className="is-toast is-toast-danger">{(unlock.error as Error).message}</div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!canSubmit || unlock.isPending}>
              {unlock.isPending ? 'Unlocking…' : 'Unlock baseline'}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
