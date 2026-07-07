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
  useDataCheckSignoff,
  useCurrentUser,
  useProjectClosed,
  hasRole,
  type DataCheckSignoff,
  type RecnoDwgCheck,
} from '@/lib/queries';
import { FrozenBanner } from '@/components/ui/FrozenBanner';
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
  const signoff = useDataCheckSignoff(projectId);
  const { data: me } = useCurrentUser();
  const frozen = useProjectClosed(projectId);
  const canVerify = hasRole(me?.role, 'pc_reviewer') && !frozen;

  if (!projectId) {
    return <NoProjectSelected message="Pick a project in the top bar to run its data check." />;
  }
  if (manifests.isLoading || dbStats.isLoading || recnoDwg.isLoading) {
    return (
      <Card>
        <div className="h-6 bg-[color:var(--color-canvas)] rounded w-48 animate-pulse" />
      </Card>
    );
  }
  if (manifests.error || dbStats.error || recnoDwg.error) {
    return (
      <Card>
        <div className="is-toast is-toast-danger">
          {((manifests.error ?? dbStats.error ?? recnoDwg.error) as Error).message}
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
              'loaded from the unified QMR workbook on Project Setup — load one and ' +
              'this page fills in with a file-vs-database reconciliation.'
            }
          />
          {db.length > 0 && <DbOnlyProfile db={db} />}
          {db.length > 0 && (
            <div className="mt-3">
              <SignoffStrip
                projectId={projectId}
                signoff={signoff.data ?? null}
                canVerify={canVerify}
                checksTotal={recnoDwgTotal}
                checksFailing={recnoDwgFailing}
                latestImportAt={null}
              />
            </div>
          )}
        </Card>
        {recnoRows.length > 0 && <RecnoDwgCard rows={recnoRows} />}
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
    recnoDwgFailing;
  const total = allChecks.length + pivot.length + recnoDwgTotal;

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
              database without an import manifest (loaded outside the QMR workbook flow) — they
              are shown here but have no file-side expectation to check against.
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
