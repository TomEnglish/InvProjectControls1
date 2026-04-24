import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
};

const UOMS = ['LF', 'CY', 'EA', 'TONS', 'SF', 'HR', 'LS'];

type CoaCode = { id: string; prime: string; code: string; description: string; uom: string; pf_rate: number };

/** Recommended prime per discipline — matches the seeded COA hierarchy. */
const DISCIPLINE_TO_PRIME: Record<string, string> = {
  CIVIL: '100',
  PIPE: '200',
  STEEL: '300',
  ELEC: '400',
  MECH: '500',
  INST: '600',
  SITE: '100',
};

export function NewRecordModal({ open, onClose, projectId }: Props) {
  const qc = useQueryClient();

  const { data: disciplines } = useQuery({
    queryKey: ['project-disciplines-full', projectId] as const,
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_disciplines')
        .select('id, discipline_code, display_name')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('discipline_code');
      if (error) throw error;
      return data as { id: string; discipline_code: string; display_name: string }[];
    },
  });

  const { data: coaCodes } = useQuery({
    queryKey: ['coa-codes'] as const,
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coa_codes')
        .select('id, prime, code, description, uom, pf_rate')
        .order('code');
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id,
        prime: c.prime,
        code: c.code,
        description: c.description,
        uom: c.uom,
        pf_rate: Number(c.pf_rate),
      })) as CoaCode[];
    },
  });

  const [form, setForm] = useState({
    discipline_id: '',
    coa_code_id: '',
    dwg: '',
    rev: '1',
    description: '',
    uom: 'EA' as string,
    fld_qty: 0,
    fld_whrs: 0,
    fld_whrs_override: false,
  });

  const selectedDiscipline = disciplines?.find((d) => d.id === form.discipline_id);
  const recommendedPrime = selectedDiscipline
    ? DISCIPLINE_TO_PRIME[selectedDiscipline.discipline_code] ?? null
    : null;

  const filteredCoa = useMemo(() => {
    if (!coaCodes) return [];
    if (!recommendedPrime) return coaCodes;
    return coaCodes.filter((c) => c.prime === recommendedPrime);
  }, [coaCodes, recommendedPrime]);

  const selectedCoa = coaCodes?.find((c) => c.id === form.coa_code_id);

  // Auto-fill UOM + computed whrs when COA or qty changes (unless user overrode).
  useEffect(() => {
    if (!selectedCoa) return;
    setForm((f) => ({
      ...f,
      uom: selectedCoa.uom,
      fld_whrs: f.fld_whrs_override ? f.fld_whrs : f.fld_qty * selectedCoa.pf_rate,
    }));
  }, [selectedCoa]);

  useEffect(() => {
    if (!selectedCoa) return;
    setForm((f) =>
      f.fld_whrs_override ? f : { ...f, fld_whrs: f.fld_qty * selectedCoa.pf_rate },
    );
  }, [form.fld_qty, selectedCoa]);

  const submit = useMutation({
    mutationFn: async () => {
      const { data: me, error: meErr } = await supabase
        .from('app_users')
        .select('tenant_id')
        .limit(1)
        .single();
      if (meErr) throw meErr;

      // Next rec_no — race-prone under concurrent inserts; acceptable for Phase 2.
      const { data: maxRow } = await supabase
        .from('audit_records')
        .select('rec_no')
        .eq('project_id', projectId)
        .order('rec_no', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextRecNo = (maxRow?.rec_no ?? 0) + 1;

      const { error } = await supabase.from('audit_records').insert({
        tenant_id: me.tenant_id,
        project_id: projectId,
        discipline_id: form.discipline_id,
        coa_code_id: form.coa_code_id,
        rec_no: nextRecNo,
        dwg: form.dwg,
        rev: form.rev,
        description: form.description,
        uom: form.uom,
        fld_qty: form.fld_qty,
        fld_whrs: form.fld_whrs,
        status: 'active',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['progress-records', projectId] });
      qc.invalidateQueries({ queryKey: ['project-summary', projectId] });
      setForm({
        discipline_id: '',
        coa_code_id: '',
        dwg: '',
        rev: '1',
        description: '',
        uom: 'EA',
        fld_qty: 0,
        fld_whrs: 0,
        fld_whrs_override: false,
      });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New Audit Record" width={760}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Discipline">
          <select
            className={inputClass}
            value={form.discipline_id}
            onChange={(e) => setForm({ ...form, discipline_id: e.target.value, coa_code_id: '' })}
          >
            <option value="">— select —</option>
            {disciplines?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name} ({d.discipline_code})
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="COA Code"
          hint={recommendedPrime ? `Filtered to prime ${recommendedPrime}.` : undefined}
        >
          <select
            className={inputClass}
            value={form.coa_code_id}
            onChange={(e) => setForm({ ...form, coa_code_id: e.target.value })}
            disabled={!form.discipline_id}
          >
            <option value="">— select —</option>
            {filteredCoa.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.description}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Drawing #">
          <input
            className={inputClass}
            placeholder="e.g. P-2050"
            value={form.dwg}
            onChange={(e) => setForm({ ...form, dwg: e.target.value })}
          />
        </Field>
        <Field label="Revision">
          <input
            className={inputClass}
            value={form.rev}
            onChange={(e) => setForm({ ...form, rev: e.target.value })}
          />
        </Field>
        <Field label="Description" className="md:col-span-2">
          <input
            className={inputClass}
            placeholder="Line item description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="UOM">
          <select
            className={inputClass}
            value={form.uom}
            onChange={(e) => setForm({ ...form, uom: e.target.value })}
          >
            {UOMS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Field Quantity">
          <input
            type="number"
            step={0.1}
            min={0}
            className={inputClass}
            value={form.fld_qty}
            onChange={(e) => setForm({ ...form, fld_qty: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="Field Work Hours"
          hint={
            selectedCoa && !form.fld_whrs_override
              ? `Auto-calc from PF rate ${selectedCoa.pf_rate.toFixed(2)} — edit to override.`
              : 'Manual override.'
          }
          className="md:col-span-2"
        >
          <input
            type="number"
            step={0.1}
            min={0}
            className={inputClass}
            value={form.fld_whrs}
            onChange={(e) =>
              setForm({ ...form, fld_whrs: Number(e.target.value), fld_whrs_override: true })
            }
          />
        </Field>
      </div>

      {submit.isError && (
        <div className="mt-3 text-xs text-[color:var(--color-status-pending-fg)] bg-[color:var(--color-status-pending-bg)] rounded-md px-3 py-2">
          {(submit.error as Error).message}
        </div>
      )}

      <div className="mt-5 flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={
            submit.isPending ||
            !form.discipline_id ||
            !form.coa_code_id ||
            !form.dwg ||
            !form.description ||
            form.fld_qty <= 0
          }
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? 'Saving…' : 'Add Record'}
        </Button>
      </div>
    </Modal>
  );
}
