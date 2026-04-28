import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { RocTemplateRow } from '@/lib/queries';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

type Props = {
  open: boolean;
  onClose: () => void;
  template: RocTemplateRow | null;
};

const seqs = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function RocTemplateModal({ open, onClose, template }: Props) {
  const qc = useQueryClient();
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [weights, setWeights] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!open || !template) return;
    const ls: Record<number, string> = {};
    const ws: Record<number, string> = {};
    for (const seq of seqs) {
      const m = template.milestones.find((x) => x.seq === seq);
      ls[seq] = m?.label ?? '';
      // Display weights as percentages (60.00%) rather than fractions (0.6) — easier on humans.
      ws[seq] = ((m?.weight ?? 0) * 100).toFixed(2);
    }
    setLabels(ls);
    setWeights(ws);
  }, [open, template]);

  const numericWeights = seqs.map((s) => Number(weights[s]) || 0);
  const total = numericWeights.reduce((a, b) => a + b, 0);
  const totalOk = Math.abs(total - 100) < 0.01;
  const allLabelled = seqs.every((s) => labels[s]?.trim());

  const save = useMutation({
    mutationFn: async () => {
      if (!template) return;
      const milestones = seqs.map((s) => ({
        seq: s,
        label: labels[s]?.trim() ?? '',
        weight: (Number(weights[s]) || 0) / 100,
      }));
      const { error } = await supabase.rpc('roc_template_set', {
        p_template_id: template.id,
        p_milestones: milestones,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roc-templates'] });
      qc.invalidateQueries({ queryKey: ['roc-milestones'] });
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!totalOk || !allLabelled) return;
    save.mutate();
  };

  if (!template) return null;

  const totalChip = totalOk
    ? 'is-chip-success'
    : total > 100
      ? 'is-chip-danger'
      : 'is-chip-warn';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ROC — ${template.discipline_code}`}
      caption={`${template.name} v${template.version}. Eight milestones, weights must total 100%.`}
      width={680}
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-2">
          {seqs.map((seq) => (
            <div
              key={seq}
              className="grid gap-2"
              style={{ gridTemplateColumns: '40px 1fr 120px' }}
            >
              <div className="flex items-center justify-center text-xs font-bold text-[color:var(--color-text-muted)] font-mono">
                M{seq}
              </div>
              <input
                className="is-form-input"
                placeholder={`Milestone ${seq} label`}
                value={labels[seq] ?? ''}
                onChange={(e) => setLabels({ ...labels, [seq]: e.target.value })}
                required
              />
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  className="is-form-input font-mono pr-8"
                  value={weights[seq] ?? ''}
                  onChange={(e) => setWeights({ ...weights, [seq]: e.target.value })}
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[color:var(--color-text-muted)]">
                  %
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between p-3 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-raised)]">
          <span className="text-sm font-semibold">Total weight</span>
          <span className={`is-chip ${totalChip} font-mono`}>{total.toFixed(2)}%</span>
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
            disabled={!totalOk || !allLabelled || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save template'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
