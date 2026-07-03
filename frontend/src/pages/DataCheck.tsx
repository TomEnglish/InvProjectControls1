import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import { Card, CardHeader } from '@/components/ui/Card';
import { NoProjectSelected } from '@/components/ui/NoProjectSelected';
import { fmt } from '@/lib/format';
import { useImportManifests, useBaselineIngestionStats } from '@/lib/queries';
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

  if (!projectId) {
    return <NoProjectSelected message="Pick a project in the top bar to run its data check." />;
  }
  if (manifests.isLoading || dbStats.isLoading) {
    return (
      <Card>
        <div className="h-6 bg-[color:var(--color-canvas)] rounded w-48 animate-pulse" />
      </Card>
    );
  }
  if (manifests.error || dbStats.error) {
    return (
      <Card>
        <div className="is-toast is-toast-danger">
          {((manifests.error ?? dbStats.error) as Error).message}
        </div>
      </Card>
    );
  }

  const latest = latestManifestsBySheet(manifests.data ?? []);
  const db = dbStats.data ?? [];

  if (latest.length === 0) {
    return (
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
      </Card>
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
  const failing = allChecks.filter((c) => c.status === 'fail').length + pivot.filter((p) => p.status === 'fail').length;
  const total = allChecks.length + pivot.length;

  // Records in DB disciplines with no manifest (e.g. loaded via the
  // per-discipline zones, which don't capture manifests yet).
  const manifestDisciplines = new Set(latest.map((m) => m.discipline_code));
  const unmanifested = db.filter((s) => !manifestDisciplines.has(s.discipline_code));

  return (
    <div className="space-y-4">
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
      </Card>

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
