import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWorkTypeMilestonesForRecord, type ProgressRow } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { fmt } from '@/lib/format';

type Props = {
  record: ProgressRow;
  projectId: string;
  onClose: () => void;
};

export function RecordDetail({ record, projectId, onClose }: Props) {
  const qc = useQueryClient();
  const { data: rocMilestones } = useWorkTypeMilestonesForRecord(
    record.work_type_id,
    record.discipline_id,
  );

  // Local draft of milestone values (0..100). Debounced to the server.
  const [draft, setDraft] = useState<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const m of record.milestones) map[m.seq] = m.value;
    return map;
  });

  useEffect(() => {
    const map: Record<number, number> = {};
    for (const m of record.milestones) map[m.seq] = m.value;
    setDraft(map);
  }, [record.id, record.milestones]);

  const save = useMutation({
    mutationFn: async (milestones: { seq: number; value: number }[]) => {
      // Upsert each milestone row directly. progress_record_milestones has a
      // unique (progress_record_id, seq) constraint that lets us upsert; the
      // RLS policy `prm_editor_write` covers editor+ roles.
      const rows = milestones.map((m) => ({
        tenant_id: undefined as unknown as string, // server fills via current_tenant_id() default
        progress_record_id: record.id,
        seq: m.seq,
        value: m.value,
        updated_at: new Date().toISOString(),
      }));
      // Drop tenant_id so the trigger / default fills it. We don't have a
      // local tenant_id at hand here without an extra read.
      for (const r of rows) delete (r as Record<string, unknown>).tenant_id;
      const { error } = await supabase
        .from('progress_record_milestones')
        .upsert(rows, { onConflict: 'progress_record_id,seq' });
      if (error) throw error;
    },
    onMutate: async (milestones) => {
      await qc.cancelQueries({ queryKey: ['progress-rows', projectId] });
      const prev = qc.getQueryData<ProgressRow[]>(['progress-rows', projectId]);
      qc.setQueryData<ProgressRow[]>(['progress-rows', projectId], (old) =>
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
      if (ctx?.prev) qc.setQueryData(['progress-rows', projectId], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
      qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
    },
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = (next: Record<number, number>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      save.mutate(Object.entries(next).map(([seq, value]) => ({ seq: Number(seq), value })));
    }, 400);
  };

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
  }, [draft, save]);

  const weights = rocMilestones ?? [];
  // weights[i].weight sums to 1.0; draft values are 0..100.
  // earn_pct (0..1) = sum(value/100 * weight).
  const liveEarnPct = weights.reduce((sum, m) => sum + ((draft[m.seq] ?? 0) / 100) * m.weight, 0);
  const liveEarnHrs = record.budget_hrs * liveEarnPct;
  const liveEarnedQty = (record.budget_qty ?? 0) * liveEarnPct;

  const setMilestone = (seq: number, raw: number) => {
    const clamped = Math.min(100, Math.max(0, raw));
    const next = { ...draft, [seq]: clamped };
    setDraft(next);
    flush(next);
  };

  return (
    <Card className="border-l-4">
      <CardHeader
        title={`Record ${record.record_no != null ? `#${record.record_no} ` : ''}— ${record.dwg ?? '(no dwg)'} ${record.rev ? `Rev ${record.rev}` : ''}`}
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
          <div className="font-medium mt-1">{record.discipline_name ?? '—'}</div>
        </div>
        <div>
          <div className="is-stat-label">IWP</div>
          <div className="font-mono mt-1">{record.iwp_name ?? '—'}</div>
        </div>
        <div>
          <div className="is-stat-label">Foreman</div>
          <div className="mt-1">{record.foreman_name ?? '—'}</div>
        </div>
      </div>

      <h4 className="text-sm font-semibold mb-3">
        Milestones
        {record.work_type_code ? ` — ${record.work_type_code} (${record.work_type_description ?? ''})` : ''}
      </h4>
      {/*
        Work types have variable milestone counts (1–8), so the matrix renders
        only as many cells as the work_type defines. CIV-COMP shows one cell;
        PIPE-STD shows eight.
      */}
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
        {weights.length === 0 && (
          <div className="col-span-4 md:col-span-8 text-xs text-[color:var(--color-text-muted)] italic">
            No work type assigned for this record — set one on the Work Types
            page or via re-upload to track milestone progress.
          </div>
        )}
        {weights.map((meta) => {
          const seq = meta.seq;
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
                {meta.label}
              </div>
              <div className="text-[10px] text-[color:var(--color-text-subtle)] font-mono">
                {fmt.pct(meta.weight)}
              </div>
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={v}
                onChange={(e) => setMilestone(seq, Number(e.target.value))}
                className="is-form-input w-full mt-1.5 text-center font-mono"
                style={{ minHeight: 30, padding: '4px 6px', fontSize: 12 }}
                aria-label={`Milestone ${seq} percent`}
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
          <div className="is-stat-label">Earned Qty</div>
          <div className="font-mono text-base mt-0.5">{liveEarnedQty.toFixed(2)}</div>
        </div>
        <div>
          <div className="is-stat-label">Earned Hrs</div>
          <div className="font-mono text-base mt-0.5">{liveEarnHrs.toFixed(2)}</div>
        </div>
      </div>

      <AuditDetails record={record} />
    </Card>
  );
}

/**
 * Read-only display of the audit-file columns we persist but don't edit yet
 * (sched_id, cwp, test_pkg, spec triplet, TA_*, PSLIP, imported earned values,
 * generated whrs_unit). Collapsed by default — users open it when they want
 * the full schedule / spec / turnaround context for a row that came in via
 * Sandra's per-discipline upload.
 */
function AuditDetails({ record }: { record: ProgressRow }) {
  const [open, setOpen] = useState(false);

  // Only show the section if at least one of the 17 NEW audit columns
  // (added in 20260508000004) is populated. `code` is excluded from the
  // gate because it's now always set — required on the New Record modal
  // and backfilled by 20260508000003 — and showing the panel just for the
  // code would duplicate information already in the row header.
  const populated =
    record.sched_id ||
    record.system ||
    record.carea ||
    record.var_area ||
    record.test_pkg ||
    record.cwp ||
    record.spl_cnt != null ||
    record.gen_foreman_name ||
    record.paint_spec ||
    record.insu_spec ||
    record.heat_trace_spec ||
    record.ta_bank ||
    record.ta_bay ||
    record.ta_level ||
    record.pslip ||
    record.earned_qty_imported != null ||
    record.earn_whrs_imported != null ||
    record.whrs_unit != null ||
    record.source_row != null;
  if (!populated) return null;

  return (
    <div className="mt-4 border-t border-[color:var(--color-line)] pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Audit details
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailGroup
            label="Schedule & Package"
            fields={[
              ['COA code', record.code],
              ['Schedule ID', record.sched_id],
              ['CWP', record.cwp],
              ['Test package', record.test_pkg],
              ['Spool count', record.spl_cnt],
              ['General foreman', record.gen_foreman_name],
              ['Source row', record.source_row],
            ]}
          />
          <DetailGroup
            label="Area dimensions"
            fields={[
              ['System', record.system],
              ['CAREA', record.carea],
              ['Line / area', record.line_area],
              ['Variant area', record.var_area],
            ]}
          />
          <DetailGroup
            label="Specs"
            fields={[
              ['Material spec', record.attr_spec],
              ['Paint spec', record.paint_spec],
              ['Insulation spec', record.insu_spec],
              ['Heat-trace spec', record.heat_trace_spec],
            ]}
          />
          <DetailGroup
            label="Material / Turnaround / Imported"
            fields={[
              ['Packing slip', record.pslip],
              ['TA Bank', record.ta_bank],
              ['TA Bay', record.ta_bay],
              ['TA Level', record.ta_level],
              ['Imported earned qty', record.earned_qty_imported],
              ['Imported earned hrs', record.earn_whrs_imported],
              ['Hours per unit', record.whrs_unit],
            ]}
          />
        </div>
      )}
    </div>
  );
}

function DetailGroup({
  label,
  fields,
}: {
  label: string;
  fields: [string, string | number | null | undefined][];
}) {
  const populated = fields.filter(([, v]) => v != null && v !== '');
  if (populated.length === 0) return null;
  return (
    <div className="rounded-md p-3" style={{ background: 'var(--color-raised)' }}>
      <div className="is-stat-label mb-2">{label}</div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {populated.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[color:var(--color-text-muted)]">{k}</dt>
            <dd className="font-mono text-right">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
