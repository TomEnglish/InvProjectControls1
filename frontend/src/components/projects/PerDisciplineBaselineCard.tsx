import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload as UploadIcon,
  Download,
  CheckCircle2,
  Circle,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FileDropzone } from '@/components/ui/FileDropzone';
import { parseProgressFile, parseQmrFile, type ParsedRow } from '@/lib/progressParser';
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
  const status = useBaselineByDiscipline(projectId);

  return (
    <Card>
      <CardHeader
        eyebrow="Initial baseline"
        title="Baseline by discipline"
        caption={
          'Drop each per-discipline audit file into its zone. Every record ' +
          'in a file is assigned to the zone\'s discipline, so Foundations ' +
          'audits land under FOUNDATIONS instead of folding back into Civil. ' +
          'Use the Upload page for weekly progress once the baseline is locked.'
        }
        actions={
          <a
            href="/progress-template.csv"
            download="progress-template.csv"
            className="is-btn is-btn-outline is-btn-sm"
          >
            <Download size={14} /> Template
          </a>
        }
      />

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
              key={d.code}
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
      return (data ?? {}) as { inserted?: number; error?: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['baseline-by-discipline', projectId] });
      qc.invalidateQueries({ queryKey: ['disciplines', projectId] });
      qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
      qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['discipline-metrics', projectId] });
      setFile(null);
      setParsed([]);
      setUnmapped([]);
      setWarning(null);
    },
  });

  const onFile = async (f: File | null) => {
    setParseErr(null);
    setParsed([]);
    setUnmapped([]);
    setWarning(null);
    submit.reset();
    setFile(f);
    if (!f) return;
    try {
      // A zone declares ONE discipline for every record it imports. A QMR audit
      // file carries a per-row DISCIPLINE column; if it spans MORE THAN ONE
      // discipline, flattening it into this single zone would be wrong — so
      // redirect to the QMR card, which routes each row by its discipline.
      // But a single-discipline audit (e.g. a "Site Work" export) belongs here:
      // use the QMR-parsed rows (correct header offset, "ALL" metadata dropped).
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
            `This workbook spans ${labels.length} disciplines (${labels.join(', ')}), ` +
              `${rows.length} records. Use the “Load baseline from QMR workbook” card above so ` +
              `each discipline is routed correctly — this ${label} zone would force all ` +
              `${rows.length} records into ${label}.`,
          );
          return;
        }

        setParsed(rows);
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
          <span className="text-xs text-[color:var(--color-text-muted)]">
            {loadedCount} records · {lastDate}
          </span>
        )}
      </div>

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
