import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload as UploadIcon, Download, RefreshCw } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import { supabase } from '@/lib/supabase';
import { useCurrentUser, useWorkTypes, hasRole } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import { FileDropzone } from '@/components/ui/FileDropzone';
import {
  parseProgressFile,
  recentSundayISO,
  type ParsedRow,
} from '@/lib/progressParser';

function NoProject() {
  return (
    <Card>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Pick a project in the top bar before uploading progress data.
      </p>
    </Card>
  );
}

type ImportResponse = { inserted?: number; snapshot_id?: string; error?: string };

type WorkTypeWeightWarning = {
  workTypeCode: string;
  workTypeId: string;
  description: string;
  fromFile: number[];
  fromTemplate: number[];
  labelsFromFile: string[];
};

export function UploadPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canUpdateTemplate = hasRole(me?.role, 'admin');
  const [file, setFile] = useState<File | null>(null);
  const [weekEnding, setWeekEnding] = useState<string>(recentSundayISO());
  const [label, setLabel] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [rocWeightsFromFile, setRocWeightsFromFile] = useState<number[]>([]);
  const [rocLabelsFromFile, setRocLabelsFromFile] = useState<string[]>([]);

  const workTypes = useWorkTypes();

  // Distinct WORK_TYPE codes in the parsed rows that aren't in the
  // tenant's work_types library. The import edge function silently
  // resolves these to null and the EV view falls back to the discipline
  // default — surfacing them here lets the user catch typos or add the
  // missing work type before importing rows whose milestone math will
  // quietly use the wrong template.
  const unknownWorkTypes = useMemo(() => {
    if (parsed.length === 0 || !workTypes.data) return [] as string[];
    const known = new Set(
      workTypes.data.map((w) => w.work_type_code.toLowerCase()),
    );
    const seen = new Set<string>();
    for (const r of parsed) {
      const code = r.work_type?.trim();
      if (code && !known.has(code.toLowerCase())) seen.add(code);
    }
    return Array.from(seen).sort();
  }, [parsed, workTypes.data]);

  // Compare the inferred M1..M8 weights against the work_type referenced by
  // the file's first row (the WORK_TYPE column). Unified workbook design:
  // each row picks a work_type via XLOOKUP, so a single file is typically
  // single-work-type. We sample the first row to drive the warning; if
  // multiple work types appear in one file the user can re-upload per
  // type.
  const workTypeWarning: WorkTypeWeightWarning | null = useMemo(() => {
    if (rocWeightsFromFile.length === 0) return null;
    if (parsed.length === 0 || !workTypes.data) return null;
    const firstWithType = parsed.find((r) => r.work_type && r.work_type.trim());
    const codeFromFile = firstWithType?.work_type?.trim();
    if (!codeFromFile) return null;
    const wt = workTypes.data.find(
      (t) => t.work_type_code.toLowerCase() === codeFromFile.toLowerCase(),
    );
    if (!wt) return null;
    const templateWeights = wt.milestones.map((m) => m.weight);
    const fileNormalized = rocWeightsFromFile.slice(0, 8);
    while (fileNormalized.length < templateWeights.length) fileNormalized.push(0);
    const drift = templateWeights.some(
      (w, i) => Math.abs((fileNormalized[i] ?? 0) - w) > 0.001,
    );
    if (!drift) return null;
    return {
      workTypeCode: wt.work_type_code,
      workTypeId: wt.id,
      description: wt.description,
      fromFile: fileNormalized,
      fromTemplate: templateWeights,
      labelsFromFile: rocLabelsFromFile,
    };
  }, [rocWeightsFromFile, rocLabelsFromFile, parsed, workTypes.data]);

  // Admin one-click: push the file's M1..M8 weights + labels into the
  // detected work_type's milestone set. Calls work_type_milestones_set,
  // which validates sum==1.0 and rewrites the milestones atomically.
  const updateTemplate = useMutation({
    mutationFn: async () => {
      if (!workTypeWarning) {
        throw new Error('No WORK_TYPE detected for the uploaded file.');
      }
      if (workTypeWarning.labelsFromFile.length === 0) {
        throw new Error(
          'File is missing M1_DESC..M8_DESC labels — fix the source then retry.',
        );
      }
      const sum = workTypeWarning.fromFile.reduce((s, w) => s + w, 0);
      if (Math.abs(sum - 1) > 0.0001) {
        throw new Error(
          `File's M1..M8 weights sum to ${sum.toFixed(4)}; must equal 1.0000.`,
        );
      }
      // Only include milestones with a non-empty label and a positive
      // weight — variable-count work types (CIV-COMP has 1, others have
      // 8) shouldn't pad with empties.
      const milestones = workTypeWarning.fromFile
        .map((weight, i) => ({
          seq: i + 1,
          label: workTypeWarning.labelsFromFile[i] ?? '',
          weight,
        }))
        .filter((m) => m.label.trim() && m.weight > 0);
      const { error } = await supabase.rpc('work_type_milestones_set', {
        p_work_type_id: workTypeWarning.workTypeId,
        p_milestones: milestones,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-types'] });
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'work-type-milestones-for-record',
      });
    },
  });

  const onFile = async (f: File | null) => {
    setParseErr(null);
    setParsed([]);
    setUnmapped([]);
    setRocWeightsFromFile([]);
    setRocLabelsFromFile([]);
    updateTemplate.reset();
    setFile(f);
    if (!f) return;
    try {
      const result = await parseProgressFile(f);
      setParsed(result.rows);
      setUnmapped(result.unmappedHeaders);
      setRocWeightsFromFile(result.inferredRocWeights);
      setRocLabelsFromFile(result.inferredRocLabels);
      if (!label) setLabel(f.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setParseErr((err as Error).message);
    }
  };

  const submit = useMutation({
    mutationFn: async (): Promise<ImportResponse> => {
      const { data, error } = await supabase.functions.invoke('import-progress-records', {
        body: {
          projectId: projectId!,
          weekEnding: weekEnding || undefined,
          label: label || undefined,
          sourceFilename: file?.name ?? undefined,
          items: parsed,
        },
      });
      if (error) throw error;
      return (data ?? {}) as ImportResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
      qc.invalidateQueries({ queryKey: ['snapshots', projectId] });
      qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['discipline-metrics', projectId] });
    },
  });

  if (!projectId) return <NoProject />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          eyebrow="Universal upload"
          title="Import progress data"
          caption="CSV or Excel. Column names are matched against a wide alias table — drawing, description, hours, percent, foreman, IWP, milestone columns, etc."
          actions={
            <a
              href="/progress-template.csv"
              download="progress-template.csv"
              className="is-btn is-btn-outline is-btn-sm"
            >
              <Download size={14} /> Download example
            </a>
          }
        />

        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="File" required>
            <FileDropzone
              accept=".csv,.xlsx,.xls"
              onFile={onFile}
              selected={file}
              hint="CSV / XLSX / XLS — Sandra's audit templates parse unchanged"
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Week ending">
              <input
                type="date"
                className={inputClass}
                value={weekEnding}
                onChange={(e) => setWeekEnding(e.target.value)}
              />
            </Field>
            <Field label="Snapshot label">
              <input
                className={inputClass}
                placeholder="e.g. Week 18"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
          </div>

          {parseErr && <div className="is-toast is-toast-danger">{parseErr}</div>}

          {parsed.length > 0 && (
            <div className="text-xs text-[color:var(--color-text-muted)]">
              Parsed <strong>{parsed.length}</strong> rows
              {unmapped.length > 0 && (
                <>
                  {' · '}
                  <span className="text-[color:var(--color-warn)]">
                    Ignored columns: {unmapped.join(', ')}
                  </span>
                </>
              )}
            </div>
          )}

          {unknownWorkTypes.length > 0 && (
            <div className="is-toast is-toast-warn">
              <strong>
                Unknown WORK_TYPE code{unknownWorkTypes.length === 1 ? '' : 's'}
              </strong>
              <div className="mt-1 text-xs">
                {unknownWorkTypes.length === 1 ? 'This code is' : 'These codes are'} not in the work-types library:{' '}
                <span className="font-mono">{unknownWorkTypes.join(', ')}</span>.
                Rows referencing {unknownWorkTypes.length === 1 ? 'it' : 'them'} will import with no work type and
                fall back to the discipline's default for earned-value math.
                Add {unknownWorkTypes.length === 1 ? 'it' : 'them'} on the{' '}
                <strong>Work Types</strong> page or fix the file to suppress this warning.
              </div>
            </div>
          )}

          {workTypeWarning && (
            <div className="is-toast is-toast-warn">
              <strong>
                Milestone weight mismatch — {workTypeWarning.workTypeCode} (
                {workTypeWarning.description})
              </strong>
              <div className="mt-1 text-xs">
                Weights in the file's M1–M8 columns don't match the library's
                template for this work type. The upload will proceed using the
                library values — fix either the file or the work type on the{' '}
                <strong>Work Types</strong> page if this was unintentional.
              </div>
              <div className="mt-1 text-xs font-mono">
                File: [{workTypeWarning.fromFile.map((w) => w.toFixed(3)).join(', ')}]
                {workTypeWarning.labelsFromFile.length > 0 && (
                  <span className="text-[color:var(--color-text-muted)]">
                    {' '}
                    ({workTypeWarning.labelsFromFile.join(', ')})
                  </span>
                )}
                <br />
                Library: [{workTypeWarning.fromTemplate.map((w) => w.toFixed(3)).join(', ')}]
              </div>
              {canUpdateTemplate && workTypeWarning.labelsFromFile.length > 0 && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={updateTemplate.isPending}
                    onClick={() => updateTemplate.mutate()}
                  >
                    <RefreshCw size={12} />
                    {updateTemplate.isPending
                      ? 'Updating work type…'
                      : `Update ${workTypeWarning.workTypeCode} from this file`}
                  </Button>
                  {updateTemplate.isSuccess && (
                    <span className="text-xs text-[color:var(--color-variance-favourable)]">
                      Work type updated.
                    </span>
                  )}
                  {updateTemplate.isError && (
                    <span className="text-xs text-[color:var(--color-variance-unfavourable)]">
                      {(updateTemplate.error as Error).message}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {submit.error && (
            <div className="is-toast is-toast-danger">
              {(submit.error as Error).message}
            </div>
          )}
          {submit.isSuccess && submit.data && (
            <div className="is-toast is-toast-success">
              Inserted {submit.data.inserted} records, created snapshot {submit.data.snapshot_id}.
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={submit.isPending || parsed.length === 0}
            >
              <UploadIcon size={14} />
              {submit.isPending ? 'Uploading…' : `Upload ${parsed.length} rows`}
            </Button>
          </div>
        </form>
      </Card>

      {parsed.length > 0 && (
        <Card padded={false}>
          <div className="px-6 pt-5 pb-3">
            <CardHeader
              eyebrow="Preview"
              title="First 20 rows"
              caption="Confirm the parser caught the right columns before uploading."
            />
          </div>
          <div className="overflow-x-auto">
            <table className="is-table">
              <thead>
                <tr>
                  <th>DWG</th>
                  <th>Description</th>
                  <th>UoM</th>
                  <th className="text-right">Budget Hrs</th>
                  <th className="text-right">Actual Hrs</th>
                  <th className="text-right">% Complete</th>
                  <th>Foreman</th>
                  <th>IWP</th>
                  <th>Milestones</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    <td className="font-mono">{r.dwg ?? '—'}</td>
                    <td>{r.name ?? '—'}</td>
                    <td>{r.unit ?? '—'}</td>
                    <td className="text-right font-mono">{r.budget_hrs ?? '—'}</td>
                    <td className="text-right font-mono">{r.actual_hrs ?? '—'}</td>
                    <td className="text-right font-mono">{r.percent_complete ?? '—'}</td>
                    <td>{r.foreman_name ?? '—'}</td>
                    <td>{r.iwp_name ?? '—'}</td>
                    <td className="text-xs">
                      {r.milestones && r.milestones.length > 0
                        ? r.milestones.map((m) => `${m.name}:${m.pct.toFixed(0)}`).join(', ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
