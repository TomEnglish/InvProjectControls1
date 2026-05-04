import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import { useCurrentUser, hasRole } from '@/lib/queries';

type Mode = 'hours_weighted' | 'equal' | 'custom';

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'hours_weighted', label: 'Hours-weighted', hint: 'Composite % = total earned hrs / total budget hrs.' },
  { value: 'equal', label: 'Equal', hint: 'Each active discipline contributes 1/N regardless of size.' },
  { value: 'custom', label: 'Custom weights', hint: 'Set a weight per discipline. Must sum to 1.0.' },
];

type Props = { projectId: string };

export function RollupModeCard({ projectId }: Props) {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canEdit = hasRole(me?.role, 'admin');

  const project = useQuery({
    queryKey: ['project-rollup-mode', projectId] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, qty_rollup_mode')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return data as { id: string; qty_rollup_mode: Mode };
    },
  });

  const disciplines = useQuery({
    queryKey: ['project-disciplines-weights', projectId] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_disciplines')
        .select('id, discipline_code, display_name')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('discipline_code');
      if (error) throw error;
      return (data ?? []) as { id: string; discipline_code: string; display_name: string }[];
    },
  });

  const weights = useQuery({
    queryKey: ['discipline-weights', projectId] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_discipline_weights')
        .select('discipline_id, weight')
        .eq('project_id', projectId);
      if (error) throw error;
      return (data ?? []) as { discipline_id: string; weight: number | string }[];
    },
  });

  const [mode, setMode] = useState<Mode>('hours_weighted');
  const [draft, setDraft] = useState<Record<string, number>>({});

  useEffect(() => {
    if (project.data) setMode(project.data.qty_rollup_mode);
  }, [project.data]);

  useEffect(() => {
    if (!disciplines.data) return;
    const map: Record<string, number> = {};
    const existingByDisc = new Map(
      (weights.data ?? []).map((w) => [w.discipline_id, Number(w.weight)]),
    );
    const n = disciplines.data.length;
    const equal = n > 0 ? Number((1 / n).toFixed(6)) : 0;
    for (const d of disciplines.data) {
      map[d.id] = existingByDisc.get(d.id) ?? equal;
    }
    setDraft(map);
  }, [disciplines.data, weights.data]);

  const sum = Object.values(draft).reduce((acc, v) => acc + v, 0);
  const sumOk = Math.abs(sum - 1) < 0.01;

  const save = useMutation({
    mutationFn: async () => {
      const { data: meRow, error: meErr } = await supabase
        .from('app_users')
        .select('tenant_id')
        .eq('id', me!.id)
        .single();
      if (meErr) throw meErr;
      const { error: modeErr } = await supabase
        .from('projects')
        .update({ qty_rollup_mode: mode })
        .eq('id', projectId);
      if (modeErr) throw modeErr;

      if (mode === 'custom' && disciplines.data) {
        const rows = disciplines.data.map((d) => ({
          tenant_id: meRow.tenant_id,
          project_id: projectId,
          discipline_id: d.id,
          weight: draft[d.id] ?? 0,
          updated_by: me!.id,
        }));
        const { error: wErr } = await supabase
          .from('project_discipline_weights')
          .upsert(rows, { onConflict: 'project_id,discipline_id' });
        if (wErr) throw wErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-rollup-mode', projectId] });
      qc.invalidateQueries({ queryKey: ['discipline-weights', projectId] });
      qc.invalidateQueries({ queryKey: ['project-qty-rollup', projectId] });
    },
  });

  if (project.isLoading || disciplines.isLoading) {
    return (
      <Card>
        <div className="is-skeleton" style={{ height: 120, width: '100%' }} />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        eyebrow="Composite quantity"
        title="Rollup mode"
        caption="Drives the composite-qty KPI on the dashboard."
      />

      <div className="grid gap-3 mb-4">
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
              disabled={!canEdit}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-sm">{m.label}</div>
              <div className="text-xs text-[color:var(--color-text-muted)]">{m.hint}</div>
            </div>
          </label>
        ))}
      </div>

      {mode === 'custom' && (
        <div className="border-t border-[color:var(--color-line)] pt-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            {(disciplines.data ?? []).map((d) => (
              <Field key={d.id} label={`${d.discipline_code} — ${d.display_name}`}>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  className={inputClass}
                  value={draft[d.id] ?? 0}
                  onChange={(e) =>
                    setDraft({ ...draft, [d.id]: Number(e.target.value) })
                  }
                  disabled={!canEdit}
                />
              </Field>
            ))}
          </div>
          <div className="mt-3 text-xs">
            <span className="text-[color:var(--color-text-muted)]">Sum: </span>
            <span
              className="font-mono"
              style={{
                color: sumOk
                  ? 'var(--color-variance-favourable)'
                  : 'var(--color-variance-unfavourable)',
              }}
            >
              {sum.toFixed(3)}
            </span>
            {!sumOk && (
              <span className="ml-2 text-[color:var(--color-variance-unfavourable)]">
                Must sum to 1.0
              </span>
            )}
          </div>
        </div>
      )}

      {save.error && (
        <div className="is-toast is-toast-danger mt-3">{(save.error as Error).message}</div>
      )}
      {save.isSuccess && !save.isPending && (
        <div className="is-toast is-toast-success mt-3">Saved.</div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          disabled={!canEdit || save.isPending || (mode === 'custom' && !sumOk)}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save rollup mode'}
        </Button>
      </div>
    </Card>
  );
}
