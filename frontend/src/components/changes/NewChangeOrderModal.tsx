import { useEffect, useState } from 'react';
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

const TYPES = [
  { v: 'scope_add', l: 'Scope Add' },
  { v: 'scope_reduction', l: 'Scope Reduction' },
  { v: 'ifc_update', l: 'IFC Update' },
  { v: 'design_change', l: 'Design Change' },
  { v: 'client_directive', l: 'Client Directive' },
];

const UOMS = ['LF', 'CY', 'EA', 'TONS', 'SF', 'HR', 'LS'];

type ReviewerRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
};

export function NewChangeOrderModal({ open, onClose, projectId }: Props) {
  const qc = useQueryClient();

  const { data: disciplines } = useQuery({
    queryKey: ['project-disciplines-simple', projectId] as const,
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_disciplines')
        .select('id, discipline_code, display_name')
        .eq('project_id', projectId)
        .order('discipline_code');
      if (error) throw error;
      return data;
    },
  });

  const { data: reviewers } = useQuery({
    queryKey: ['co-eligible-reviewers'] as const,
    enabled: open,
    queryFn: async (): Promise<ReviewerRow[]> => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, email, display_name, role')
        .in('role', ['pc_reviewer', 'pm', 'admin', 'super_admin'])
        .order('email');
      if (error) throw error;
      return (data ?? []) as ReviewerRow[];
    },
  });

  const todayISO = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    discipline_id: '',
    type: 'scope_add',
    drawing: '',
    date: todayISO,
    description: '',
    qty_change: 0,
    uom: 'EA',
    requested_by: '',
    assigned_pc_reviewer_id: '',
    assigned_pm_id: '',
  });

  useEffect(() => {
    if (!open || !form.discipline_id) return;
    (async () => {
      const { data } = await supabase
        .from('project_co_reviewers')
        .select('pc_reviewer_id, pm_id')
        .eq('project_id', projectId)
        .eq('discipline_id', form.discipline_id)
        .maybeSingle();
      if (data) {
        setForm((prev) => ({
          ...prev,
          assigned_pc_reviewer_id: data.pc_reviewer_id ?? prev.assigned_pc_reviewer_id,
          assigned_pm_id: data.pm_id ?? prev.assigned_pm_id,
        }));
      }
    })();
  }, [open, form.discipline_id, projectId]);

  const pcReviewers = (reviewers ?? []).filter((r) =>
    ['pc_reviewer', 'admin', 'super_admin'].includes(r.role),
  );
  const pms = (reviewers ?? []).filter((r) =>
    ['pm', 'admin', 'super_admin'].includes(r.role),
  );

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('co_submit', {
        p_payload: {
          ...form,
          project_id: projectId,
          assigned_pc_reviewer_id: form.assigned_pc_reviewer_id || null,
          assigned_pm_id: form.assigned_pm_id || null,
        },
      });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: (newCoId) => {
      qc.invalidateQueries({ queryKey: ['change-orders', projectId] });
      qc.invalidateQueries({ queryKey: ['budget-rollup', projectId] });
      if (newCoId) {
        void supabase.functions
          .invoke('co-notify', { body: { co_id: newCoId, event: 'submitted' } })
          .catch((err) => console.warn('co-notify failed', err));
      }
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New Change Order">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Drawing #" hint="Drawing affected by the change.">
          <input
            className={inputClass}
            placeholder="e.g. P-2050"
            value={form.drawing}
            onChange={(e) => setForm({ ...form, drawing: e.target.value })}
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            className={inputClass}
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>
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
        <Field label="Type">
          <select
            className={inputClass}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assigned PC reviewer" hint="Routes the approval email to this auditor.">
          <select
            className={inputClass}
            value={form.assigned_pc_reviewer_id}
            onChange={(e) => setForm({ ...form, assigned_pc_reviewer_id: e.target.value })}
          >
            <option value="">— any PC reviewer —</option>
            {pcReviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.display_name ?? r.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assigned PM" hint="Routes the forward email after PC review.">
          <select
            className={inputClass}
            value={form.assigned_pm_id}
            onChange={(e) => setForm({ ...form, assigned_pm_id: e.target.value })}
          >
            <option value="">— any PM —</option>
            {pms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.display_name ?? r.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" className="md:col-span-2">
          <textarea
            rows={2}
            className={inputClass}
            placeholder="Describe the change and reference drawings…"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Quantity Change" hint="Positive for scope add; negative for reduction.">
          <input
            type="number"
            step={0.1}
            className={inputClass}
            value={form.qty_change}
            onChange={(e) => setForm({ ...form, qty_change: Number(e.target.value) })}
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
        <Field label="Requested By" className="md:col-span-2">
          <input
            className={inputClass}
            placeholder="e.g. Field Engineering"
            value={form.requested_by}
            onChange={(e) => setForm({ ...form, requested_by: e.target.value })}
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
            !form.description ||
            !form.requested_by ||
            form.qty_change === 0
          }
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? 'Submitting…' : 'Submit for Review'}
        </Button>
      </div>
    </Modal>
  );
}
