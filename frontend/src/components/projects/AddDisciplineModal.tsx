import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';

const DISCIPLINE_CODES = [
  { v: 'CIVIL', l: 'Civil' },
  { v: 'PIPE', l: 'Pipe' },
  { v: 'STEEL', l: 'Steel' },
  { v: 'ELEC', l: 'Electrical' },
  { v: 'MECH', l: 'Mechanical' },
  { v: 'INST', l: 'Instrumentation' },
  { v: 'SITE', l: 'Site Work' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  existingCodes: string[];
};

export function AddDisciplineModal({ open, onClose, projectId, existingCodes }: Props) {
  const qc = useQueryClient();

  const availableCodes = useMemo(
    () => DISCIPLINE_CODES.filter((d) => !existingCodes.includes(d.v)),
    [existingCodes],
  );

  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [budget, setBudget] = useState(0);

  // Default ROC template for the picked discipline
  const { data: roc } = useQuery({
    queryKey: ['roc-default', code] as const,
    enabled: open && !!code,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roc_templates')
        .select('id, name')
        .eq('discipline_code', code)
        .eq('is_default', true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      // tenant_id is derived server-side via RLS column constraints; the client
      // must supply it. Pull from the current session's app_users row.
      const { data: me, error: meErr } = await supabase
        .from('app_users')
        .select('tenant_id')
        .limit(1)
        .single();
      if (meErr) throw meErr;

      const { error } = await supabase.from('project_disciplines').insert({
        tenant_id: me.tenant_id,
        project_id: projectId,
        discipline_code: code,
        display_name: displayName || DISCIPLINE_CODES.find((d) => d.v === code)?.l || code,
        roc_template_id: roc?.id ?? null,
        budget_hrs: budget,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['disciplines', projectId] });
      qc.invalidateQueries({ queryKey: ['project-summary', projectId] });
      setCode('');
      setDisplayName('');
      setBudget(0);
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Add Discipline">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Discipline Code">
          <select className={inputClass} value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">— select —</option>
            {availableCodes.map((d) => (
              <option key={d.v} value={d.v}>
                {d.l} ({d.v})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Display Name" hint="Defaults to the code's standard name.">
          <input
            className={inputClass}
            placeholder={DISCIPLINE_CODES.find((d) => d.v === code)?.l ?? 'e.g. Civil'}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field label="Budget Hours">
          <input
            type="number"
            min={0}
            step={100}
            className={inputClass}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
        </Field>
        <Field label="ROC Template" hint="Tenant-default for the selected discipline.">
          <input
            className={inputClass}
            readOnly
            value={roc?.name ?? (code ? 'No default template — contact admin.' : '')}
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
          disabled={!code || !roc?.id || budget <= 0 || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? 'Adding…' : 'Add Discipline'}
        </Button>
      </div>
    </Modal>
  );
}
