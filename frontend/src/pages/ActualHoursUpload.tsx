import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Clock3, Upload as UploadIcon } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/project';
import {
  hasRole,
  useCurrentUser,
  useProgressPeriods,
  useProjectClosed,
} from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { parseActualHoursFile, ActualHoursFormatError, type ActualHoursRow } from '@/lib/actualHoursParser';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, selectClass } from '@/components/ui/FormField';
import { FileDropzone } from '@/components/ui/FileDropzone';
import { FrozenBanner } from '@/components/ui/FrozenBanner';
import { NoProjectSelected } from '@/components/ui/NoProjectSelected';

type ApplyResponse = {
  applied?: number;
  period_id?: string;
  error?: string;
};

type ApplyErrorResponse = {
  error?: string;
  issues?: { message?: string }[];
};

async function callActualHoursImport(body: Record<string, unknown>): Promise<ApplyResponse> {
  const { data, error } = await supabase.functions.invoke('import-actual-hours', { body });
  if (error) {
    const context = (error as unknown as { context?: Response }).context;
    if (context && typeof context.clone === 'function') {
      try {
        const response = (await context.clone().json()) as ApplyErrorResponse;
        const messages = [
          response.error,
          ...(response.issues ?? []).map((issue) => issue.message).filter(Boolean),
        ].filter(Boolean);
        if (messages.length > 0) throw new Error(messages.join(' '));
      } catch (contextError) {
        if (contextError instanceof Error && contextError.message) throw contextError;
      }
    }
    throw error;
  }
  return (data ?? {}) as ApplyResponse;
}

export function ActualHoursUploadPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: me, isLoading: userLoading } = useCurrentUser();
  const periods = useProgressPeriods(projectId);
  const frozen = useProjectClosed(projectId);
  const qc = useQueryClient();

  const [periodId, setPeriodId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ActualHoursRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const openPeriods = useMemo(
    () => (periods.data ?? []).filter((period) => !period.locked_at),
    [periods.data],
  );

  useEffect(() => {
    if (!openPeriods.some((period) => period.id === periodId)) {
      setPeriodId(openPeriods[0]?.id ?? '');
    }
  }, [openPeriods, periodId]);

  const apply = useMutation({
    mutationFn: async (): Promise<ApplyResponse> => {
      if (!projectId || !periodId || parsed.length === 0) {
        throw new Error('Project, open period, and a valid workbook are required.');
      }
      return callActualHoursImport({
        projectId,
        periodId,
        sourceFilename: file?.name ?? undefined,
        items: parsed,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['progress-rows', projectId] });
      qc.invalidateQueries({ queryKey: ['project-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['discipline-metrics', projectId] });
      qc.invalidateQueries({ queryKey: ['progress-periods', projectId] });
    },
  });

  const clearFileState = () => {
    setFile(null);
    setParsed([]);
    setParseError(null);
    apply.reset();
  };

  const onFile = async (nextFile: File | null) => {
    setFile(nextFile);
    setParsed([]);
    setParseError(null);
    apply.reset();
    if (!nextFile) return;
    try {
      const result = await parseActualHoursFile(nextFile);
      setParsed(result.rows);
    } catch (error) {
      if (error instanceof ActualHoursFormatError) {
        setParseError(error.issues.map((issue) => issue.message).join(' '));
      } else {
        setParseError((error as Error).message);
      }
    }
  };

  if (!projectId) {
    return <NoProjectSelected message="Pick a project in the top bar before uploading actual hours." />;
  }

  if (userLoading) {
    return <Card><div className="is-skeleton" style={{ height: 160 }} /></Card>;
  }

  if (!hasRole(me?.role, 'pc_reviewer')) {
    return (
      <Card>
        <CardHeader eyebrow="Actual hours" title="Reviewer access required" />
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Period actual-hours uploads are available to project-controls reviewers and above.
        </p>
      </Card>
    );
  }

  if (periods.isLoading) {
    return <Card><div className="is-skeleton" style={{ height: 220 }} /></Card>;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    apply.mutate();
  };

  return (
    <div className="space-y-4">
      <FrozenBanner projectId={projectId} />

      <Card>
        <CardHeader
          eyebrow="Period actuals"
          title="Upload Actual Hours"
          caption="Apply period actual hours to the locked project baseline. This upload does not change milestones, budget quantities, or earned progress."
        />

        <div className="is-toast is-toast-info mb-4">
          <Clock3 size={18} className="shrink-0 mt-0.5" />
          <div>
            <strong>ACTUAL_HRS is period hours, not cumulative hours.</strong>
            <div className="mt-0.5 text-xs">
              Re-uploading the same record for the same open period replaces its prior upload value.
              Every row must match this project&apos;s locked baseline by DISCIPLINE + DWG + SPEC + SPOOL_FR or TAG_NO.
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="grid gap-4">
          <Field
            label="Open progress period"
            required
            hint={openPeriods.length === 0 ? 'Create or reopen a progress period before uploading actual hours.' : undefined}
          >
            <select
              className={selectClass}
              value={periodId}
              onChange={(event) => setPeriodId(event.target.value)}
              disabled={openPeriods.length === 0}
              required
            >
              <option value="">Choose a period…</option>
              {openPeriods.map((period) => (
                <option key={period.id} value={period.id}>
                  Period {period.period_number} · {period.start_date} to {period.end_date}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Workbook" required>
            <FileDropzone
              accept=".xlsx,.xls"
              onFile={onFile}
              selected={file}
              hint="XLSX / XLS — exactly one worksheet with the Actual Hours template"
            />
          </Field>

          {parseError && <div className="is-toast is-toast-danger">{parseError}</div>}

          {parsed.length > 0 && (
            <div className="is-toast is-toast-success">
              Validated <strong>{parsed.length}</strong> rows. The file is ready to apply to the selected open period.
            </div>
          )}

          {apply.error && (
            <div className="is-toast is-toast-danger">{(apply.error as Error).message}</div>
          )}
          {apply.isSuccess && (
            <div className="is-toast is-toast-success">
              Applied {apply.data?.applied ?? parsed.length} actual-hours rows. Progress and discipline actuals are refreshed.
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={clearFileState} disabled={!file && parsed.length === 0}>
              Clear
            </Button>
            <Button
              type="submit"
              disabled={apply.isPending || parsed.length === 0 || !periodId || frozen}
              title={frozen ? 'Project is closed — data is frozen. Reopen it on Project Setup to upload.' : undefined}
            >
              <UploadIcon size={14} />
              {apply.isPending ? 'Applying…' : `Apply ${parsed.length} rows`}
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
              caption="These identity columns are checked against the locked project baseline before any data is written."
            />
          </div>
          <div className="overflow-x-auto">
            <table className="is-table">
              <thead>
                <tr>
                  <th>Discipline</th>
                  <th>DWG</th>
                  <th>TAG_NO</th>
                  <th>SPOOL_FR</th>
                  <th>SPEC</th>
                  <th className="text-right">Period Actual Hrs</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 20).map((row, index) => (
                  <tr key={`${row.dwg}-${row.attr_spec}-${index}`}>
                    <td>{row.discipline_label}</td>
                    <td className="font-mono">{row.dwg}</td>
                    <td className="font-mono">{row.tag_no ?? '—'}</td>
                    <td className="font-mono">{row.spool_fr ?? '—'}</td>
                    <td className="font-mono">{row.attr_spec}</td>
                    <td className="text-right font-mono">{row.hours.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.length > 20 && (
            <div className="px-6 py-3 text-xs text-[color:var(--color-text-muted)]">
              Showing 20 of {parsed.length} validated rows.
            </div>
          )}
        </Card>
      )}

      <p className="text-xs text-[color:var(--color-text-muted)]">
        Expected headers: <span className="font-mono">DISCIPLINE, DWG, TAG_NO, SPOOL_FR, SPEC, ACTUAL_HRS</span>.
        Use the Progress Audit page for milestone and earned-progress updates.
      </p>
    </div>
  );
}
