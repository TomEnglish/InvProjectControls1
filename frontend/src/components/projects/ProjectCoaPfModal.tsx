import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  coaCodeId: string;
  code: string;
  description: string;
  baseRate: number;
  /** Tenant-wide pf_adj (the default if no override is set). */
  defaultPfAdj: number;
  /** Current per-project override; null means "use the default". */
  currentOverride: number | null;
};

/**
 * A2 — per-project U/R adjustment editor. Admin-only via the RPC's
 * own assert_role('admin') gate; the picker card hides the entry
 * point for non-admins to keep the surface visually consistent.
 *
 * On save, calls project_coa_pf_set which audit-logs the before/after
 * pair. "Clear" sends null to restore the tenant default.
 */
export function ProjectCoaPfModal({
  open,
  onClose,
  projectId,
  coaCodeId,
  code,
  description,
  baseRate,
  defaultPfAdj,
  currentOverride,
}: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string>('');

  // Sync the input when the modal opens or the row's override shifts
  // (e.g. someone else edited it while the modal was idle). Empty
  // string represents the cleared / null state.
  useEffect(() => {
    if (!open) return;
    setDraft(currentOverride != null ? currentOverride.toFixed(4) : '');
  }, [open, currentOverride]);

  const save = useMutation({
    mutationFn: async (newOverride: number | null) => {
      const { error } = await supabase.rpc('project_coa_pf_set', {
        p_project_id: projectId,
        p_coa_code_id: coaCodeId,
        p_pf_adj: newOverride,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-coa-pf-overrides', projectId] });
      onClose();
    },
  });

  const parsed = draft.trim() === '' ? null : Number(draft);
  const parseError =
    draft.trim() !== '' && (!Number.isFinite(parsed!) || parsed! < 0);
  const effectivePfAdj = parsed ?? defaultPfAdj;
  const effectivePfRate = baseRate * effectivePfAdj;
  const unchanged =
    (parsed == null && currentOverride == null) ||
    (parsed != null && currentOverride != null && Math.abs(parsed - currentOverride) < 1e-6);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (parseError) return;
    save.mutate(parsed);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adjust PF for ${code}`}
      caption={description}
      width={520}
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid grid-cols-3 gap-3 p-4 rounded-md bg-[color:var(--color-raised)] border border-[color:var(--color-line)] text-xs">
          <div>
            <div className="is-stat-label">Base rate</div>
            <div className="font-mono mt-0.5">{baseRate.toFixed(4)}</div>
          </div>
          <div>
            <div className="is-stat-label">Tenant default PF</div>
            <div className="font-mono mt-0.5">{defaultPfAdj.toFixed(4)}</div>
          </div>
          <div>
            <div className="is-stat-label">Current override</div>
            <div className="font-mono mt-0.5">
              {currentOverride != null ? currentOverride.toFixed(4) : '— none —'}
            </div>
          </div>
        </div>

        <Field
          label="New project PF (leave blank to use tenant default)"
          hint="Productivity-factor adjustment specific to this project. Audit log records the change."
        >
          <input
            className={inputClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 1.05"
            autoComplete="off"
          />
        </Field>

        {parseError && (
          <div className="is-toast is-toast-danger">
            Enter a non-negative number or leave blank.
          </div>
        )}

        <div className="text-xs p-3 rounded-md border border-[color:var(--color-line)]">
          <div className="text-[color:var(--color-text-muted)]">Effective PF rate (preview)</div>
          <div className="font-mono text-base mt-1">
            {baseRate.toFixed(4)} × {effectivePfAdj.toFixed(4)} ={' '}
            <span className="font-bold">{effectivePfRate.toFixed(4)}</span>
          </div>
        </div>

        {save.error && (
          <div className="is-toast is-toast-danger">{(save.error as Error).message}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {currentOverride != null && (
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              Clear override
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={parseError || unchanged || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save PF'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
