import { useMemo, useState, type FormEvent, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload as UploadIcon, Download, RefreshCw } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import { supabase } from '@/lib/supabase';
import { useCurrentUser, useRocTemplates, hasRole } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import {
  detectProgressDiscipline,
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

type RocWeightWarning = {
  disciplineCode: string;
  fromFile: number[];
  fromTemplate: number[];
  templateId: string | null;
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

  const rocTemplates = useRocTemplates();
  const disciplinesQuery = useQuery({
    queryKey: ['project-disciplines', projectId] as const,
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_disciplines')
        .select('id, discipline_code, display_name')
        .eq('project_id', projectId!)
        .eq('is_active', true)
        .order('discipline_code');
      if (error) throw error;
      return (data ?? []) as { id: string; discipline_code: string; display_name: string }[];
    },
  });

  // Compare the inferred ROC weights (from the audit-file's M1..M8 columns)
  // against the project's default ROC template for the file's discipline.
  // Used to surface a warning when Sandra's row-level weights don't match
  // what we have on file for that discipline. Decision #5.
  const rocWarning: RocWeightWarning | null = useMemo(() => {
    if (rocWeightsFromFile.length === 0) return null;
    if (!file || !disciplinesQuery.data || !rocTemplates.data) return null;
    const disciplineId = detectProgressDiscipline(
      file.name,
      disciplinesQuery.data.map((d) => ({ id: d.id, name: d.display_name })),
    );
    if (!disciplineId) return null;
    const discipline = disciplinesQuery.data.find((d) => d.id === disciplineId);
    if (!discipline) return null;
    // Default template for this discipline.
    const template = rocTemplates.data
      .filter((t) => t.discipline_code === discipline.discipline_code)
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || b.version - a.version)[0];
    if (!template) return null;
    const templateWeights = template.milestones.map((m) => m.weight);
    // Match length first; pad with zero if the file has fewer entries.
    const fileNormalized = rocWeightsFromFile.slice(0, 8);
    while (fileNormalized.length < templateWeights.length) fileNormalized.push(0);
    const drift = templateWeights.some((w, i) => Math.abs((fileNormalized[i] ?? 0) - w) > 0.001);
    if (!drift) return null;
    return {
      disciplineCode: discipline.discipline_code,
      fromFile: fileNormalized,
      fromTemplate: templateWeights,
      templateId: template.id,
      labelsFromFile: rocLabelsFromFile,
    };
  }, [rocWeightsFromFile, rocLabelsFromFile, file, disciplinesQuery.data, rocTemplates.data]);

  // Admin one-click: push the file's M1..M8 weights + labels into the
  // discipline's default template. Calls roc_template_set, which validates
  // sum==1.0 and rewrites all 8 milestones atomically.
  const updateTemplate = useMutation({
    mutationFn: async () => {
      if (!rocWarning || !rocWarning.templateId) {
        throw new Error('No discipline template detected for the uploaded file.');
      }
      if (rocWarning.labelsFromFile.length !== 8) {
        throw new Error(
          'File is missing M1_DESC..M8_DESC labels — fix the source then retry.',
        );
      }
      const sum = rocWarning.fromFile.reduce((s, w) => s + w, 0);
      if (Math.abs(sum - 1) > 0.0001) {
        throw new Error(
          `File's M1..M8 weights sum to ${sum.toFixed(4)}; must equal 1.0000.`,
        );
      }
      const milestones = rocWarning.fromFile.map((weight, i) => ({
        seq: i + 1,
        label: rocWarning.labelsFromFile[i]!,
        weight,
      }));
      const { error } = await supabase.rpc('roc_template_set', {
        p_template_id: rocWarning.templateId,
        p_milestones: milestones,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roc-templates'] });
      // The roc-milestones-for-discipline keys are dynamic per disc; nuke them all.
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'roc-milestones-for-discipline' });
    },
  });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setParseErr(null);
    setParsed([]);
    setUnmapped([]);
    setRocWeightsFromFile([]);
    setRocLabelsFromFile([]);
    updateTemplate.reset();
    const f = e.target.files?.[0] ?? null;
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
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={onFile}
              className={inputClass}
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

          {rocWarning && (
            <div className="is-toast is-toast-warn">
              <strong>ROC weight mismatch ({rocWarning.disciplineCode})</strong>
              <div className="mt-1 text-xs">
                Weights in the file's M1–M8 columns don't match the project's
                default ROC template for this discipline. The upload will
                proceed using the project's template — fix either the file or
                the ROC template on the Rules of Credit page if this was
                unintentional.
              </div>
              <div className="mt-1 text-xs font-mono">
                File: [{rocWarning.fromFile.map((w) => w.toFixed(3)).join(', ')}]
                {rocWarning.labelsFromFile.length === 8 && (
                  <span className="text-[color:var(--color-text-muted)]">
                    {' '}
                    ({rocWarning.labelsFromFile.join(', ')})
                  </span>
                )}
                <br />
                Template: [{rocWarning.fromTemplate.map((w) => w.toFixed(3)).join(', ')}]
              </div>
              {canUpdateTemplate && rocWarning.labelsFromFile.length === 8 && (
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
                      ? 'Updating template…'
                      : 'Update template from this file'}
                  </Button>
                  {updateTemplate.isSuccess && (
                    <span className="text-xs text-[color:var(--color-variance-favourable)]">
                      Template updated.
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
