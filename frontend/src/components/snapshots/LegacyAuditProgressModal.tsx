import { AlertTriangle, Eraser } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

type Props = {
  open: boolean;
  pending: boolean;
  error: Error | null;
  recordCount: number;
  onClose: () => void;
  onConfirm: () => void;
};

export function LegacyAuditProgressModal({
  open,
  pending,
  error,
  recordCount,
  onClose,
  onConfirm,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clear legacy audit progress?"
      caption="Remove earned progress left by audit uploads after their snapshot history was deleted."
      width={540}
    >
      <div className="mt-5 space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-raised)] p-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[color:var(--color-warning)]" />
          <div className="text-sm leading-relaxed">
            <p className="font-semibold">{recordCount} baseline {recordCount === 1 ? 'record' : 'records'} have legacy audit-earned values.</p>
            <p className="mt-1 text-[color:var(--color-text-muted)]">
              This resets earned percent, imported earned quantity/hours, and milestones to baseline values. Actual-hours records are not changed.
            </p>
          </div>
        </div>

        {error && <div className="is-toast is-toast-danger" role="alert">{error.message}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            <Eraser size={14} />
            {pending ? 'Clearing…' : 'Clear audit progress'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
