import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useRocMilestonesForDiscipline, type ProgressRecord } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { fmt } from '@/lib/format';

type Props = {
  record: ProgressRecord;
  projectId: string;
  onClose: () => void;
};

export function RecordDetail({ record, projectId, onClose }: Props) {
  const qc = useQueryClient();
  const { data: rocMilestones } = useRocMilestonesForDiscipline(record.discipline_id);

  // Local draft of milestone values — debounced to the server.
  const [draft, setDraft] = useState<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const m of record.milestones) map[m.seq] = m.value;
    return map;
  });

  // Reset draft when the selected record changes.
  useEffect(() => {
    const map: Record<number, number> = {};
    for (const m of record.milestones) map[m.seq] = m.value;
    setDraft(map);
  }, [record.id, record.milestones]);

  const save = useMutation({
    mutationFn: async (milestones: { seq: number; value: number }[]) => {
      const { data, error } = await supabase.rpc('record_update_milestones', {
        p_record_id: record.id,
        p_milestones: milestones,
      });
      if (error) throw error;
      return data;
    },
    onMutate: async (milestones) => {
      await qc.cancelQueries({ queryKey: ['progress-records', projectId] });
      const prev = qc.getQueryData<ProgressRecord[]>(['progress-records', projectId]);
      qc.setQueryData<ProgressRecord[]>(['progress-records', projectId], (old) =>
        (old ?? []).map((r) =>
          r.id === record.id
            ? {
                ...r,
                milestones: Array.from({ length: 8 }, (_, i) => ({
                  seq: i + 1,
                  value: milestones.find((m) => m.seq === i + 1)?.value ?? 0,
                })),
              }
            : r,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['progress-records', projectId], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['progress-records', projectId] });
      qc.invalidateQueries({ queryKey: ['project-summary', projectId] });
    },
  });

  // Debounced server save — 400ms after the last change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = (next: Record<number, number>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      save.mutate(
        Object.entries(next).map(([seq, value]) => ({ seq: Number(seq), value })),
      );
    }, 400);
  };

  // Flush on unmount / record change to honour beforeunload guarantees.
  useEffect(() => {
    const handler = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        save.mutate(Object.entries(draft).map(([seq, value]) => ({ seq: Number(seq), value })));
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      if (timer.current) clearTimeout(timer.current);
    };
    // We intentionally depend on `draft` and `save` only via closure capture;
    // the effect re-registers when either changes.
  }, [draft, save]);

  const weights = rocMilestones ?? [];
  const liveEarnPct = weights.reduce((sum, m) => sum + (draft[m.seq] ?? 0) * m.weight, 0);
  const liveEarnWhrs = record.fld_whrs * liveEarnPct;
  const liveErnQty = record.fld_qty * liveEarnPct;

  const setMilestone = (seq: number, raw: number) => {
    const clamped = Math.min(1, Math.max(0, raw));
    const next = { ...draft, [seq]: clamped };
    setDraft(next);
    flush(next);
  };

  return (
    <Card className="border-l-4" >
      <CardHeader
        title={`Record #${record.rec_no} — ${record.dwg} Rev ${record.rev}`}
        actions={
          <>
            {save.isPending && (
              <span className="text-xs text-[color:var(--color-text-muted)]">Saving…</span>
            )}
            {save.isError && (
              <span className="text-xs text-[color:var(--color-variance-unfavourable)]">
                {(save.error as Error).message}
              </span>
            )}
            {save.isSuccess && !save.isPending && (
              <span className="text-xs text-[color:var(--color-variance-favourable)]">Saved</span>
            )}
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="is-stat-label">Discipline</div>
          <div className="font-medium mt-1">{record.discipline_name}</div>
        </div>
        <div>
          <div className="is-stat-label">COA Code</div>
          <div className="font-mono mt-1">{record.coa_code}</div>
        </div>
        <div>
          <div className="is-stat-label">Description</div>
          <div className="mt-1">{record.description}</div>
        </div>
      </div>

      <h4 className="text-sm font-semibold mb-3">
        Milestones{record.discipline_code ? ` — ${record.discipline_code} ROC` : ''}
      </h4>
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
        {Array.from({ length: 8 }, (_, i) => {
          const seq = i + 1;
          const meta = weights.find((m) => m.seq === seq);
          const v = draft[seq] ?? 0;
          const filled = v > 0;
          return (
            <div
              key={seq}
              className="rounded-md p-2 border text-center"
              style={{
                background: filled ? 'var(--color-primary-soft)' : 'var(--color-raised)',
                borderColor: filled ? 'var(--color-primary)' : 'var(--color-line)',
              }}
            >
              <div className="text-[10px] uppercase tracking-wide font-bold text-[color:var(--color-text-muted)]">
                M{seq}
              </div>
              <div className="text-[11px] mt-0.5 h-8 overflow-hidden text-[color:var(--color-text)]">
                {meta?.label ?? '—'}
              </div>
              <div className="text-[10px] text-[color:var(--color-text-subtle)] font-mono">
                {meta ? fmt.pct(meta.weight) : '—'}
              </div>
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={v}
                onChange={(e) => setMilestone(seq, Number(e.target.value))}
                className="is-form-input w-full mt-1.5 text-center font-mono"
                style={{ minHeight: 30, padding: '4px 6px', fontSize: 12 }}
                aria-label={`Milestone ${seq} value`}
              />
            </div>
          );
        })}
      </div>

      <div
        className="flex items-center justify-between mt-4 p-4 rounded-md flex-wrap gap-4 text-sm"
        style={{ background: 'var(--color-raised)' }}
      >
        <div>
          <div className="is-stat-label">Earned %</div>
          <div className="font-mono text-lg font-bold mt-0.5" style={{ color: 'var(--color-primary)' }}>
            {fmt.pct(liveEarnPct)}
          </div>
        </div>
        <div>
          <div className="is-stat-label">ERN QTY</div>
          <div className="font-mono text-base mt-0.5">{liveErnQty.toFixed(2)}</div>
        </div>
        <div>
          <div className="is-stat-label">EARN WHRS</div>
          <div className="font-mono text-base mt-0.5">{liveEarnWhrs.toFixed(2)}</div>
        </div>
      </div>
    </Card>
  );
}
