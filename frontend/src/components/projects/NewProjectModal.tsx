import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useProjectStore } from '@/stores/project';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Create a new draft project. Goes through the project_create RPC rather than
 * a direct insert: RLS can't self-bootstrap the creator's project_members
 * row (needed for the COA-scope step), so the RPC inserts project +
 * membership atomically. On success we select the new project and drop the
 * user on Project Setup, which is the top of the draft → load → lock flow.
 */
export function NewProjectModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setCurrentProjectId = useProjectStore((s) => s.setCurrentProjectId);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const reset = () => {
    setCode('');
    setName('');
    setClient('');
    setStartDate('');
    setEndDate('');
  };

  const create = useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('project_create', {
        p_project_code: code.trim(),
        p_name: name.trim(),
        p_client: client.trim(),
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setCurrentProjectId(newId);
      reset();
      onClose();
      navigate('/projects');
    },
  });

  const datesOk = !startDate || !endDate || endDate >= startDate;
  const canSubmit =
    code.trim() !== '' &&
    name.trim() !== '' &&
    client.trim() !== '' &&
    !!startDate &&
    !!endDate &&
    datesOk;

  const dirty = !!(code || name || client || startDate || endDate);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    create.mutate();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New project"
      caption="Creates a draft project. Add disciplines, load a baseline, and lock it on Project Setup."
      dirty={dirty}
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Project code" required hint="Unique within your organization.">
            <input
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="KIS-2026-003"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>
          <Field label="Client" required>
            <input
              className={inputClass}
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="ExxonMobil Baytown"
              required
            />
          </Field>
        </div>

        <Field label="Project name" required>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Turnaround Bravo"
            required
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Start date" required>
            <input
              type="date"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </Field>
          <Field
            label="End date"
            required
            error={!datesOk ? 'End date must be on or after the start date.' : undefined}
          >
            <input
              type="date"
              className={inputClass}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </Field>
        </div>

        {create.error && (
          <div className="is-toast is-toast-danger">{(create.error as Error).message}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
