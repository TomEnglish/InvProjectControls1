import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, AlertTriangle, Info, ClipboardCheck } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { NoProjectSelected } from '@/components/ui/NoProjectSelected';
import { fmt } from '@/lib/format';
import {
  useImportManifests,
  useBaselineIngestionStats,
  useBaselineRecnoDwgCheck,
  useBaselineQualityChecks,
  useDataCheckSignoff,
  useCurrentUser,
  useProjectClosed,
  hasRole,
  type DataCheckSignoff,
  type RecnoDwgCheck,
  type BaselineQualityChecks,
} from '@/lib/queries';
import { FrozenBanner } from '@/components/ui/FrozenBanner';
import { summarizeQuality, type QualityAgg } from '@/lib/qualityChecks';
import {
  latestManifestsBySheet,
  compareDiscipline,
  compareColumns,
  compareWorkTypePivot,
  type IngestionCheck,
  type DisciplineIngestionStats,
} from '@/lib/ingestionStats';

/**
 * Ingestion Data Check — did everything in the QMR workbook actually land?
 *
 * Reconciliation, not just profiling: at import time the QMR baseline card
 * stores a manifest per audit tab (row counts, per-column non-null counts,
 * numeric sums/ranges, milestone entries, work-type pivot) computed from the
 * exact payload it sent. This page recomputes the same aggregates from the
 * database and diffs the two, so every number has an expected value next to
 * it. Sums act as checksums — a dropped row, truncated value, or unit-scale
 * error moves a sum even when counts still agree.
 */
export function DataCheckPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const manifests = useImportManifests(projectId);
  const dbStats = useBaselineIngestionStats(projectId);
  const recnoDwg = useBaselineRecnoDwgCheck(projectId);
  const quality = useBaselineQualityChecks(projectId);
  const signoff = useDataCheckSignoff(projectId);
  const { data: me } = useCurrentUser();
  const frozen = useProjectClosed(projectId);
  const canVerify = hasRole(me?.role, 'pc_reviewer') && !frozen;

  if (!projectId) {
    return <NoProjectSelected message="Pick a project in the top bar to run its data check." />;
  }
  if (manifests.isLoading || dbStats.isLoading || recnoDwg.isLoading || quality.isLoading) {
    return (
      <Card>
        <div className="h-6 bg-[color:var(--color-canvas)] rounded w-48 animate-pulse" />
      </Card>
    );
  }
  if (manifests.error || dbStats.error || recnoDwg.error || quality.error) {
    return (
      <Card>
        <div className="is-toast is-toast-danger">
          {((manifests.error ?? dbStats.error ?? recnoDwg.error ?? quality.error) as Error).message}
        </div>
      </Card>
    );
  }

  const latest = latestManifestsBySheet(manifests.data ?? []);
  const db = dbStats.data ?? [];

  // REC_NO sequence + DWG presence checks — two per discipline, independent of
  // manifests, so they fold into the totals in both the manifest and
  // no-manifest branches.
  const recnoRows = recnoDwg.data ?? [];
  const recnoDwgTotal = recnoRows.length * 2;
  const recnoDwgFailing = recnoRows.reduce(
    (n, r) => n + (r.recno_ok ? 0 : 1) + (r.dwg_ok ? 0 : 1),
    0,
  );

  // Semantic quality checks: one per work type (milestone weights) + six
  // project-level gates. All fold into the Verify Load totals.
  const qc = quality.data ?? {
    milestone_weights: [],
    disciplines: [],
    coa_out_of_scope_codes: [],
    work_type_unmapped_codes: [],
    unassigned_count: 0,
  };
  const qualityAggChecks = summarizeQuality(qc);
  const qualityTotal = qc.milestone_weights.length + qualityAggChecks.length;
  const qualityFailing =
    qc.milestone_weights.filter((w) => !w.ok).length +
    qualityAggChecks.filter((c) => c.count > 0).length;

  if (latest.length === 0) {
    return (
      <div className="space-y-4">
        <FrozenBanner projectId={projectId} />
        <Card>
          <CardHeader
            eyebrow="Ingestion"
            title="Data Check"
            caption={
              'No import manifests yet. Manifests are captured when a baseline is ' +
              'loaded from the Baseline by discipline zones on Project Setup — load one ' +
              'and this page fills in with a file-vs-database reconciliation.'
            }
          />
          {db.length > 0 && <DbOnlyProfile db={db} />}
          {db.length > 0 && (
            <div className="mt-3">
              <SignoffStrip
                projectId={projectId}
                signoff={signoff.data ?? null}
                canVerify={canVerify}
                checksTotal={recnoDwgTotal + qualityTotal}
                checksFailing={recnoDwgFailing + qualityFailing}
                latestImportAt={null}
              />
            </div>
          )}
        </Card>
        {recnoRows.length > 0 && <RecnoDwgCard rows={recnoRows} />}
        {qc.milestone_weights.length > 0 && <MilestoneWeightsCard rows={qc.milestone_weights} />}
        {qc.disciplines.length > 0 && (
          <BaselineQualityCard qc={qc} aggChecks={qualityAggChecks} />
        )}
      </div>
    );
  }

  // Checks run per discipline (all tabs that landed on it, summed); the
  // table still renders one row per tab, showing its discipline's status.
  const checksByDiscipline = new Map<string, IngestionCheck[]>();
  for (const m of latest) {
    const code = m.discipline_code ?? '(none)';
    if (checksByDiscipline.has(code)) continue;
    const group = latest.filter((x) => (x.discipline_code ?? '(none)') === code);
    checksByDiscipline.set(
      code,
      compareDiscipline(group, db.find((s) => s.discipline_code === m.discipline_code)),
    );
  }
  const disciplineChecks = latest.map((m) => ({
    manifest: m,
    db: db.find((s) => s.discipline_code === m.discipline_code),
    checks: checksByDiscipline.get(m.discipline_code ?? '(none)') ?? [],
  }));
  const columnChecks = compareColumns(latest, db);
  const pivot = compareWorkTypePivot(latest, db);

  const allChecks: IngestionCheck[] = [
    ...[...checksByDiscipline.values()].flat(),
    ...columnChecks,
  ];
  const failing =
    allChecks.filter((c) => c.status === 'fail').length +
    pivot.filter((p) => p.status === 'fail').length +
    recnoDwgFailing +
    qualityFailing;
  const total = allChecks.length + pivot.length + recnoDwgTotal + qualityTotal;

  // Records in DB disciplines with no manifest (e.g. loaded via the
  // per-discipline zones, which don't capture manifests yet).
  const manifestDisciplines = new Set(latest.map((m) => m.discipline_code));
  const unmanifested = db.filter((s) => !manifestDisciplines.has(s.discipline_code));

  const latestImportAt = latest.reduce<string | null>(
    (acc, m) => (acc === null || m.created_at > acc ? m.created_at : acc),
    null,
  );

  return (
    <div className="space-y-4">
      <FrozenBanner projectId={projectId} />
      <Card>
        <CardHeader
          eyebrow="Ingestion"
          title="Data Check"
          caption="File → parsed → loaded reconciliation for the baseline import."
          actions={
            failing === 0 ? (
              <span className="is-toast is-toast-success text-xs">
                <CheckCircle2 size={14} /> All {total} checks pass
              </span>
            ) : (
              <span className="is-toast is-toast-danger text-xs">
                <XCircle size={14} /> {failing} of {total} checks failing
              </span>
            )
          }
        />
        <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
          <table className="is-table">
            <thead>
              <tr>
                <th>Audit tab</th>
                <th>Discipline</th>
                <th style={{ textAlign: 'right' }}>File rows</th>
                <th style={{ textAlign: 'right' }}>Parsed</th>
                <th style={{ textAlign: 'right' }}>In DB</th>
                <th style={{ textAlign: 'right' }}>Milestones (file → DB)</th>
                <th style={{ textAlign: 'right' }}>Σ qty (file → DB)</th>
                <th style={{ textAlign: 'right' }}>Σ hrs (file → DB)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {disciplineChecks.map(({ manifest: m, db: s, checks }) => {
                const fails = checks.filter((c) => c.status === 'fail');
                return (
                  <tr key={m.sheet_name}>
                    <td className="font-semibold">{m.sheet_name}</td>
                    <td className="font-mono text-xs">{m.discipline_code ?? '—'}</td>
                    <td className="text-right font-mono">{fmt.int(m.sheet_row_count)}</td>
                    <td className="text-right font-mono">{fmt.int(m.parsed_row_count)}</td>
                    <td className="text-right font-mono">{fmt.int(s?.row_count ?? 0)}</td>
                    <td className="text-right font-mono">
                      {fmt.int(m.stats.milestone_entries)} → {fmt.int(s?.milestone_entries ?? 0)}
                    </td>
                    <td className="text-right font-mono">
                      {fmt.oneDp(m.stats.sums.budget_qty)} → {fmt.oneDp(s?.sums.budget_qty ?? 0)}
                    </td>
                    <td className="text-right font-mono">
                      {fmt.oneDp(m.stats.sums.budget_hrs)} → {fmt.oneDp(s?.sums.budget_hrs ?? 0)}
                    </td>
                    <td>
                      {fails.length === 0 ? (
                        <span className="text-xs text-[color:var(--color-variance-favourable)] inline-flex items-center gap-1">
                          <CheckCircle2 size={12} /> ok
                        </span>
                      ) : (
                        <span className="text-xs text-[color:var(--color-variance-unfavourable)] inline-flex items-center gap-1">
                          <XCircle size={12} /> {fails.map((f) => f.label).join('; ')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {unmanifested.length > 0 && (
          <div className="is-toast is-toast-warn text-xs mt-3">
            <AlertTriangle size={14} />
            <span>
              {unmanifested.map((s) => s.display_name).join(', ')}:{' '}
              {unmanifested.reduce((n, s) => n + s.row_count, 0)} baseline records exist in the
              database without an import manifest (loaded before manifest capture, or via a
              legacy path) — they are shown here but have no file-side expectation to check
              against. Re-loading that discipline's file captures one.
            </span>
          </div>
        )}

        <div className="mt-3">
          <SignoffStrip
            projectId={projectId}
            signoff={signoff.data ?? null}
            canVerify={canVerify}
            checksTotal={total}
            checksFailing={failing}
            latestImportAt={latestImportAt}
          />
        </div>
      </Card>

      {recnoRows.length > 0 && <RecnoDwgCard rows={recnoRows} />}

      {qc.milestone_weights.length > 0 && <MilestoneWeightsCard rows={qc.milestone_weights} />}

      {qc.disciplines.length > 0 && <BaselineQualityCard qc={qc} aggChecks={qualityAggChecks} />}

      <Card>
        <CardHeader
          eyebrow="Column coverage"
          title="Non-null counts per column"
          caption="Values present in the file payload vs values present in the database, summed across tabs. A mismatch means data was dropped or altered between parse and load."
        />
        <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
          <table className="is-table">
            <thead>
              <tr>
                <th>Column</th>
                <th style={{ textAlign: 'right' }}>In file payload</th>
                <th style={{ textAlign: 'right' }}>In database</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {columnChecks.map((c) => (
                <tr key={c.key}>
                  <td className="font-mono text-xs">{c.label}</td>
                  <td className="text-right font-mono">{fmt.int(c.expected)}</td>
                  <td className="text-right font-mono">{fmt.int(c.actual)}</td>
                  <td>
                    {c.status === 'pass' ? (
                      <CheckCircle2
                        size={14}
                        className="text-[color:var(--color-variance-favourable)]"
                      />
                    ) : (
                      <XCircle
                        size={14}
                        className="text-[color:var(--color-variance-unfavourable)]"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          eyebrow="Work types"
          title="Records per discipline × work type"
          caption="A code with file count > 0 and DB count 0 is missing from the work-types library — those records fell back to '(none)' and use the discipline default for EV."
        />
        <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
          <table className="is-table">
            <thead>
              <tr>
                <th>Discipline</th>
                <th>Work type</th>
                <th style={{ textAlign: 'right' }}>In file</th>
                <th style={{ textAlign: 'right' }}>In database</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pivot.map((p) => (
                <tr key={`${p.disciplineCode}:${p.workType}`}>
                  <td className="font-mono text-xs">{p.disciplineCode}</td>
                  <td className="font-mono text-xs">{p.workType}</td>
                  <td className="text-right font-mono">{fmt.int(p.expected)}</td>
                  <td className="text-right font-mono">{fmt.int(p.actual)}</td>
                  <td>
                    {p.status === 'pass' ? (
                      <CheckCircle2
                        size={14}
                        className="text-[color:var(--color-variance-favourable)]"
                      />
                    ) : (
                      <XCircle
                        size={14}
                        className="text-[color:var(--color-variance-unfavourable)]"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Reference" title="Intentional transforms" />
        <div className="text-xs text-[color:var(--color-text-muted)] space-y-1">
          <p className="flex gap-2">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>
              These differences between file and database are by design, not load errors:
            </span>
          </p>
          <ul className="list-disc pl-9 space-y-1">
            <li>
              Milestone percentages and percent complete are pinned to 0 — the baseline captures
              scope; progress arrives through weekly uploads after lock.
            </li>
            <li>
              ERN_QTY / EARN_WHRS (earned values) are not stored at baseline; live earned value is
              always recomputed from milestones × budget.
            </li>
            <li>
              DESCRIPTION falls back to TAG_NO, then SPOOL_FR, then “(unnamed)” — the database
              column is never null even where the file’s DESC_ is empty.
            </li>
            <li>UOM defaults to EA when the file leaves it blank.</li>
            <li>
              Placeholder strings (*C, *S, N/A, —) in SCHED_ID, TA_BANK/BAY/LEVEL and PSLIP are
              stored as empty.
            </li>
            <li>VAR2, PCT_EARNED, ROC and REMAINING_HOURS columns are not stored (computed or unmapped).</li>
            <li>
              Unknown WORK_TYPE codes are kept as “(none)” and use the discipline’s default work
              type for earned-value math.
            </li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

/**
 * Explicit "Verify Load" sign-off. The checks above are computed — a human
 * still has to own the call that the load is good, so this records who,
 * when, and the check counts at that moment (append-only server-side). A
 * sign-off older than the newest import manifest is stale: the data changed
 * after it was verified, so the strip asks for a fresh one.
 */
function SignoffStrip({
  projectId,
  signoff,
  canVerify,
  checksTotal,
  checksFailing,
  latestImportAt,
}: {
  projectId: string;
  signoff: DataCheckSignoff | null;
  canVerify: boolean;
  checksTotal: number;
  checksFailing: number;
  latestImportAt: string | null;
}) {
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('data_check_signoffs').insert({
        project_id: projectId,
        checks_total: checksTotal,
        checks_failing: checksFailing,
      });
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['data-check-signoff', projectId] });
    },
  });

  const stale = !!(signoff && latestImportAt && latestImportAt > signoff.verified_at);
  const verifierName = signoff?.app_users?.display_name ?? signoff?.app_users?.email ?? 'unknown';

  if (signoff && !stale) {
    return (
      <div className="is-toast is-toast-success text-xs">
        <ClipboardCheck size={14} />
        <span>
          Load verified by <strong>{verifierName}</strong> on {fmt.date(signoff.verified_at)}
          {signoff.checks_total > 0 &&
            ` — ${signoff.checks_total - signoff.checks_failing} of ${signoff.checks_total} checks passing`}
          .
        </span>
      </div>
    );
  }

  return (
    <div className={`is-toast ${stale ? 'is-toast-warn' : 'is-toast-info'} text-xs items-center`}>
      <ClipboardCheck size={14} />
      <span className="flex-1">
        {stale
          ? `Verified by ${verifierName} on ${fmt.date(signoff!.verified_at)}, but data was imported after that — re-verify to complete the setup step.`
          : 'Review the checks above, then sign off to complete the "Verify the load" setup step.'}
        {checksFailing > 0 && (
          <strong> {checksFailing} checks are currently failing — resolve or sign off knowingly.</strong>
        )}
      </span>
      {canVerify ? (
        <Button
          variant="primary"
          size="sm"
          disabled={verify.isPending}
          onClick={() => verify.mutate()}
        >
          {verify.isPending ? 'Saving…' : 'Mark load verified'}
        </Button>
      ) : (
        <span className="text-[color:var(--color-text-muted)]">Reviewer role required</span>
      )}
      {verify.error && (
        <span className="text-[color:var(--color-variance-unfavourable)]">
          {(verify.error as Error).message}
        </span>
      )}
    </div>
  );
}

/** DB-side profile when no manifests exist — shape only, no expectations. */
function DbOnlyProfile({ db }: { db: DisciplineIngestionStats[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)] mt-3">
      <table className="is-table">
        <thead>
          <tr>
            <th>Discipline</th>
            <th style={{ textAlign: 'right' }}>Records</th>
            <th style={{ textAlign: 'right' }}>Milestone entries</th>
            <th style={{ textAlign: 'right' }}>Σ budget qty</th>
            <th style={{ textAlign: 'right' }}>Σ budget hrs</th>
          </tr>
        </thead>
        <tbody>
          {db.map((s) => (
            <tr key={s.discipline_code}>
              <td className="font-semibold">{s.display_name}</td>
              <td className="text-right font-mono">{fmt.int(s.row_count)}</td>
              <td className="text-right font-mono">{fmt.int(s.milestone_entries)}</td>
              <td className="text-right font-mono">{fmt.oneDp(s.sums.budget_qty)}</td>
              <td className="text-right font-mono">{fmt.oneDp(s.sums.budget_hrs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Truncated list like "3, 4, 7 …" from a capped sample + a full count. */
function sampleList(sample: number[], count: number): string {
  if (sample.length === 0) return '';
  const shown = sample.join(', ');
  return count > sample.length ? `${shown} …` : shown;
}

/** Human-readable REC_NO problems for one discipline, or [] if clean. */
function recnoIssues(r: RecnoDwgCheck): string[] {
  const issues: string[] = [];
  if (r.recno_nulls > 0) issues.push(`${fmt.int(r.recno_nulls)} row(s) with no REC_NO`);
  if (r.recno_min != null && r.recno_min !== 1) issues.push(`starts at ${r.recno_min}, not 1`);
  // A value above the row count can't fit a 1..N sequence — call it out
  // directly rather than only as the gap it implies.
  if (r.recno_max != null && r.recno_max > r.total_rows)
    issues.push(`REC_NO above row count (max ${r.recno_max} > ${r.total_rows})`);
  if (r.duplicate_count > 0)
    issues.push(`duplicate: ${sampleList(r.duplicate_sample, r.duplicate_count)}`);
  if (r.missing_count > 0) issues.push(`missing: ${sampleList(r.missing_sample, r.missing_count)}`);
  return issues;
}

const passPill = (
  <span className="text-xs text-[color:var(--color-variance-favourable)] inline-flex items-center gap-1">
    <CheckCircle2 size={12} /> ok
  </span>
);

/**
 * REC_NO sequence + DWG presence, one row per audit tab (discipline).
 * REC_NO should run 1..N per tab with no gaps or duplicates; DWG must be
 * present on every numbered row. Both are read from the file values as
 * imported, so this catches source-workbook errors the reconciliation
 * (which compares counts/sums) can't see.
 */
function RecnoDwgCard({ rows }: { rows: RecnoDwgCheck[] }) {
  const failing = rows.reduce((n, r) => n + (r.recno_ok ? 0 : 1) + (r.dwg_ok ? 0 : 1), 0);
  return (
    <Card>
      <CardHeader
        eyebrow="Record integrity"
        title="REC_NO sequence & DWG presence"
        caption="Per audit tab: REC_NO should run 1…N with no gaps or duplicates, and every numbered row must have a DWG. Checked against the file values as imported."
        actions={
          failing === 0 ? (
            <span className="is-toast is-toast-success text-xs">
              <CheckCircle2 size={14} /> All {rows.length * 2} checks pass
            </span>
          ) : (
            <span className="is-toast is-toast-danger text-xs">
              <XCircle size={14} /> {failing} of {rows.length * 2} checks failing
            </span>
          )
        }
      />
      <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
        <table className="is-table">
          <thead>
            <tr>
              <th>Discipline</th>
              <th style={{ textAlign: 'right' }}>Rows</th>
              <th>REC_NO (1…N)</th>
              <th>DWG present</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const issues = recnoIssues(r);
              return (
                <tr key={r.discipline_code}>
                  <td className="font-semibold">{r.display_name}</td>
                  <td className="text-right font-mono">{fmt.int(r.total_rows)}</td>
                  <td>
                    {r.recno_ok ? (
                      passPill
                    ) : (
                      <span className="text-xs text-[color:var(--color-variance-unfavourable)] inline-flex items-center gap-1">
                        <XCircle size={12} className="shrink-0" /> {issues.join('; ')}
                      </span>
                    )}
                  </td>
                  <td>
                    {r.dwg_ok ? (
                      passPill
                    ) : (
                      <span className="text-xs text-[color:var(--color-variance-unfavourable)] inline-flex items-center gap-1">
                        <XCircle size={12} className="shrink-0" />{' '}
                        {fmt.int(r.dwg_null_count)} numbered row(s) missing DWG
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Milestone weighting — each work type used by the baseline should have
 * milestone weights summing to ~100% (±0.5pp). A wrong sum mis-earns every
 * record that uses that type.
 */
function MilestoneWeightsCard({ rows }: { rows: BaselineQualityChecks['milestone_weights'] }) {
  const failing = rows.filter((r) => !r.ok).length;
  return (
    <Card>
      <CardHeader
        eyebrow="Earned-value integrity"
        title="Milestone weighting"
        caption="Each work type used by the baseline should have milestone weights summing to 100% (±0.5). A wrong sum mis-earns every record that uses it."
        actions={
          failing === 0 ? (
            <span className="is-toast is-toast-success text-xs">
              <CheckCircle2 size={14} /> All {rows.length} pass
            </span>
          ) : (
            <span className="is-toast is-toast-danger text-xs">
              <XCircle size={14} /> {failing} of {rows.length} failing
            </span>
          )
        }
      />
      <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
        <table className="is-table">
          <thead>
            <tr>
              <th>Work type</th>
              <th style={{ textAlign: 'right' }}>Milestones</th>
              <th style={{ textAlign: 'right' }}>Weight sum</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.work_type_code}>
                <td className="font-mono text-xs">{r.work_type_code}</td>
                <td className="text-right font-mono">{fmt.int(r.milestone_count)}</td>
                <td className="text-right font-mono">{fmt.oneDp(r.weight_sum * 100)}%</td>
                <td>
                  {r.ok ? (
                    passPill
                  ) : (
                    <span className="text-xs text-[color:var(--color-variance-unfavourable)] inline-flex items-center gap-1">
                      <XCircle size={12} /> should total 100%
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Baseline quality — eight project-level gates (summary strip) plus a
 * per-discipline breakdown of the offending row counts.
 */
function BaselineQualityCard({
  qc,
  aggChecks,
}: {
  qc: BaselineQualityChecks;
  aggChecks: QualityAgg[];
}) {
  const failing = aggChecks.filter((c) => c.count > 0).length;
  return (
    <Card>
      <CardHeader
        eyebrow="Baseline quality"
        title="Records that would distort earned value"
        caption="Data that loaded cleanly but skews EV or cost rollup. Counts are rows affected; resolve before lock, or sign off knowingly."
        actions={
          failing === 0 ? (
            <span className="is-toast is-toast-success text-xs">
              <CheckCircle2 size={14} /> All {aggChecks.length} pass
            </span>
          ) : (
            <span className="is-toast is-toast-danger text-xs">
              <XCircle size={14} /> {failing} of {aggChecks.length} failing
            </span>
          )
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
        {aggChecks.map((c) => (
          <div
            key={c.key}
            className="flex items-start gap-2 p-2 rounded-md border border-[color:var(--color-line)]"
            title={c.hint}
          >
            {c.count === 0 ? (
              <CheckCircle2
                size={14}
                className="shrink-0 mt-0.5 text-[color:var(--color-variance-favourable)]"
              />
            ) : (
              <XCircle
                size={14}
                className="shrink-0 mt-0.5 text-[color:var(--color-variance-unfavourable)]"
              />
            )}
            <div className="text-xs">
              <div className="font-semibold">{c.label}</div>
              <div className="text-[color:var(--color-text-muted)]">
                {c.count === 0 ? 'ok' : `${fmt.int(c.count)} row(s)`}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
        <table className="is-table">
          <thead>
            <tr>
              <th>Discipline</th>
              <th style={{ textAlign: 'right' }}>Rows</th>
              <th style={{ textAlign: 'right' }}>FLD_WHRS = 0</th>
              <th style={{ textAlign: 'right' }}>FLD_QTY = 0</th>
              <th style={{ textAlign: 'right' }}>No milestones</th>
              <th style={{ textAlign: 'right' }}>Blank WT</th>
              <th style={{ textAlign: 'right' }}>Unmapped WT</th>
              <th style={{ textAlign: 'right' }}>COA out of scope</th>
              <th style={{ textAlign: 'right' }}>Unit outliers</th>
            </tr>
          </thead>
          <tbody>
            {qc.disciplines.map((d) => (
              <tr key={d.discipline_code}>
                <td className="font-semibold">{d.display_name}</td>
                <td className="text-right font-mono">{fmt.int(d.total_rows)}</td>
                <QCell n={d.fld_whrs_missing_count} />
                <QCell n={d.fld_qty_missing_count} />
                <QCell n={d.no_milestone_count} />
                <QCell n={d.work_type_blank_count} />
                <QCell n={d.work_type_unmapped_count} />
                <QCell n={d.coa_out_of_scope_count} />
                <QCell n={d.unit_outlier_count} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeChipList
        title="COA codes used but not in the project scope"
        help="Add these on Project Setup → COA scope, or correct the codes in the source data. Otherwise their hours won’t roll up in cost."
        codes={qc.coa_out_of_scope_codes}
      />

      <CodeChipList
        title="WORK_TYPE codes not in the work-types library"
        help="Add these to the work-types library (with milestone weights), or correct the codes in the source data. Until then these records use the discipline default for earned value."
        codes={qc.work_type_unmapped_codes}
      />

      {qc.unassigned_count > 0 && (
        <div className="is-toast is-toast-warn text-xs mt-3">
          <AlertTriangle size={14} />
          <span>
            {fmt.int(qc.unassigned_count)} baseline record(s) are not assigned to any discipline —
            they won’t roll into discipline reports.
          </span>
        </div>
      )}
    </Card>
  );
}

/** A titled, wrap-flowing list of code chips with per-code record counts. */
function CodeChipList({
  title,
  help,
  codes,
}: {
  title: string;
  help: string;
  codes: { code: string; count: number }[];
}) {
  if (codes.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-[color:var(--color-line)] p-3">
      <div className="text-xs font-semibold mb-1">{title}</div>
      <div className="text-xs text-[color:var(--color-text-muted)] mb-2">{help}</div>
      <div className="flex flex-wrap gap-1.5">
        {codes.map((c) => (
          <span
            key={c.code}
            className="inline-flex items-center gap-1 rounded border border-[color:var(--color-line)] bg-[color:var(--color-raised)] px-1.5 py-0.5 font-mono text-xs"
            title={`${fmt.int(c.count)} record(s)`}
          >
            {c.code}
            <span className="text-[color:var(--color-text-muted)]">×{fmt.int(c.count)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Right-aligned count cell — muted 0, red when non-zero. */
function QCell({ n }: { n: number }) {
  return (
    <td
      className={`text-right font-mono ${
        n > 0
          ? 'text-[color:var(--color-variance-unfavourable)] font-semibold'
          : 'text-[color:var(--color-text-muted)]'
      }`}
    >
      {fmt.int(n)}
    </td>
  );
}
