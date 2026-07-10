import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  useWorkTypeMilestonesForRecord,
  useProject,
  useCurrentUser,
  hasRole,
  type ProgressRow,
} from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import { AttachmentsList } from '@/components/attachments/AttachmentsList';
import { fmt } from '@/lib/format';

type Props = {
  record: ProgressRow;
  projectId: string;
  onClose: () => void;
};

export function RecordDetail({ record, projectId, onClose }: Props) {
  const qc = useQueryClient();
  // The panel mounts below the records table — bring it into view on open
  // and when the user clicks a different row, or it sits off-screen.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [record.id]);
  const { data: rocMilestones } = useWorkTypeMilestonesForRecord(
    record.work_type_id,
    record.discipline_id,
  );
  const { data: project } = useProject(projectId);
  const { data: me } = useCurrentUser();
  // Record fields (budget, identity, actuals) are part of the baseline scope,
  // so they're editable only before the baseline is locked — after lock, scope
  // changes go through Change Orders. Milestone % below stays editable for
  // execution progress regardless.
  const canEditFields = project?.status === 'draft' && hasRole(me?.role, 'pc_reviewer');

  // Editable field draft (strings for inputs; converted on save).
  type FieldDraft = {
    dwg: string;
    rev: string;
    code: string;
    description: string;
    budget_hrs: string;
    budget_qty: string;
    actual_hrs: string;
    percent_complete: string;
  };
  const toFieldDraft = useCallback(
    (r: ProgressRow): FieldDraft => ({
      dwg: r.dwg ?? '',
      rev: r.rev ?? '',
      code: r.code ?? '',
      description: r.description ?? '',
      budget_hrs: String(r.budget_hrs ?? 0),
      budget_qty: r.budget_qty == null ? '' : String(r.budget_qty),
      actual_hrs: String(r.actual_hrs ?? 0),
      percent_complete: String(r.percent_complete ?? 0),
    }),
    [],
  );
  const [fields, setFields] = useState<FieldDraft>(() => toFieldDraft(record));
  useEffect(() => {
    setFields(toFieldDraft(record));
  }, [record, toFieldDraft]);
  const setField = (k: keyof FieldDraft, v: string) => setFields((f) => ({ ...f, [k]: v }));

  const saveFields = useMutation({
    mutationFn: async () => {
      const num = (s: string) => (s.trim() === '' ? null : Number(s));
      const { error } = await supabase
        .from('progress_records')
        .update({
          dwg: fields.dwg.trim() || null,
          rev: fields.rev.trim() || null,
          code: fields.code.trim() || null,
          // description is NOT NULL — fall back to the drawing/tag or a marker.
          description: fields.description.trim() || record.dwg || '(unnamed)',
          budget_hrs: num(fields.budget_hrs) ?? 0,
          budget_qty: num(fields.budget_qty),
          actual_hrs: num(fields.actual_hrs) ?? 0,
          percent_complete: num(fields.percent_complete) ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id);
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
      qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['discipline-metrics', projectId] });
      // budget_hrs edits resync the discipline budget (DB trigger) → refresh
      // the Active Disciplines / budget views too.
      qc.invalidateQueries({ queryKey: ['disciplines', projectId] });
      qc.invalidateQueries({ queryKey: ['budget-rollup', projectId] });
    },
  });

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
    mutationFn: async (vars: { recordId: string; milestones: { seq: number; value: number }[] }) => {
      // Upsert each milestone row directly. progress_record_milestones has a
      // unique (progress_record_id, seq) constraint that lets us upsert; the
      // RLS policy `prm_reviewer_write` covers pc_reviewer+ roles.
      // tenant_id is omitted so the server default (current_tenant_id()) fills it.
      const rows = vars.milestones.map((m) => ({
        progress_record_id: vars.recordId,
        seq: m.seq,
        value: m.value,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from('progress_record_milestones')
        .upsert(rows, { onConflict: 'progress_record_id,seq' });
      if (error) throw error;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['progress-rows', projectId] });
      const prev = qc.getQueryData<ProgressRow[]>(['progress-rows', projectId]);
      // Optimistic update mirrors exactly what was sent — work types can
      // have 1..N milestones, so a fixed length-8 array would lie about the
      // persisted shape for any work_type with <8 entries (e.g. CIV-COMP).
      qc.setQueryData<ProgressRow[]>(['progress-rows', projectId], (old) =>
        (old ?? []).map((r) =>
          r.id === vars.recordId
            ? {
                ...r,
                milestones: vars.milestones.map((m) => ({ seq: m.seq, value: m.value })),
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
  // useMutation's `mutate` is referentially stable, so callbacks below can
  // depend on it without re-arming effects every render.
  const saveMutate = save.mutate;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounced edits waiting to be written, tagged with the record they belong
  // to — kept in a ref so unmount / record-switch / beforeunload can flush
  // them without racing React's render cycle.
  const pending = useRef<{ recordId: string; values: Record<number, number> } | null>(null);

  const commitPending = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    saveMutate({
      recordId: p.recordId,
      milestones: Object.entries(p.values).map(([seq, value]) => ({ seq: Number(seq), value })),
    });
  }, [saveMutate]);

  const queueSave = (next: Record<number, number>) => {
    pending.current = { recordId: record.id, values: next };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commitPending, 400);
  };

  // Flush (never drop) pending edits when the panel closes or the user
  // switches to a different record.
  useEffect(() => {
    return () => commitPending();
  }, [record.id, commitPending]);

  // Best-effort flush if the tab is closed mid-debounce.
  useEffect(() => {
    window.addEventListener('beforeunload', commitPending);
    return () => window.removeEventListener('beforeunload', commitPending);
  }, [commitPending]);

  const weights = useMemo(() => rocMilestones ?? [], [rocMilestones]);
  // weights[i].weight sums to 1.0; draft values are 0..100.
  // earn_pct (0..1) = sum(value/100 * weight).
  const liveEarnPct = weights.reduce((sum, m) => sum + ((draft[m.seq] ?? 0) / 100) * m.weight, 0);
  // Use the edited budget so earned hrs/qty track live as the user edits it.
  const editBudgetHrs = Number(fields.budget_hrs) || 0;
  const editBudgetQty = fields.budget_qty.trim() === '' ? 0 : Number(fields.budget_qty) || 0;
  const liveEarnHrs = editBudgetHrs * liveEarnPct;
  const liveEarnedQty = editBudgetQty * liveEarnPct;

  // Detect milestone rows that don't line up with the current work_type's
  // milestone set. These are leftover values from when the record (or its
  // work_type) had more milestones — v_progress_record_ev's seq-keyed join
  // silently drops them from earned-percentage math. Surface them so a PM
  // editing the record knows the orphaned numbers aren't counting.
  const orphans = useMemo(() => {
    if (weights.length === 0) return [] as { seq: number; value: number }[];
    const valid = new Set(weights.map((m) => m.seq));
    return Object.entries(draft)
      .map(([seq, value]) => ({ seq: Number(seq), value }))
      .filter((m) => !valid.has(m.seq) && m.value > 0)
      .sort((a, b) => a.seq - b.seq);
  }, [weights, draft]);

  const clearOrphans = () => {
    if (orphans.length === 0) return;
    // Persist orphans as zero rather than deleting locally — upsert leaves
    // existing rows alone, so on the next read they'd re-populate and the
    // warning would reappear. Setting value=0 keeps the row consistent and
    // makes the "stale" state durable.
    const next = { ...draft };
    for (const o of orphans) next[o.seq] = 0;
    setDraft(next);
    queueSave(next);
  };

  const setMilestone = (seq: number, raw: number) => {
    const clamped = Math.min(100, Math.max(0, raw));
    const next = { ...draft, [seq]: clamped };
    setDraft(next);
    queueSave(next);
  };

  return (
    <div ref={rootRef}>
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
      {canEditFields ? (
        <div className="mb-4 rounded-md border border-[color:var(--color-line)] p-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold">Edit record</h4>
            <div className="flex items-center gap-2">
              {saveFields.isError && (
                <span className="text-xs text-[color:var(--color-variance-unfavourable)]">
                  {(saveFields.error as Error).message}
                </span>
              )}
              {saveFields.isSuccess && !saveFields.isPending && (
                <span className="text-xs text-[color:var(--color-variance-favourable)]">Saved</span>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => saveFields.mutate()}
                disabled={saveFields.isPending}
              >
                {saveFields.isPending ? 'Saving…' : 'Save fields'}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="DWG">
              <input className={inputClass} value={fields.dwg} onChange={(e) => setField('dwg', e.target.value)} />
            </Field>
            <Field label="Rev">
              <input className={inputClass} value={fields.rev} onChange={(e) => setField('rev', e.target.value)} />
            </Field>
            <Field label="Account code">
              <input className={inputClass} value={fields.code} onChange={(e) => setField('code', e.target.value)} />
            </Field>
            <Field label="Description">
              <input
                className={inputClass}
                value={fields.description}
                onChange={(e) => setField('description', e.target.value)}
              />
            </Field>
            <Field label="Budget hrs (FLD_WHRS)">
              <input
                type="number"
                min={0}
                step="any"
                className={inputClass}
                value={fields.budget_hrs}
                onChange={(e) => setField('budget_hrs', e.target.value)}
              />
            </Field>
            <Field label="Budget qty (FLD_QTY)">
              <input
                type="number"
                step="any"
                className={inputClass}
                value={fields.budget_qty}
                onChange={(e) => setField('budget_qty', e.target.value)}
              />
            </Field>
            <Field label="Actual hrs">
              <input
                type="number"
                min={0}
                step="any"
                className={inputClass}
                value={fields.actual_hrs}
                onChange={(e) => setField('actual_hrs', e.target.value)}
              />
            </Field>
            <Field label="% complete" hint="0–100">
              <input
                type="number"
                min={0}
                max={100}
                step="any"
                className={inputClass}
                value={fields.percent_complete}
                onChange={(e) => setField('percent_complete', e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-2 text-xs text-[color:var(--color-text-muted)]">
            Discipline <span className="font-medium">{record.discipline_name ?? '—'}</span> · IWP{' '}
            <span className="font-mono">{record.iwp_name ?? '—'}</span> · Foreman{' '}
            {record.foreman_name ?? '—'}
          </div>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <ReadField label="Account code" value={record.code} mono />
          <ReadField label="Discipline" value={record.discipline_name} />
          <ReadField label="IWP" value={record.iwp_name} mono />
          <ReadField label="Foreman" value={record.foreman_name} />
          <ReadField label="Budget hrs" value={fmt.oneDp(record.budget_hrs)} mono />
          <ReadField label="Budget qty" value={record.budget_qty == null ? '—' : fmt.oneDp(record.budget_qty)} mono />
          <ReadField label="Actual hrs" value={fmt.oneDp(record.actual_hrs)} mono />
          <ReadField label="% complete" value={`${fmt.oneDp(record.percent_complete)}%`} mono />
          {project && project.status !== 'draft' && (
            <div className="col-span-2 md:col-span-4 text-xs text-[color:var(--color-text-muted)]">
              Baseline is locked — record scope is read-only; changes go through Change Orders.
              Milestone progress below stays editable.
            </div>
          )}
        </div>
      )}

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
              <div
                className="text-[11px] mt-0.5 h-8 overflow-hidden text-[color:var(--color-text)] is-tip cursor-help"
                data-tip={meta.label}
              >
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

      {orphans.length > 0 && (
        <div className="is-toast is-toast-warn mt-3 text-xs">
          <strong>
            {orphans.length} stale milestone value{orphans.length === 1 ? '' : 's'} — not counted toward earned %
          </strong>
          <div className="mt-1">
            Recorded at M{orphans.map((o) => o.seq).join(', M')}, which the
            current work type ({record.work_type_code ?? '—'}) doesn't define.
            They remain in the database but don't contribute to earned-value
            math.
            <button
              type="button"
              onClick={clearOrphans}
              className="ml-2 underline text-[color:var(--color-text)] hover:text-[color:var(--color-primary)]"
            >
              Clear them
            </button>
          </div>
        </div>
      )}

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

      <div className="mt-4 border-t border-[color:var(--color-line)] pt-4">
        <h4 className="text-sm font-semibold mb-3">Attachments</h4>
        {/* progress_records rows are the "audit records" of ARCHITECTURE.md —
            drawing files and mark-ups attach against the record id. */}
        <AttachmentsList entity="audit_record" entityId={record.id} compact />
      </div>

      <AuditDetails record={record} />
    </Card>
    </div>
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
              ['Account code', record.code],
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

/** Labelled read-only value used when record fields aren't editable. */
function ReadField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="is-stat-label">{label}</div>
      <div className={`mt-1 ${mono ? 'font-mono' : ''}`}>{value == null || value === '' ? '—' : value}</div>
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
