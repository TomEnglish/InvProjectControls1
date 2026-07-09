import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload as UploadIcon,
  Download,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FileDropzone } from '@/components/ui/FileDropzone';
import { parseProgressFile, parseQmrFile, type ParsedRow } from '@/lib/progressParser';
import { buildManifestStats } from '@/lib/ingestionStats';
import { useBaselineByDiscipline } from '@/lib/queries';

/**
 * A9 — Per-discipline baseline upload zones.
 *
 * Sandra's UAT (app_review_todo.md item 9):
 *   "Today everything funnels through one generic upload. Sandra wants
 *    distinct upload zones on Project Setup, one per audit type."
 *
 * Each zone passes its discipline_code to import-baseline-records via the
 * `declaredDiscipline` param so every record in the file lands under that
 * discipline. Foundations is intentionally NOT a zone: its codes share
 * Civil's '04' prime and are treated as Civil, so a "Foundations" audit
 * loads through the Civil zone (and QMR "Foundations" rows map to CIVIL).
 *
 * Role gate: card is rendered from ProjectSetup behind `canEdit && !locked`
 * which already gates on pm+. The edge fn re-asserts ALLOWED_ROLES =
 * super_admin/admin/pm so clerks calling the fn directly are rejected.
 */
type DisciplineDef = { code: string; label: string };

// Order roughly matches the work-sequence on a typical industrial job
// (sitework first, instrumentation last) so the layout reads naturally
// top-to-bottom. Foundations folds into Civil (shared '04' prime), so it
// has no zone of its own.
const DISCIPLINES: DisciplineDef[] = [
  { code: 'SITE', label: 'Site Work' },
  { code: 'CIVIL', label: 'Civil' },
  { code: 'STEEL', label: 'Steel' },
  { code: 'PIPE', label: 'Pipe' },
  { code: 'MECH', label: 'Mechanical' },
  { code: 'ELEC', label: 'Electrical' },
  { code: 'INST', label: 'Instrumentation' },
];

type Props = { projectId: string };

export function PerDisciplineBaselineCard({ projectId }: Props) {
  const qc = useQueryClient();
  const status = useBaselineByDiscipline(projectId);
  const [confirmClear, setConfirmClear] = useState(false);
  // Bumped on a project-wide clear to remount the zones, dropping each one's
  // local state (staged file, "Loaded X" toast) that no longer applies.
  const [resetNonce, setResetNonce] = useState(0);

  const totalLoaded =
    [...(status.data?.byDiscipline.values() ?? [])].reduce((n, d) => n + d.count, 0) +
    (status.data?.unassignedCount ?? 0);

  const clearBaseline = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('project_clear_baseline', { p_project_id: projectId });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirmClear(false);
      setResetNonce((n) => n + 1);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['baseline-by-discipline', projectId] });
      qc.invalidateQueries({ queryKey: ['disciplines', projectId] });
      qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
      qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['discipline-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['import-manifests', projectId] });
      qc.invalidateQueries({ queryKey: ['baseline-ingestion-stats', projectId] });
      qc.invalidateQueries({ queryKey: ['baseline-recno-dwg-check', projectId] });
      qc.invalidateQueries({ queryKey: ['baseline-quality-checks', projectId] });
    },
  });

  return (
    <Card>
      <CardHeader
        eyebrow="Initial baseline"
        title="Baseline by discipline"
        caption={
          'Load the baseline one discipline at a time — drop each audit file into its ' +
          'zone, and every record in that file is assigned to the zone\'s discipline. ' +
          'Verify the load on the Data Check page, then lock. Weekly progress comes in ' +
          'through the Upload page after lock.'
        }
        actions={
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <>
                <span className="text-xs text-[color:var(--color-text-muted)]">
                  Delete all {totalLoaded} baseline records?
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmClear(false)}
                  disabled={clearBaseline.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => clearBaseline.mutate()}
                  disabled={clearBaseline.isPending}
                >
                  {clearBaseline.isPending ? 'Clearing…' : 'Confirm clear'}
                </Button>
              </>
            ) : (
              <>
                {totalLoaded > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)}>
                    <Trash2 size={14} /> Clear baseline
                  </Button>
                )}
                <a
                  href="/progress-template.csv"
                  download="progress-template.csv"
                  className="is-btn is-btn-outline is-btn-sm"
                >
                  <Download size={14} /> Template
                </a>
              </>
            )}
          </div>
        }
      />
      {clearBaseline.error && (
        <div className="is-toast is-toast-danger mb-4">{(clearBaseline.error as Error).message}</div>
      )}

      {status.data && status.data.unassignedCount > 0 && (
        <div className="is-toast is-toast-warn mb-4">
          <AlertTriangle size={16} />
          <span>
            {status.data.unassignedCount} baseline record
            {status.data.unassignedCount === 1 ? '' : 's'} have no discipline
            assigned — these came in via the legacy unified-upload path. They
            still count toward EV but won't appear in any zone status below.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DISCIPLINES.map((d) => {
          const entry = status.data?.byDiscipline.get(d.code) ?? null;
          return (
            <DisciplineSlot
              key={`${d.code}-${resetNonce}`}
              projectId={projectId}
              disciplineCode={d.code}
              label={d.label}
              loadedCount={entry?.count ?? 0}
              loadedAt={entry?.lastAt ?? null}
            />
          );
        })}
      </div>
    </Card>
  );
}

type SlotProps = {
  projectId: string;
  disciplineCode: string;
  label: string;
  loadedCount: number;
  loadedAt: string | null;
};

function DisciplineSlot({
  projectId,
  disciplineCode,
  label,
  loadedCount,
  loadedAt,
}: SlotProps) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [sheetRowCount, setSheetRowCount] = useState(0);
  const [manifestNote, setManifestNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const invalidateChecks = () => {
    qc.invalidateQueries({ queryKey: ['baseline-by-discipline', projectId] });
    qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
    qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
    qc.invalidateQueries({ queryKey: ['discipline-metrics', projectId] });
    qc.invalidateQueries({ queryKey: ['import-manifests', projectId] });
    qc.invalidateQueries({ queryKey: ['baseline-ingestion-stats', projectId] });
    qc.invalidateQueries({ queryKey: ['baseline-recno-dwg-check', projectId] });
    qc.invalidateQueries({ queryKey: ['baseline-quality-checks', projectId] });
  };

  const clearDiscipline = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('project_clear_discipline_baseline', {
        p_project_id: projectId,
        p_discipline_code: disciplineCode,
      });
      if (error) throw error;
    },
    onSuccess: () => setConfirmClear(false),
    onSettled: invalidateChecks,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('import-baseline-records', {
        body: {
          projectId,
          sourceFilename: file?.name ?? undefined,
          declaredDiscipline: disciplineCode,
          items: parsed,
        },
      });
      if (error) throw error;

      // Capture the ingestion manifest so the Data Check page has a file-side
      // expectation to reconcile against. Key it by "discipline — filename":
      // the reconciliation SUMS all manifests for a discipline, so a discipline
      // fed by two files (e.g. a Civil and a Foundations audit, both loaded in
      // the Civil zone) keeps both expectations, while re-uploading the SAME
      // file replaces its own manifest (latest wins) — matching the old
      // per-tab behaviour. Non-fatal: records are already imported, so a
      // manifest miss only degrades the check page.
      const { error: manifestErr } = await supabase.from('import_manifests').insert({
        project_id: projectId,
        source_filename: file?.name ?? null,
        sheet_name: file ? `${label} — ${file.name}` : label,
        discipline_code: disciplineCode,
        sheet_row_count: sheetRowCount || parsed.length,
        parsed_row_count: parsed.length,
        stats: buildManifestStats(parsed),
      });
      setManifestNote(manifestErr ? manifestErr.message : null);

      return (data ?? {}) as { inserted?: number; error?: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['disciplines', projectId] });
      invalidateChecks();
      setFile(null);
      setParsed([]);
      setUnmapped([]);
      setWarning(null);
      setSheetRowCount(0);
    },
  });

  const onFile = async (f: File | null) => {
    setParseErr(null);
    setParsed([]);
    setUnmapped([]);
    setWarning(null);
    setSheetRowCount(0);
    setManifestNote(null);
    submit.reset();
    setFile(f);
    if (!f) return;
    try {
      // A zone declares ONE discipline for every record it imports. A QMR audit
      // file carries a per-row DISCIPLINE column; a single-discipline audit
      // (e.g. a "Site Work" export) belongs here — use the QMR-parsed rows
      // (correct header offset, "ALL" metadata dropped). A file spanning MORE
      // THAN ONE discipline can't go in a single zone; the baseline is loaded
      // one discipline at a time, so it must be split first.
      const qmr = await parseQmrFile(f);
      if (qmr.auditSheets.length > 0) {
        const rows = qmr.auditSheets.flatMap((s) => s.rows);
        const labels = [
          ...new Set(
            rows.map((r) => (r.discipline_label ?? '').trim()).filter((d) => d !== ''),
          ),
        ];

        if (labels.length > 1) {
          setParseErr(
            `This file spans ${labels.length} disciplines (${labels.join(', ')}), ` +
              `${rows.length} records. The baseline is loaded one discipline at a time — split ` +
              `the file by discipline and drop each part in its own zone. (This ${label} zone ` +
              `would assign all ${rows.length} records to ${label}.)`,
          );
          return;
        }

        setParsed(rows);
        setSheetRowCount(qmr.auditSheets.reduce((n, s) => n + s.sheetRowCount, 0));
        setUnmapped([...new Set(qmr.auditSheets.flatMap((s) => s.unmappedHeaders))]);

        // Soft heads-up if the file's own discipline differs from this zone —
        // the load still assigns every record to the zone's discipline.
        const fileCode = qmr.auditSheets.map((s) => s.disciplineCode).find(Boolean) ?? null;
        if (fileCode && fileCode !== disciplineCode) {
          setWarning(
            `This file’s DISCIPLINE column says “${labels[0]}” (${fileCode}), but you’re loading ` +
              `it into the ${label} zone — all ${rows.length} records will be assigned to ${label}. ` +
              `Use the ${labels[0]} zone instead if that isn’t intended.`,
          );
        }
        return;
      }
      const result = await parseProgressFile(f);
      setParsed(result.rows);
      setSheetRowCount(result.rows.length);
      setUnmapped(result.unmappedHeaders);
    } catch (err) {
      setParseErr((err as Error).message);
    }
  };

  const loaded = loadedCount > 0;
  const lastDate = loadedAt ? new Date(loadedAt).toLocaleDateString() : null;

  return (
    <div className="rounded-md border border-[color:var(--color-line)] p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {loaded ? (
            <CheckCircle2
              size={16}
              className="text-[color:var(--color-variance-favourable)]"
            />
          ) : (
            <Circle size={16} className="text-[color:var(--color-text-subtle)]" />
          )}
          <span className="font-semibold text-sm">{label}</span>
          <span className="text-[10px] font-mono text-[color:var(--color-text-muted)]">
            {disciplineCode}
          </span>
        </div>
        {loaded && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[color:var(--color-text-muted)]">
              {loadedCount} records · {lastDate}
            </span>
            {confirmClear ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-[color:var(--color-text-muted)]">Clear {label}?</span>
                <button
                  type="button"
                  className="text-[color:var(--color-text-muted)] hover:underline"
                  onClick={() => setConfirmClear(false)}
                  disabled={clearDiscipline.isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="font-semibold text-[color:var(--color-danger)] hover:underline"
                  onClick={() => {
                    // Drop the previous load's "Loaded X records" toast (and
                    // any parse/manifest state) — it no longer describes this
                    // zone once the records are being cleared.
                    submit.reset();
                    setManifestNote(null);
                    clearDiscipline.mutate();
                  }}
                  disabled={clearDiscipline.isPending}
                >
                  {clearDiscipline.isPending ? 'Clearing…' : 'Confirm'}
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Clear ${label} baseline`}
                title={`Clear ${label} baseline records`}
                className="text-[color:var(--color-text-subtle)] hover:text-[color:var(--color-danger)] transition-colors"
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {clearDiscipline.error && (
        <div className="is-toast is-toast-danger text-xs">
          {(clearDiscipline.error as Error).message}
        </div>
      )}

      <FileDropzone
        accept=".csv,.xlsx,.xls"
        onFile={onFile}
        selected={file}
        hint={
          loaded
            ? 'Re-uploading appends a fresh batch — duplicates are not deduped.'
            : undefined
        }
      />

      {parseErr && <div className="is-toast is-toast-danger text-xs">{parseErr}</div>}

      {warning && <div className="is-toast is-toast-warn text-xs">{warning}</div>}

      {parsed.length > 0 && (
        <div className="text-xs text-[color:var(--color-text-muted)] flex justify-between items-center">
          <span>
            Parsed <strong>{parsed.length}</strong> rows
            {unmapped.length > 0 && (
              <span className="text-[color:var(--color-warn)] ml-2">
                · Ignored: {unmapped.slice(0, 3).join(', ')}
                {unmapped.length > 3 && '…'}
              </span>
            )}
          </span>
        </div>
      )}

      {submit.error && (
        <div className="is-toast is-toast-danger text-xs">
          {(submit.error as Error).message}
        </div>
      )}
      {submit.isSuccess && submit.data && (
        <div className="is-toast is-toast-success text-xs">
          Loaded {submit.data.inserted} records into {label}.
        </div>
      )}
      {submit.isSuccess && manifestNote && (
        <div className="is-toast is-toast-warn text-xs">
          Records loaded, but the Data Check reference wasn’t captured ({manifestNote}) — the
          file-vs-database reconciliation won’t have an expectation for {label}.
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          disabled={submit.isPending || parsed.length === 0}
          onClick={() => submit.mutate()}
        >
          <UploadIcon size={12} />
          {submit.isPending ? 'Loading…' : `Load ${parsed.length || ''} into ${label}`.trim()}
        </Button>
      </div>
    </div>
  );
}
