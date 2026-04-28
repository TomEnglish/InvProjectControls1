import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';

export type CoDecisionKind = 'forward' | 'reject';

type Props = {
  open: boolean;
  onClose: () => void;
  coNumber: string;
  /** Action verb in the title ("Forward" vs "Approve" vs "Reject"). */
  verb: string;
  /** Whether this is a reject flow — notes required in that case. */
  decision: CoDecisionKind;
  onConfirm: (notes: string | null) => void;
  busy?: boolean;
};

export function CoDecisionModal({ open, onClose, coNumber, verb, decision, onConfirm, busy }: Props) {
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) setNotes('');
  }, [open]);

  const rejectMode = decision === 'reject';
  const confirmDisabled = busy || (rejectMode && notes.trim().length === 0);

  return (
    <Modal open={open} onClose={onClose} title={`${verb} ${coNumber}`} width={520}>
      <Field
        label={rejectMode ? 'Rejection reason (required)' : 'Notes (optional)'}
        hint={rejectMode ? 'Explain why this CO is being rejected — visible in the audit log.' : undefined}
      >
        <textarea
          rows={4}
          className={inputClass}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={rejectMode ? 'e.g. Out of scope — re-submit under CO-N+1 with revised drawing ref.' : ''}
        />
      </Field>

      <div className="mt-4 flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={rejectMode ? 'danger' : 'primary'}
          disabled={confirmDisabled}
          onClick={() => onConfirm(notes.trim() || null)}
        >
          {busy ? 'Working…' : verb}
        </Button>
      </div>
    </Modal>
  );
}
