import { useState, type FormEvent, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload as UploadIcon } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import { parseProgressFile, recentSundayISO, type ParsedRow } from '@/lib/progressParser';

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

export function UploadPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [weekEnding, setWeekEnding] = useState<string>(recentSundayISO());
  const [label, setLabel] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [parseErr, setParseErr] = useState<string | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setParseErr(null);
    setParsed([]);
    setUnmapped([]);
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (!f) return;
    try {
      const result = await parseProgressFile(f);
      setParsed(result.rows);
      setUnmapped(result.unmappedHeaders);
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
