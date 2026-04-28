import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, inputClass } from '@/components/ui/FormField';
import { useCurrentUser, hasRole, type ProgressPeriod } from '@/lib/queries';
import { fmt } from '@/lib/format';

type Props = {
  projectId: string;
  periods: ProgressPeriod[];
};

export function PeriodCloseCard({ projectId, periods }: Props) {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canClose = hasRole(me?.role, 'pm');

  const open = periods.find((p) => !p.locked_at);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');

  const close = useMutation({
    mutationFn: async () => {
      if (!open) throw new Error('no open period');
      const { data, error } = await supabase.rpc('period_close', {
        p_project_id: projectId,
        p_period_id: open.id,
      });
      if (error) throw error;
      return data as { bcwp_hrs: number; acwp_hrs: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['progress-periods', projectId] });
      qc.invalidateQueries({ queryKey: ['project-summary', projectId] });
      setConfirmOpen(false);
      setConfirmPhrase('');
    },
  });

  if (!open) {
    return (
      <div className="is-surface p-6">
        <div className="is-eyebrow mb-1.5">Period close</div>
        <h3 className="text-base font-semibold">No open period</h3>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1.5">
          All progress periods on this project are closed. Seed a new period from the database
          if you need to continue tracking.
        </p>
      </div>
    );
  }

  const expected = `CLOSE P${open.period_number}`;
  const canSubmit = confirmPhrase.trim() === expected;

  return (
    <div className="is-surface p-6">
      <div className="is-eyebrow mb-1.5">Period close</div>
      <h3 className="text-base font-semibold">Period {open.period_number} is open</h3>
      <p className="text-sm text-[color:var(--color-text-muted)] mt-1.5 leading-relaxed">
        {new Date(open.start_date).toLocaleDateString()} — {new Date(open.end_date).toLocaleDateString()}.
        Closing snapshots BCWP / ACWP onto this period and seeds the next one.
      </p>

      <div className="mt-4">
        <Button
          variant="primary"
          disabled={!canClose}
          onClick={() => setConfirmOpen(true)}
          className="w-full justify-center"
        >
          <Lock size={14} /> Close period {open.period_number}
        </Button>
        {!canClose && (
          <p className="text-xs text-[color:var(--color-text-muted)] mt-2 text-center">
            PM role required.
          </p>
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setConfirmPhrase('');
        }}
        title={`Close period ${open.period_number}?`}
        caption="This freezes the period's BCWP and ACWP. Cannot be undone without a database edit."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) close.mutate();
          }}
          className="grid gap-4"
        >
          <div className="is-toast is-toast-warn">
            Once locked, no more actuals can be booked against this period via the import flow.
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
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder={expected}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>

          {close.isSuccess && close.data && (
            <div className="is-toast is-toast-success">
              Period closed. BCWP {fmt.int(close.data.bcwp_hrs)} hrs · ACWP{' '}
              {fmt.int(close.data.acwp_hrs)} hrs.
            </div>
          )}
          {close.error && (
            <div className="is-toast is-toast-danger">{(close.error as Error).message}</div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setConfirmPhrase('');
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!canSubmit || close.isPending}>
              {close.isPending ? 'Closing…' : `Close period ${open.period_number}`}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
