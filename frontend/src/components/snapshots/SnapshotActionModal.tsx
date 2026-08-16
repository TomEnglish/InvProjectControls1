import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { Snapshot } from '@/lib/queries';

export type SnapshotAction = 'delete' | 'revert';

type Props = {
  open: boolean;
  action: SnapshotAction | null;
  snapshot: Snapshot | null;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function SnapshotActionModal({
  open,
  action,
  snapshot,
  pending,
  error,
  onClose,
  onConfirm,
}: Props) {
  if (!snapshot || !action) return null;

  const isRevert = action === 'revert';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isRevert ? 'Revert audit upload?' : 'Delete snapshot history?'}
      caption={isRevert
        ? 'Restore earned progress and milestones to the state immediately before this audit.'
        : 'Remove this snapshot from comparison history without changing current progress.'}
      width={540}
    >
      <div className="mt-5 space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-raised)] p-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[color:var(--color-warning)]" />
          <div className="text-sm leading-relaxed">
            <p className="font-semibold">{snapshot.label}</p>
            <p className="text-[color:var(--color-text-muted)]">
              {snapshot.week_ending ?? snapshot.snapshot_date}
              {snapshot.source_filename ? ` · ${snapshot.source_filename}` : ''}
              {snapshot.record_count > 0 ? ` · ${snapshot.record_count} records` : ''}
            </p>
          </div>
        </div>

        <p className="text-sm text-[color:var(--color-text-muted)] leading-relaxed">
          {isRevert
            ? 'This action removes the snapshot, restores the prior earned-percent and milestone values, and leaves the separate actual-hours ledger untouched. Reverts must be done newest snapshot first.'
            : 'This action removes the snapshot and comparison items only. It does not undo progress already applied to baseline records. Use Revert audit when before-state is available.'}
        </p>

        {error && <div className="is-toast is-toast-danger" role="alert">{error.message}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {isRevert ? <RotateCcw size={14} /> : <Trash2 size={14} />}
            {pending ? 'Working…' : isRevert ? 'Revert audit' : 'Delete history'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
