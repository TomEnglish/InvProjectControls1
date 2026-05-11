import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { WorkTypeRow } from '@/lib/queries';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

type Props = {
  open: boolean;
  onClose: () => void;
  workType: WorkTypeRow | null;
};

type DraftMilestone = { seq: number; label: string; weight: string };

/**
 * Edits a work_type's milestone set (1-8 entries, weights sum to 1.0).
 * Calls work_type_milestones_set, which validates the sum and replaces
 * the milestone rows atomically.
 *
 * Compared to the old RocTemplateModal: milestones are variable-count
 * (Sandra's CIV-COMP has 1, CIV-FDN has 7, PIPE-STD has 8) rather than
 * fixed-8, so the editor exposes add/remove controls instead of an 8-row
 * grid.
 */
export function WorkTypeModal({ open, onClose, workType }: Props) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<DraftMilestone[]>([]);

  useEffect(() => {
    if (!open || !workType) return;
    const ms = [...workType.milestones]
      .sort((a, b) => a.seq - b.seq)
      .map((m) => ({
        seq: m.seq,
        label: m.label,
        weight: (m.weight * 100).toFixed(2),
      }));
    if (ms.length === 0) ms.push({ seq: 1, label: '', weight: '100.00' });
    setDrafts(ms);
  }, [open, workType]);

  const totalPct = useMemo(
    () => drafts.reduce((s, d) => s + (Number(d.weight) || 0), 0),
    [drafts],
  );
  const totalOk = Math.abs(totalPct - 100) < 0.01;
  const allLabelled = drafts.every((d) => d.label.trim());
  const countOk = drafts.length >= 1 && drafts.length <= 8;

  const setDraft = (idx: number, patch: Partial<DraftMilestone>) => {
    setDrafts((d) => d.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  };

  const addMilestone = () => {
    if (drafts.length >= 8) return;
    setDrafts((d) => [...d, { seq: d.length + 1, label: '', weight: '0.00' }]);
  };
  const removeMilestone = (idx: number) => {
    setDrafts((d) =>
      d
        .filter((_, i) => i !== idx)
        // Re-sequence so seq is always 1..N contiguous after a remove.
        .map((m, i) => ({ ...m, seq: i + 1 })),
    );
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!workType) return;
      const milestones = drafts.map((d, i) => ({
        seq: i + 1,
        label: d.label.trim(),
        weight: (Number(d.weight) || 0) / 100,
      }));
      const { error } = await supabase.rpc('work_type_milestones_set', {
        p_work_type_id: workType.id,
        p_milestones: milestones,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-types'] });
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'work-type-milestones-for-record',
      });
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!totalOk || !allLabelled || !countOk) return;
    save.mutate();
  };

  if (!workType) return null;

  const totalChip = totalOk
    ? 'is-chip-success'
    : totalPct > 100
      ? 'is-chip-danger'
      : 'is-chip-warn';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit work type — ${workType.work_type_code}`}
      caption={`${workType.description} (${workType.discipline_code}). 1–8 milestones, weights must total 100%.`}
      width={680}
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-2">
          {drafts.map((d, i) => (
            <div
              key={i}
              className="grid gap-2"
              style={{ gridTemplateColumns: '40px 1fr 120px 32px' }}
            >
              <div className="flex items-center justify-center text-xs font-bold text-[color:var(--color-text-muted)] font-mono">
                M{i + 1}
              </div>
              <input
                className="is-form-input"
                placeholder={`Milestone ${i + 1} label`}
                value={d.label}
                onChange={(e) => setDraft(i, { label: e.target.value })}
                required
              />
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  className="is-form-input font-mono pr-8"
                  value={d.weight}
                  onChange={(e) => setDraft(i, { weight: e.target.value })}
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[color:var(--color-text-muted)]">
                  %
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeMilestone(i)}
                disabled={drafts.length <= 1}
                aria-label={`Remove milestone ${i + 1}`}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[color:var(--color-text-muted)] hover:text-[color:var(--color-variance-unfavourable)] hover:bg-[color:var(--color-raised)] disabled:opacity-30 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addMilestone}
            disabled={drafts.length >= 8}
          >
            + Add milestone
          </Button>
          <span className="text-xs text-[color:var(--color-text-muted)]">
            {drafts.length} of 8
          </span>
        </div>

        <div className="flex items-center justify-between p-3 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-raised)]">
          <span className="text-sm font-semibold">Total weight</span>
          <span className={`is-chip ${totalChip} font-mono`}>{totalPct.toFixed(2)}%</span>
        </div>

        {!totalOk && (
          <div className="is-toast is-toast-warn">
            Weights must sum to 100% before saving.
          </div>
        )}

        {save.error && (
          <div className="is-toast is-toast-danger">{(save.error as Error).message}</div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!totalOk || !allLabelled || !countOk || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save work type'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
