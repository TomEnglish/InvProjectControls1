import { useState } from 'react';
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

  const { data: iwps } = useQuery({
    queryKey: ['iwps', projectId] as const,
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('iwps')
        .select('id, name')
        .eq('project_id', projectId)
        .order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const [form, setForm] = useState({
    discipline_id: '',
    iwp_id: '',
    dwg: '',
    rev: '1',
    description: '',
    uom: 'EA' as string,
    budget_qty: 0,
    budget_hrs: 0,
    foreman_name: '',
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { data: me, error: meErr } = await supabase
        .from('app_users')
        .select('tenant_id')
        .limit(1)
        .single();
      if (meErr) throw meErr;

      // Next record_no for the project. Concurrent inserts can collide; the
      // unique (project_id, record_no) constraint will then surface 23505 to
      // the user, who can retry. Acceptable for Phase 4.
      const { data: maxRow } = await supabase
        .from('progress_records')
        .select('record_no')
        .eq('project_id', projectId)
        .order('record_no', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextRecordNo = ((maxRow?.record_no as number | null) ?? 0) + 1;

      const { error } = await supabase.from('progress_records').insert({
        tenant_id: me.tenant_id,
        project_id: projectId,
        discipline_id: form.discipline_id || null,
        iwp_id: form.iwp_id || null,
        record_no: nextRecordNo,
        source_type: 'manual',
        dwg: form.dwg || null,
        rev: form.rev || null,
        description: form.description,
        uom: form.uom,
        budget_qty: form.budget_qty || null,
        budget_hrs: form.budget_hrs,
        percent_complete: 0,
        status: 'active',
        foreman_name: form.foreman_name || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
      qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
      setForm({
        discipline_id: '',
        iwp_id: '',
        dwg: '',
        rev: '1',
        description: '',
        uom: 'EA',
        budget_qty: 0,
        budget_hrs: 0,
        foreman_name: '',
      });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New Progress Record" width={760}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Discipline">
          <select
            className={inputClass}
            value={form.discipline_id}
            onChange={(e) => setForm({ ...form, discipline_id: e.target.value })}
          >
            <option value="">— select —</option>
            {disciplines?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name} ({d.discipline_code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="IWP" hint="Optional work-package grouping.">
          <select
            className={inputClass}
            value={form.iwp_id}
            onChange={(e) => setForm({ ...form, iwp_id: e.target.value })}
          >
            <option value="">—</option>
            {iwps?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
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
        <Field label="Foreman" hint="Free-text; aliasing links it to a user.">
          <input
            className={inputClass}
            value={form.foreman_name}
            onChange={(e) => setForm({ ...form, foreman_name: e.target.value })}
          />
        </Field>
        <Field label="Budget Quantity">
          <input
            type="number"
            step={0.1}
            min={0}
            className={inputClass}
            value={form.budget_qty}
            onChange={(e) => setForm({ ...form, budget_qty: Number(e.target.value) })}
          />
        </Field>
        <Field label="Budget Hours">
          <input
            type="number"
            step={0.1}
            min={0}
            className={inputClass}
            value={form.budget_hrs}
            onChange={(e) => setForm({ ...form, budget_hrs: Number(e.target.value) })}
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
          disabled={submit.isPending || !form.description || form.budget_hrs <= 0}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? 'Saving…' : 'Add Record'}
        </Button>
      </div>
    </Modal>
  );
}
