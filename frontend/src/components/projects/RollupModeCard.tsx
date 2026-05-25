import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import { useCurrentUser, hasRole, useProjectProgressStreams } from '@/lib/queries';

type Mode = 'hours_weighted' | 'equal' | 'custom';

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'hours_weighted', label: 'Hours-weighted', hint: 'Composite % = total earned hrs / total budget hrs.' },
  { value: 'equal', label: 'Equal', hint: 'Each active discipline contributes 1/N regardless of size.' },
  { value: 'custom', label: 'Custom weights', hint: 'Set weights for disciplines + streams. Must sum to 1.0.' },
];

type Props = { projectId: string };

export function RollupModeCard({ projectId }: Props) {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canEditMode = hasRole(me?.role, 'admin');
  const canEditStreams = hasRole(me?.role, 'pc_reviewer');

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

  const streams = useProjectProgressStreams(projectId);

  const [mode, setMode] = useState<Mode>('hours_weighted');
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [streamDraft, setStreamDraft] = useState<
    Record<string, { pct: number; weight: number }>
  >({});

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

  useEffect(() => {
    if (!streams.data) return;
    const map: Record<string, { pct: number; weight: number }> = {};
    for (const s of streams.data) {
      map[s.stream_code] = {
        pct: s.percent_complete,
        weight: s.rollup_weight ?? 0,
      };
    }
    setStreamDraft(map);
  }, [streams.data]);

  const discSum = Object.values(draft).reduce((acc, v) => acc + v, 0);
  const streamSum = Object.values(streamDraft).reduce((acc, v) => acc + v.weight, 0);
  const totalSum = discSum + streamSum;
  const sumOk = Math.abs(totalSum - 1) < 0.01;

  const overallReady = useMemo(
    () => mode === 'custom' && (streams.data?.length ?? 0) > 0 && sumOk,
    [mode, streams.data, sumOk],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (canEditMode) {
        const { error: modeErr } = await supabase
          .from('projects')
          .update({ qty_rollup_mode: mode })
          .eq('id', projectId);
        if (modeErr) throw modeErr;

        if (mode === 'custom' && disciplines.data) {
          const { data: meRow, error: meErr } = await supabase
            .from('app_users')
            .select('tenant_id')
            .eq('id', me!.id)
            .single();
          if (meErr) throw meErr;
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
      }

      if (canEditStreams && streams.data && streams.data.length > 0) {
        const payload = streams.data.map((s) => ({
          stream_code: s.stream_code,
          percent_complete: streamDraft[s.stream_code]?.pct ?? s.percent_complete,
          rollup_weight:
            mode === 'custom'
              ? (streamDraft[s.stream_code]?.weight ?? s.rollup_weight ?? 0)
              : s.rollup_weight,
        }));
        const { error: streamErr } = await supabase.rpc('project_progress_streams_set', {
          p_project_id: projectId,
          p_streams: payload,
        });
        if (streamErr) throw streamErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-rollup-mode', projectId] });
      qc.invalidateQueries({ queryKey: ['discipline-weights', projectId] });
      qc.invalidateQueries({ queryKey: ['project-progress-streams', projectId] });
      qc.invalidateQueries({ queryKey: ['project-qty-rollup', projectId] });
    },
  });

  if (project.isLoading || disciplines.isLoading || streams.isLoading) {
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
        caption="Field composite uses disciplines only. Overall project % includes procurement and engineering when custom weights are configured."
      />

      <div className="grid gap-3 mb-4">
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
              disabled={!canEditMode}
              aria-label={m.label}
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
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-subtle)] mb-3">
            Discipline weights
          </div>
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
                  disabled={!canEditMode}
                />
              </Field>
            ))}
          </div>
        </div>
      )}

      {(streams.data ?? []).length > 0 && (
        <div className="border-t border-[color:var(--color-line)] pt-4 mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-subtle)] mb-1">
            Non-discipline progress
          </div>
          <p className="text-xs text-[color:var(--color-text-muted)] mb-3">
            Procurement and engineering progress updated weekly by auditor — not from clerk uploads.
          </p>
          <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
            <table className="is-table">
              <thead>
                <tr>
                  <th>Stream</th>
                  <th style={{ textAlign: 'right' }}>% complete</th>
                  {mode === 'custom' && <th style={{ textAlign: 'right' }}>Weight</th>}
                </tr>
              </thead>
              <tbody>
                {(streams.data ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="font-semibold">{s.display_name}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={100}
                        className={`${inputClass} w-24 ml-auto`}
                        value={streamDraft[s.stream_code]?.pct ?? s.percent_complete}
                        onChange={(e) =>
                          setStreamDraft({
                            ...streamDraft,
                            [s.stream_code]: {
                              pct: Number(e.target.value),
                              weight: streamDraft[s.stream_code]?.weight ?? s.rollup_weight ?? 0,
                            },
                          })
                        }
                        disabled={!canEditStreams}
                      />
                    </td>
                    {mode === 'custom' && (
                      <td className="text-right">
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          max={1}
                          className={`${inputClass} w-24 ml-auto`}
                          value={streamDraft[s.stream_code]?.weight ?? s.rollup_weight ?? 0}
                          onChange={(e) =>
                            setStreamDraft({
                              ...streamDraft,
                              [s.stream_code]: {
                                pct: streamDraft[s.stream_code]?.pct ?? s.percent_complete,
                                weight: Number(e.target.value),
                              },
                            })
                          }
                          disabled={!canEditMode}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'custom' && (
        <div className="mt-3 text-xs">
          <span className="text-[color:var(--color-text-muted)]">Combined weight sum: </span>
          <span
            className="font-mono"
            style={{
              color: sumOk
                ? 'var(--color-variance-favourable)'
                : 'var(--color-variance-unfavourable)',
            }}
          >
            {totalSum.toFixed(3)}
          </span>
          {!sumOk && (
            <span className="ml-2 text-[color:var(--color-variance-unfavourable)]">
              Discipline + stream weights must sum to 1.0
            </span>
          )}
          {overallReady && (
            <span className="ml-2 text-[color:var(--color-variance-favourable)]">
              Overall project % tile enabled
            </span>
          )}
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
          disabled={
            (!canEditMode && !canEditStreams) ||
            save.isPending ||
            (mode === 'custom' && canEditMode && !sumOk)
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save rollup settings'}
        </Button>
      </div>
    </Card>
  );
}
