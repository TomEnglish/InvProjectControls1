import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import {
  useCoaCodes,
  useProjectCoaCodes,
  useProjectCoaPfOverrides,
  useWorkTypes,
} from '@/lib/queries';

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
};

const UOMS = ['LF', 'CY', 'EA', 'TONS', 'SF', 'HR', 'LS', 'CF'];

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

  const { data: coaCodes } = useCoaCodes();
  const { data: inScopeIds } = useProjectCoaCodes(projectId);
  const { data: pfOverrides } = useProjectCoaPfOverrides(projectId);
  const { data: workTypes } = useWorkTypes();

  const DEFAULT_CODE_BY_DISCIPLINE: Record<string, string> = {
    CIVIL: '04130',
    PIPE: '08212',
    STEEL: '05210',
    ELEC: '09420',
    MECH: '07140',
    INST: '10110',
    SITE: '01530',
    FOUNDATIONS: '04130',
  };

  const inScopeCodes = useMemo(() => {
    if (!coaCodes || !inScopeIds) return [];
    return coaCodes
      .filter((c) => c.level === 2 && inScopeIds.has(c.id))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [coaCodes, inScopeIds]);

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
    code: '',
    work_type_id: '',
    description: '',
    uom: 'EA' as string,
    budget_qty: 0,
    budget_hrs: 0,
    foreman_name: '',
  });

  const selectedDiscipline = disciplines?.find((d) => d.id === form.discipline_id);
  const selectedCoa = inScopeCodes.find((c) => c.code === form.code);

  const effectivePfAdj = selectedCoa
    ? (pfOverrides?.get(selectedCoa.id) ?? selectedCoa.pf_adj)
    : null;
  const effectivePfRate =
    selectedCoa && effectivePfAdj != null
      ? selectedCoa.base_rate * effectivePfAdj
      : null;

  const workTypesForDiscipline = useMemo(() => {
    if (!selectedDiscipline || !workTypes) return [];
    return workTypes.filter((wt) => wt.discipline_code === selectedDiscipline.discipline_code);
  }, [selectedDiscipline, workTypes]);

  const pickCode = (code: string) => {
    const coa = inScopeCodes.find((c) => c.code === code);
    const pfAdj = coa ? (pfOverrides?.get(coa.id) ?? coa.pf_adj) : null;
    const pfRate = coa && pfAdj != null ? coa.base_rate * pfAdj : null;
    const nextBudgetHrs =
      pfRate != null && form.budget_qty > 0
        ? Math.round(form.budget_qty * pfRate * 10) / 10
        : form.budget_hrs;
    setForm({
      ...form,
      code,
      uom: coa?.uom ?? form.uom,
      budget_hrs: nextBudgetHrs,
    });
  };

  const setBudgetQty = (budget_qty: number) => {
    const nextBudgetHrs =
      effectivePfRate != null && budget_qty > 0
        ? Math.round(budget_qty * effectivePfRate * 10) / 10
        : form.budget_hrs;
    setForm({ ...form, budget_qty, budget_hrs: nextBudgetHrs });
  };

  const submit = useMutation({
    mutationFn: async () => {
      const { data: me, error: meErr } = await supabase
        .from('app_users')
        .select('tenant_id')
        .limit(1)
        .single();
      if (meErr) throw meErr;

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
        code: form.code || null,
        work_type_id: form.work_type_id || null,
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
        code: '',
        work_type_id: '',
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
            onChange={(e) => {
              const next = e.target.value;
              const disc = disciplines?.find((d) => d.id === next);
              const defaultCode = disc ? DEFAULT_CODE_BY_DISCIPLINE[disc.discipline_code] ?? '' : '';
              const defaultWorkType = disc && workTypes
                ? workTypes.find(
                    (wt) =>
                      wt.discipline_code === disc.discipline_code && wt.is_default,
                  )
                : null;
              const scopedDefault =
                defaultCode && inScopeCodes.some((c) => c.code === defaultCode)
                  ? defaultCode
                  : form.code;
              setForm({
                ...form,
                discipline_id: next,
                code: form.code || scopedDefault,
                work_type_id: form.work_type_id || defaultWorkType?.id || '',
              });
            }}
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

        <Field
          label="COA Code (in scope)"
          required
          hint="Pick one in-scope cost code. U/R is shown for the selected row."
          className="md:col-span-2"
        >
          {inScopeCodes.length === 0 ? (
            <div className="text-xs text-[color:var(--color-text-muted)] border border-[color:var(--color-line)] rounded-md px-3 py-4">
              No COA codes are in scope for this project yet. Pick codes on Project Setup first.
            </div>
          ) : (
            <div
              className="border border-[color:var(--color-line)] rounded-md overflow-y-auto"
              style={{ maxHeight: 180 }}
              role="radiogroup"
              aria-label="In-scope COA codes"
            >
              {inScopeCodes.map((c) => {
                const override = pfOverrides?.get(c.id) ?? null;
                const pfAdj = override ?? c.pf_adj;
                const pfRate = c.base_rate * pfAdj;
                const checked = form.code === c.code;
                return (
                  <label
                    key={c.id}
                    className={`flex items-start gap-3 px-3 py-2 cursor-pointer border-b border-[color:var(--color-line)] last:border-b-0 ${
                      checked ? 'bg-[color:var(--color-raised)]' : 'hover:bg-[color:var(--color-canvas)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="coa-code"
                      checked={checked}
                      onChange={() => pickCode(c.code)}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-mono font-semibold">{c.code}</span>
                      <span className="text-[color:var(--color-text-muted)]"> — {c.description}</span>
                      <span className="block text-xs text-[color:var(--color-text-subtle)] mt-0.5">
                        {c.uom} · U/R {pfRate.toFixed(4)}
                        {override != null ? ' (project override)' : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </Field>

        {selectedCoa && effectivePfRate != null && (
          <div className="md:col-span-2 grid grid-cols-3 gap-3 p-3 rounded-md bg-[color:var(--color-raised)] border border-[color:var(--color-line)] text-xs">
            <div>
              <div className="is-stat-label">Base rate</div>
              <div className="font-mono mt-0.5">{selectedCoa.base_rate.toFixed(4)}</div>
            </div>
            <div>
              <div className="is-stat-label">Effective PF adj</div>
              <div className="font-mono mt-0.5">{effectivePfAdj!.toFixed(4)}</div>
            </div>
            <div>
              <div className="is-stat-label">U/R (PF rate)</div>
              <div className="font-mono mt-0.5 font-bold">{effectivePfRate.toFixed(4)}</div>
            </div>
          </div>
        )}

        <Field
          label="Work Type"
          required
          hint="Drives the milestone template for earned-value math. Auto-fills from the discipline default."
          className="md:col-span-2"
        >
          <select
            className={inputClass}
            value={form.work_type_id}
            onChange={(e) => setForm({ ...form, work_type_id: e.target.value })}
            disabled={!form.discipline_id}
          >
            <option value="">
              {form.discipline_id ? '— select a work type —' : '— pick a discipline first —'}
            </option>
            {workTypesForDiscipline.map((wt) => (
              <option key={wt.id} value={wt.id}>
                {wt.work_type_code} — {wt.description}
                {wt.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
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
            onChange={(e) => setBudgetQty(Number(e.target.value))}
          />
        </Field>
        <Field
          label="Budget Hours"
          hint={
            effectivePfRate != null
              ? 'Auto-calculated from qty × U/R when quantity changes.'
              : undefined
          }
        >
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
          disabled={
            submit.isPending ||
            !form.description ||
            form.budget_hrs <= 0 ||
            !form.code ||
            !form.work_type_id ||
            inScopeCodes.length === 0
          }
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? 'Saving…' : 'Add Record'}
        </Button>
      </div>
    </Modal>
  );
}
