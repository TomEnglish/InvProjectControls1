import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload as UploadIcon,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FileDropzone } from '@/components/ui/FileDropzone';
import { parseQmrFile, type QmrAuditSheet } from '@/lib/progressParser';
import { buildManifestStats } from '@/lib/ingestionStats';
import { useWorkTypes, useBaselineByDiscipline, useCurrentUser, hasRole } from '@/lib/queries';

/**
 * Unified QMR workbook baseline load.
 *
 * The client's project-controls team hands over one "QMR Report … Unified"
 * workbook per project: seven per-discipline audit tabs plus reference tabs
 * (QMR Summary, Milestone Reference, Column Map, …). This card lets a pm+
 * load the whole project baseline from that single file instead of slicing
 * it into per-discipline files for the zones below.
 *
 * Each audit tab names its discipline in the DISCIPLINE column, so we call
 * import-baseline-records once per tab with `declaredDiscipline` — the same
 * A9 parameter the per-discipline zones use — rather than trusting the
 * COA-prime guess. Tabs import sequentially and the per-tab status list
 * shows how far the run got. The server does NOT dedupe re-uploads (same
 * as the zones below), and a tab's records/milestones writes are separate
 * statements — so on failure the copy steers the user to verify per-zone
 * record counts before retrying rather than promising a clean rollback.
 */

// On a non-2xx response, supabase.functions.invoke returns a FunctionsHttpError
// whose .message is the generic "Edge Function returned a non-2xx status code"
// and leaves data null — the server's real { error } body lives on
// error.context (the Response). Pull it out so per-tab chips show the actual
// reason (e.g. "project status is active — baseline upload only in draft").
async function invokeErrorMessage(error: unknown, data: unknown): Promise<string | undefined> {
  if (error && typeof error === 'object' && 'context' in error) {
    const ctx = (error as { context: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const body = (await ctx.clone().json()) as { error?: string } | null;
        if (body?.error) return body.error;
      } catch {
        // fall through to the generic message
      }
    }
  }
  return (error as Error | null)?.message ?? (data as { error?: string } | null)?.error;
}

type SheetStatus =
  | { state: 'pending' }
  | { state: 'loading' }
  | { state: 'done'; inserted: number }
  | { state: 'error'; message: string }
  | { state: 'skipped'; reason: string };

type Props = { projectId: string };

export function UnifiedQmrBaselineCard({ projectId }: Props) {
  const qc = useQueryClient();
  const workTypes = useWorkTypes();
  const baseline = useBaselineByDiscipline(projectId);
  const { data: me } = useCurrentUser();
  // Clearing (and loading) requires pm+ server-side; don't render a
  // dead-end button for pc_reviewer, who can see this card but not act.
  const canClear = hasRole(me?.role, 'pm');
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<QmrAuditSheet[]>([]);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Map<string, SheetStatus>>(new Map());
  const [clearFirst, setClearFirst] = useState(true);

  const existingCount =
    [...(baseline.data?.byDiscipline.values() ?? [])].reduce((n, d) => n + d.count, 0) +
    (baseline.data?.unassignedCount ?? 0);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['baseline-by-discipline', projectId] });
    qc.invalidateQueries({ queryKey: ['disciplines', projectId] });
    qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
    qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
    qc.invalidateQueries({ queryKey: ['discipline-metrics', projectId] });
    qc.invalidateQueries({ queryKey: ['import-manifests', projectId] });
    qc.invalidateQueries({ queryKey: ['baseline-ingestion-stats', projectId] });
  };

  const clearBaseline = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('project_clear_baseline', {
        p_project_id: projectId,
      });
      if (error) throw error;
      return data as {
        records_deleted: number;
        manifests_deleted: number;
        iwps_deleted: number;
      };
    },
    onSuccess: () => {
      // A successful clear unlatches the load flow: the previous attempt's
      // success/error state (which disables the Load button to prevent
      // accidental duplicate submits) no longer describes reality, and the
      // per-tab chips should read "ready" again for the reload.
      submit.reset();
      setStatuses(new Map());
    },
    onSettled: invalidateAll,
  });

  const knownWorkTypes = new Set(
    (workTypes.data ?? []).map((w) => w.work_type_code.toLowerCase()),
  );
  const unknownWorkTypes = [
    ...new Set(
      sheets
        .flatMap((s) => s.rows)
        .map((r) => r.work_type)
        .filter((wt): wt is string => !!wt && !knownWorkTypes.has(wt.toLowerCase())),
    ),
  ];
  const ignoredHeaders = [...new Set(sheets.flatMap((s) => s.unmappedHeaders))];

  const importable = sheets.filter((s) => s.disciplineCode && s.rows.length > 0);
  const totalRows = importable.reduce((sum, s) => sum + s.rows.length, 0);

  const setStatus = (sheetName: string, status: SheetStatus) => {
    setStatuses((prev) => new Map(prev).set(sheetName, status));
  };

  const submit = useMutation({
    mutationFn: async () => {
      // Clear-before-load: wipe the existing baseline in one RPC so the
      // reload starts from zero instead of appending duplicates.
      if (existingCount > 0 && clearFirst) {
        const { error: clearErr } = await supabase.rpc('project_clear_baseline', {
          p_project_id: projectId,
        });
        if (clearErr) throw new Error(`clear baseline failed: ${clearErr.message}`);
      }
      let failed = 0;
      for (const sheet of sheets) {
        if (!sheet.disciplineCode || sheet.rows.length === 0) {
          setStatus(sheet.sheetName, {
            state: 'skipped',
            reason: sheet.disciplineCode
              ? 'no records'
              : `unrecognized discipline "${sheet.disciplineLabel ?? '—'}"`,
          });
          continue;
        }
        setStatus(sheet.sheetName, { state: 'loading' });
        const { data, error } = await supabase.functions.invoke('import-baseline-records', {
          body: {
            projectId,
            sourceFilename: file ? `${file.name} — ${sheet.sheetName}` : sheet.sheetName,
            declaredDiscipline: sheet.disciplineCode,
            items: sheet.rows,
          },
        });
        const errMessage = await invokeErrorMessage(error, data);
        if (errMessage) {
          failed++;
          setStatus(sheet.sheetName, { state: 'error', message: errMessage });
        } else {
          setStatus(sheet.sheetName, {
            state: 'done',
            inserted: (data as { inserted?: number }).inserted ?? sheet.rows.length,
          });
          // Persist the ingestion manifest — the Data Check page diffs it
          // against what actually landed in the DB. Non-fatal: the records
          // are already imported, so a manifest failure only degrades the
          // check page, and it says so there (missing manifest per tab).
          const { error: manifestErr } = await supabase.from('import_manifests').insert({
            project_id: projectId,
            source_filename: file?.name ?? null,
            sheet_name: sheet.sheetName,
            discipline_code: sheet.disciplineCode,
            sheet_row_count: sheet.sheetRowCount,
            parsed_row_count: sheet.rows.length,
            stats: buildManifestStats(sheet.rows),
          });
          if (manifestErr) {
            console.warn(`manifest capture failed for ${sheet.sheetName}:`, manifestErr.message);
          }
        }
      }
      if (failed > 0) {
        throw new Error(
          `${failed} tab${failed === 1 ? '' : 's'} failed to load — see the per-tab status. ` +
            'Successfully loaded tabs are already saved. After fixing the issue, re-drop ' +
            'the workbook with "Clear existing baseline first" checked to reload cleanly.',
        );
      }
    },
    onSettled: invalidateAll,
  });

  const onFile = async (f: File | null) => {
    // Ignore new drops while an import is writing — the in-flight loop holds
    // the old sheets array, and resetting state under it would desync the UI
    // from what's actually being sent to the server.
    if (submit.isPending) return;
    setParseErr(null);
    setSheets([]);
    setStatuses(new Map());
    submit.reset();
    setFile(f);
    if (!f) return;
    try {
      const result = await parseQmrFile(f);
      if (result.auditSheets.length === 0) {
        setParseErr(
          'No audit tabs found — this doesn’t look like a unified QMR workbook. ' +
            'Expected tabs like "Civ Audit" with a DISCIPLINE / REC_NO header row. ' +
            'For single-discipline files use the per-discipline zones below.',
        );
        return;
      }
      setSheets(result.auditSheets);
    } catch (err) {
      setParseErr((err as Error).message);
    }
  };

  const finished = submit.isSuccess || submit.isError;

  return (
    <Card>
      <CardHeader
        eyebrow="Initial baseline"
        title="Load baseline from QMR workbook"
        caption={
          'Drop the unified QMR report (one workbook, all audit tabs) to load ' +
          'the full project baseline in one step. Records land under the ' +
          'discipline named on each tab. Milestone labels are loaded with ' +
          'progress pinned to 0 — the baseline captures scope; progress comes ' +
          'in through weekly uploads after the baseline is locked.'
        }
        actions={
          existingCount > 0 && canClear ? (
            <Button
              variant="outline"
              size="sm"
              disabled={clearBaseline.isPending || submit.isPending}
              onClick={() => {
                if (
                  confirm(
                    `Delete all ${existingCount} baseline records for this project ` +
                      '(plus their milestones, import manifests, and orphaned IWPs)? ' +
                      'Disciplines and their settings are kept.',
                  )
                ) {
                  clearBaseline.mutate();
                }
              }}
            >
              {clearBaseline.isPending ? 'Clearing…' : `Clear baseline (${existingCount})`}
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-3">
        <FileDropzone
          accept=".xlsx,.xls"
          onFile={onFile}
          selected={file}
          label="Drag the QMR workbook here or click to browse"
        />

        {parseErr && <div className="is-toast is-toast-danger text-xs">{parseErr}</div>}

        {sheets.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-[color:var(--color-line)]">
            <table className="is-table">
              <thead>
                <tr>
                  <th>Audit tab</th>
                  <th>Discipline</th>
                  <th style={{ textAlign: 'right' }}>Records</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((s) => (
                  <tr key={s.sheetName}>
                    <td className="font-semibold">{s.sheetName}</td>
                    <td>
                      {s.disciplineLabel ?? '—'}{' '}
                      {s.disciplineCode ? (
                        <span className="text-[10px] font-mono text-[color:var(--color-text-muted)]">
                          {s.disciplineCode}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[color:var(--color-warn)]">
                          unrecognized
                        </span>
                      )}
                    </td>
                    <td className="text-right font-mono">{s.rows.length}</td>
                    <td>
                      <SheetStatusChip status={statuses.get(s.sheetName)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {unknownWorkTypes.length > 0 && (
          <div className="is-toast is-toast-warn text-xs">
            <AlertTriangle size={14} />
            <span>
              {unknownWorkTypes.length} WORK_TYPE code
              {unknownWorkTypes.length === 1 ? '' : 's'} not in the work-types library (
              {unknownWorkTypes.slice(0, 5).join(', ')}
              {unknownWorkTypes.length > 5 && ', …'}) — affected records fall back to their
              discipline&apos;s default work type for earned-value math. Add them on the Work
              Types page first if that&apos;s not intended.
            </span>
          </div>
        )}

        {ignoredHeaders.length > 0 && sheets.length > 0 && (
          <div className="text-xs text-[color:var(--color-text-muted)]">
            Ignored columns: {ignoredHeaders.join(', ')}
          </div>
        )}

        {clearBaseline.error && (
          <div className="is-toast is-toast-danger text-xs">
            {(clearBaseline.error as Error).message}
          </div>
        )}
        {clearBaseline.isSuccess && !submit.isSuccess && (
          <div className="is-toast is-toast-success text-xs">
            Baseline cleared — {clearBaseline.data?.records_deleted ?? 0} records,{' '}
            {clearBaseline.data?.manifests_deleted ?? 0} manifests,{' '}
            {clearBaseline.data?.iwps_deleted ?? 0} IWPs deleted.
          </div>
        )}
        {submit.error && (
          <div className="is-toast is-toast-danger text-xs">
            {(submit.error as Error).message}
          </div>
        )}
        {submit.isSuccess && (
          <div className="is-toast is-toast-success text-xs">
            Baseline loaded — {totalRows} records across {importable.length} disciplines. Verify
            the load on the Data Check page.
          </div>
        )}

        <div className="flex justify-end items-center gap-4">
          {existingCount > 0 && canClear && sheets.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-[color:var(--color-text-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={clearFirst}
                onChange={(e) => setClearFirst(e.target.checked)}
              />
              Clear existing baseline first ({existingCount} records)
            </label>
          )}
          <Button
            variant="primary"
            disabled={submit.isPending || totalRows === 0 || finished}
            onClick={() => {
              if (existingCount > 0 && clearFirst) {
                if (
                  !confirm(
                    `This will delete the ${existingCount} existing baseline records ` +
                      `and reload ${totalRows} from the workbook. Continue?`,
                  )
                ) {
                  return;
                }
              }
              submit.mutate();
            }}
          >
            <UploadIcon size={12} />
            {submit.isPending
              ? 'Loading…'
              : `Load ${totalRows > 0 ? `${totalRows} records from ${importable.length} tabs` : 'baseline'}`}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SheetStatusChip({ status }: { status: SheetStatus | undefined }) {
  if (!status || status.state === 'pending') {
    return <span className="text-xs text-[color:var(--color-text-muted)]">ready</span>;
  }
  if (status.state === 'loading') {
    return (
      <span className="text-xs text-[color:var(--color-text-muted)] inline-flex items-center gap-1">
        <Loader2 size={12} className="animate-spin" /> loading…
      </span>
    );
  }
  if (status.state === 'done') {
    return (
      <span className="text-xs text-[color:var(--color-variance-favourable)] inline-flex items-center gap-1">
        <CheckCircle2 size={12} /> {status.inserted} loaded
      </span>
    );
  }
  if (status.state === 'skipped') {
    return (
      <span className="text-xs text-[color:var(--color-warn)] inline-flex items-center gap-1">
        <AlertTriangle size={12} /> skipped — {status.reason}
      </span>
    );
  }
  return (
    <span
      className="text-xs text-[color:var(--color-variance-unfavourable)] inline-flex items-center gap-1"
      title={status.message}
    >
      <XCircle size={12} /> {status.message}
    </span>
  );
}
