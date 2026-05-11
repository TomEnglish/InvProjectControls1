import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload as UploadIcon, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/FormField';
import { FileDropzone } from '@/components/ui/FileDropzone';
import { parseProgressFile, type ParsedRow } from '@/lib/progressParser';

// COA prime → discipline_code. Matches the canonical seed in migration
// 20260508000001 and the QMR PRIME_DISPLAY map.
const PRIME_TO_DISCIPLINE: Record<string, string> = {
  '01': 'SITE',
  '04': 'CIVIL',
  '05': 'STEEL',
  '07': 'MECH',
  '08': 'PIPE',
  '09': 'ELEC',
  '10': 'INST',
};

type Existing = {
  disciplineCodes: Set<string>;
  iwpNamesLower: Set<string>;
};

type Preview = {
  rowCount: number;
  disciplinesInFile: string[];
  iwpsInFile: string[];
  newDisciplines: string[];
  newIwps: string[];
  rowsMissingCode: number;
  rowsMissingBudget: number;
};

type ImportResponse = {
  inserted?: number;
  disciplines_created?: number;
  iwps_created?: number;
  error?: string;
};

export function BaselineUploadCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [parseErr, setParseErr] = useState<string | null>(null);

  // Pre-load existing disciplines + IWPs so the preview can show what's
  // already there vs. what the upload will create.
  const existing = useQuery({
    queryKey: ['baseline-existing', projectId] as const,
    queryFn: async (): Promise<Existing> => {
      const [discRes, iwpRes] = await Promise.all([
        supabase
          .from('project_disciplines')
          .select('discipline_code')
          .eq('project_id', projectId),
        supabase
          .from('iwps')
          .select('name')
          .eq('project_id', projectId),
      ]);
      if (discRes.error) throw discRes.error;
      if (iwpRes.error) throw iwpRes.error;
      return {
        disciplineCodes: new Set(
          ((discRes.data ?? []) as { discipline_code: string }[]).map((d) => d.discipline_code),
        ),
        iwpNamesLower: new Set(
          ((iwpRes.data ?? []) as { name: string }[]).map((i) => i.name.toLowerCase()),
        ),
      };
    },
  });

  const preview: Preview | null = useMemo(() => {
    if (parsed.length === 0 || !existing.data) return null;
    const disciplinesInFile = new Set<string>();
    const iwpsInFile = new Set<string>();
    let rowsMissingCode = 0;
    let rowsMissingBudget = 0;
    for (const r of parsed) {
      const code = (r.code ?? '').trim();
      if (!code) rowsMissingCode++;
      else {
        const prime = code.slice(0, 2);
        const disc = PRIME_TO_DISCIPLINE[prime];
        if (disc) disciplinesInFile.add(disc);
      }
      if (!r.budget_hrs || r.budget_hrs <= 0) rowsMissingBudget++;
      if (r.iwp_name && r.iwp_name.trim()) iwpsInFile.add(r.iwp_name.trim());
    }
    const newDisciplines = [...disciplinesInFile].filter(
      (d) => !existing.data!.disciplineCodes.has(d),
    );
    const newIwps = [...iwpsInFile].filter(
      (n) => !existing.data!.iwpNamesLower.has(n.toLowerCase()),
    );
    return {
      rowCount: parsed.length,
      disciplinesInFile: [...disciplinesInFile].sort(),
      iwpsInFile: [...iwpsInFile].sort(),
      newDisciplines: newDisciplines.sort(),
      newIwps: newIwps.sort(),
      rowsMissingCode,
      rowsMissingBudget,
    };
  }, [parsed, existing.data]);

  const submit = useMutation({
    mutationFn: async (): Promise<ImportResponse> => {
      const { data, error } = await supabase.functions.invoke('import-baseline-records', {
        body: {
          projectId,
          sourceFilename: file?.name ?? undefined,
          items: parsed,
        },
      });
      if (error) throw error;
      return (data ?? {}) as ImportResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['baseline-existing', projectId] });
      qc.invalidateQueries({ queryKey: ['disciplines', projectId] });
      qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
      qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['discipline-metrics', projectId] });
      setFile(null);
      setParsed([]);
      setUnmapped([]);
    },
  });

  const onFile = async (f: File | null) => {
    setParseErr(null);
    setParsed([]);
    setUnmapped([]);
    submit.reset();
    setFile(f);
    if (!f) return;
    try {
      const result = await parseProgressFile(f);
      setParsed(result.rows);
      setUnmapped(result.unmappedHeaders);
    } catch (err) {
      setParseErr((err as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader
        eyebrow="Initial baseline"
        title="Drop baseline file"
        caption={
          'One-shot loader for the project\'s starting record set — drawings, ' +
          'IWPs, disciplines, budget quantities and hours, with no progress data. ' +
          'Disciplines and IWPs implied by the file are auto-created. Use this ' +
          'while the project is in draft; the weekly Upload page handles ongoing ' +
          'progress after baseline lock.'
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

      <div className="grid gap-4">
        <Field label="Baseline file (xlsx or csv)" required>
          <FileDropzone
            accept=".csv,.xlsx,.xls"
            onFile={onFile}
            selected={file}
            label="Drag the baseline file here or click to browse"
            hint="One of Sandra's per-discipline audit templates, or the unified superset"
          />
        </Field>

        {parseErr && <div className="is-toast is-toast-danger">{parseErr}</div>}

        {preview && (
          <div className="rounded-md p-4 space-y-3 text-sm" style={{ background: 'var(--color-raised)' }}>
            <div className="flex items-baseline justify-between">
              <div className="font-semibold">
                Parsed <span className="font-mono">{preview.rowCount}</span> rows
              </div>
              {unmapped.length > 0 && (
                <div className="text-xs text-[color:var(--color-warn)]">
                  Ignored columns: {unmapped.join(', ')}
                </div>
              )}
            </div>

            {preview.rowsMissingCode > 0 && (
              <div className="text-xs text-[color:var(--color-warn)]">
                {preview.rowsMissingCode} row(s) have no COA code — they'll still
                import but won't roll up in QMR until an admin adds a code.
              </div>
            )}
            {preview.rowsMissingBudget > 0 && (
              <div className="text-xs text-[color:var(--color-warn)]">
                {preview.rowsMissingBudget} row(s) have no budget hours — these
                won't contribute to the Original Budget at baseline lock.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <PreviewGroup
                label="Disciplines in file"
                items={preview.disciplinesInFile}
                newItems={new Set(preview.newDisciplines)}
              />
              <PreviewGroup
                label="IWPs in file"
                items={preview.iwpsInFile}
                newItems={new Set(preview.newIwps)}
              />
            </div>
          </div>
        )}

        {submit.error && (
          <div className="is-toast is-toast-danger">
            {(submit.error as Error).message}
          </div>
        )}
        {submit.isSuccess && submit.data && (
          <div className="is-toast is-toast-success">
            Loaded <strong>{submit.data.inserted}</strong> baseline records
            {submit.data.disciplines_created
              ? `, created ${submit.data.disciplines_created} discipline(s)`
              : ''}
            {submit.data.iwps_created ? `, created ${submit.data.iwps_created} IWP(s)` : ''}
            . You can drop another discipline file or lock the baseline on the
            Budget page when you're done.
          </div>
        )}

        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={submit.isPending || parsed.length === 0}
            onClick={() => submit.mutate()}
          >
            <UploadIcon size={14} />
            {submit.isPending ? 'Loading baseline…' : `Load ${parsed.length} rows as baseline`}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PreviewGroup({
  label,
  items,
  newItems,
}: {
  label: string;
  items: string[];
  newItems: Set<string>;
}) {
  return (
    <div>
      <div className="is-eyebrow mb-1.5">
        {label} ({items.length})
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-[color:var(--color-text-muted)]">— none —</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => {
            const isNew = newItems.has(it);
            return (
              <span
                key={it}
                className="is-chip"
                style={{
                  background: isNew
                    ? 'var(--color-primary-soft)'
                    : 'var(--color-surface)',
                  color: isNew ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  border: `1px solid ${
                    isNew ? 'var(--color-primary)' : 'var(--color-line)'
                  }`,
                }}
                title={isNew ? 'Will be created' : 'Already exists'}
              >
                {isNew && '+ '}
                {it}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
