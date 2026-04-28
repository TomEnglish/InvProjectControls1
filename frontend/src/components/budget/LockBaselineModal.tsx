import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import { fmt } from '@/lib/format';

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectCode: string;
  projectName: string;
  totalBudgetHrs: number;
  recordCount: number;
};

export function LockBaselineModal({
  open,
  onClose,
  projectId,
  projectCode,
  projectName,
  totalBudgetHrs,
  recordCount,
}: Props) {
  const qc = useQueryClient();
  const [lockDate, setLockDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [confirm, setConfirm] = useState('');

  const lock = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('project_lock_baseline', {
        p_project_id: projectId,
        p_lock_date: new Date(lockDate).toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['budget-rollup', projectId] });
      qc.invalidateQueries({ queryKey: ['project-summary', projectId] });
      setConfirm('');
      onClose();
    },
  });

  const expected = `LOCK ${projectCode}`;
  const canSubmit = confirm.trim() === expected && !!lockDate;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    lock.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lock baseline"
      caption={`${projectCode} — ${projectName}`}
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="is-toast is-toast-warn">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">This action is permanent.</div>
            <div className="opacity-90 mt-0.5">
              Once locked, discipline budgets become read-only. All future scope changes must
              flow through Change Orders. The baseline snapshot is immutable.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4 rounded-md bg-[color:var(--color-raised)] border border-[color:var(--color-line)]">
          <div>
            <div className="is-stat-label">Records</div>
            <div className="text-lg font-semibold font-mono mt-0.5">{fmt.int(recordCount)}</div>
          </div>
          <div>
            <div className="is-stat-label">Total Budget Hrs</div>
            <div className="text-lg font-semibold font-mono mt-0.5">{fmt.int(totalBudgetHrs)}</div>
          </div>
        </div>

        <Field label="Lock date" required hint="The effective date stamped on the baseline snapshot.">
          <input
            type="date"
            className={inputClass}
            value={lockDate}
            onChange={(e) => setLockDate(e.target.value)}
            required
          />
        </Field>

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

        {lock.error && (
          <div className="is-toast is-toast-danger">{(lock.error as Error).message}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!canSubmit || lock.isPending}>
            {lock.isPending ? 'Locking…' : 'Lock baseline'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
