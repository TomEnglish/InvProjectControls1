import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { CoaCodeRow } from '@/lib/queries';
import { Modal } from '@/components/ui/Modal';
import { Field, inputClass, selectClass } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';

const UOMS = ['LF', 'CY', 'EA', 'TONS', 'SF', 'HR', 'LS'] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  /** When set, the modal is in edit mode for this row. */
  initial?: CoaCodeRow | null;
};

export function CoaCodeModal({ open, onClose, initial }: Props) {
  const qc = useQueryClient();
  const editing = !!initial;

  const [prime, setPrime] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [parent, setParent] = useState('');
  const [level, setLevel] = useState(2);
  const [uom, setUom] = useState<(typeof UOMS)[number]>('EA');
  const [baseRate, setBaseRate] = useState('0.0000');
  const [pfAdj, setPfAdj] = useState('1.0000');

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setPrime(initial.prime);
      setCode(initial.code);
      setDescription(initial.description);
      setParent(initial.parent ?? '');
      setLevel(initial.level);
      setUom(initial.uom as (typeof UOMS)[number]);
      setBaseRate(initial.base_rate.toFixed(4));
      setPfAdj(initial.pf_adj.toFixed(4));
    } else {
      setPrime('');
      setCode('');
      setDescription('');
      setParent('');
      setLevel(2);
      setUom('EA');
      setBaseRate('0.0000');
      setPfAdj('1.0000');
    }
  }, [open, initial]);

  const baseN = Number(baseRate) || 0;
  const pfN = Number(pfAdj) || 0;
  const computedRate = baseN * pfN;

  const upsert = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('coa_code_upsert', {
        p_payload: {
          prime,
          code,
          description,
          parent: parent || null,
          level,
          uom,
          base_rate: baseN,
          pf_adj: pfN,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coa-codes'] });
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    upsert.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit cost code — ${initial?.code}` : 'New cost code'}
      caption="Base rate × productivity adjustment determines the loaded unit rate. Codes are unique per tenant."
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prime" required>
            <input
              className={inputClass}
              value={prime}
              onChange={(e) => setPrime(e.target.value)}
              placeholder="100"
              required
            />
          </Field>
          <Field label="Code" required>
            <input
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="101"
              required
              disabled={editing}
              aria-describedby="code-immutable"
            />
          </Field>
        </div>

        <Field label="Description" required>
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Civil — Concrete foundations"
            required
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Parent">
            <input
              className={inputClass}
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              placeholder="100"
            />
          </Field>
          <Field label="Level" required>
            <select
              className={selectClass}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="UOM" required>
            <select
              className={selectClass}
              value={uom}
              onChange={(e) => setUom(e.target.value as (typeof UOMS)[number])}
            >
              {UOMS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Base rate" required hint="Hours per UOM, before adjustment.">
            <input
              type="number"
              step="0.0001"
              min={0}
              className={`${inputClass} font-mono`}
              value={baseRate}
              onChange={(e) => setBaseRate(e.target.value)}
              required
            />
          </Field>
          <Field label="PF adjust" required hint="Productivity factor.">
            <input
              type="number"
              step="0.0001"
              min={0}
              className={`${inputClass} font-mono`}
              value={pfAdj}
              onChange={(e) => setPfAdj(e.target.value)}
              required
            />
          </Field>
          <Field label="PF rate" hint="Auto-computed: base × PF.">
            <input
              className={`${inputClass} font-mono`}
              value={computedRate.toFixed(4)}
              readOnly
              disabled
            />
          </Field>
        </div>

        {upsert.error && (
          <div className="is-toast is-toast-danger">{(upsert.error as Error).message}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={upsert.isPending}>
            {upsert.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create code'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
