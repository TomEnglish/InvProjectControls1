import { useEffect, useState, type FormEvent } from 'react';
import { Upload as UploadIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/project';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/FormField';
import { FileDropzone } from '@/components/ui/FileDropzone';
import {
  submitToUploadQueue,
  useProjectClerkCrafts,
  type HeuristicWarnings,
} from '@/lib/queries';
import { recentSundayISO } from '@/lib/progressParser';

/**
 * Clerk-side submission UI. Posts the file to queue-progress-upload which
 * parses it server-side, runs heuristic + LLM checks, and queues the row
 * for the auditor. On heuristic mismatch the edge fn returns 409 with
 * the warning details — we surface them and offer a "submit anyway"
 * confirm that re-POSTs with overrideWarnings=true.
 */
export function ClerkUploadPanel() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const qc = useQueryClient();
  const crafts = useProjectClerkCrafts(projectId);

  const [file, setFile] = useState<File | null>(null);
  const [declaredCraft, setDeclaredCraft] = useState('');
  const [weekEnding, setWeekEnding] = useState(recentSundayISO());
  const [label, setLabel] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<HeuristicWarnings | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Default the dropdown to the single permitted craft when there's
  // exactly one — saves a click in the common single-craft clerk case.
  // Reset back to '' if the user navigates between projects with
  // different craft counts.
  useEffect(() => {
    const list = crafts.data ?? [];
    if (list.length === 1 && !declaredCraft) {
      setDeclaredCraft(list[0]!);
    }
  }, [crafts.data, declaredCraft]);

  if (!projectId) {
    return (
      <Card>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Pick a project in the top bar to submit a weekly progress file.
        </p>
      </Card>
    );
  }
  if (crafts.isLoading) {
    return (
      <Card>
        <div className="is-skeleton" style={{ height: 120 }} />
      </Card>
    );
  }
  if ((crafts.data ?? []).length === 0) {
    return (
      <Card>
        <CardHeader title="Submit weekly progress" />
        <p className="text-sm text-[color:var(--color-text-muted)]">
          No crafts are assigned to you on this project yet. Ask the project
          manager to add your craft on User Admin before submitting.
        </p>
      </Card>
    );
  }

  const reset = () => {
    setError(null);
    setPendingWarnings(null);
    setSuccess(null);
  };

  const doSubmit = async (override: boolean) => {
    if (!file || !declaredCraft) {
      setError('File and craft are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    // Drop any prior warnings — if the override re-POST itself fails
    // with a different error we don't want the stale warning panel
    // hanging around alongside the new error toast.
    setPendingWarnings(null);
    const resp = await submitToUploadQueue({
      projectId,
      declaredCraft,
      file,
      weekEnding: weekEnding || undefined,
      label: label || undefined,
      overrideWarnings: override,
    });
    setSubmitting(false);
    if (!resp.ok) {
      if (resp.status === 409 && resp.heuristicWarnings) {
        setPendingWarnings(resp.heuristicWarnings);
        return;
      }
      setError(resp.error);
      return;
    }
    setSuccess(`Submitted for auditor review — queue id ${resp.result.queueId.slice(0, 8)}…`);
    setFile(null);
    setLabel('');
    qc.invalidateQueries({ queryKey: ['my-submissions'] });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    reset();
    void doSubmit(false);
  };

  return (
    <Card>
      <CardHeader
        eyebrow="Submit for auditor review"
        title="Weekly progress file"
        caption="Your file will be parsed and queued for an auditor to review before it lands in live progress data."
      />

      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="File" required>
          <FileDropzone
            accept=".csv,.xlsx,.xls"
            onFile={(f) => {
              reset();
              setFile(f);
            }}
            selected={file}
            hint="CSV / XLSX — auditor uses the same parse as the reviewer direct path"
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Craft" required>
            <select
              className={inputClass}
              value={declaredCraft}
              onChange={(e) => {
                reset();
                setDeclaredCraft(e.target.value);
              }}
              required
            >
              <option value="">Pick a craft…</option>
              {(crafts.data ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Week ending">
            <input
              type="date"
              className={inputClass}
              value={weekEnding}
              onChange={(e) => setWeekEnding(e.target.value)}
            />
          </Field>
          <Field label="Label (optional)">
            <input
              className={inputClass}
              placeholder="e.g. Week 18"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
        </div>

        {pendingWarnings && (
          <div className="is-toast is-toast-warn">
            <strong>Review before submitting</strong>
            {pendingWarnings.filenameMismatch && (
              <div className="mt-1 text-xs">{pendingWarnings.filenameMismatch}</div>
            )}
            {(pendingWarnings.disciplineMismatch.length > 0 ||
              pendingWarnings.workTypeMismatch.length > 0) && (
              <>
                <div className="mt-1 text-xs">
                  The file may not be a <strong>{declaredCraft}</strong> audit:
                </div>
                <ul className="mt-1 text-xs list-disc ml-5">
                  {pendingWarnings.disciplineMismatch.slice(0, 3).map((w, i) => (
                    <li key={`d${i}`}>
                      Row {w.rowIndex + 1}: DISCIPLINE column says
                      <code className="ml-1">{w.rowValue}</code>
                    </li>
                  ))}
                  {pendingWarnings.workTypeMismatch.slice(0, 3).map((w, i) => (
                    <li key={`w${i}`}>
                      Row {w.rowIndex + 1}: WORK_TYPE{' '}
                      <code className="mx-1">{w.code}</code> belongs to {w.codeCraft}
                    </li>
                  ))}
                </ul>
                {pendingWarnings.disciplineMismatch.length +
                  pendingWarnings.workTypeMismatch.length >
                  6 && (
                  <div className="mt-1 text-xs">…and more row mismatches.</div>
                )}
              </>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={submitting}
                onClick={() => doSubmit(true)}
              >
                Submit anyway
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPendingWarnings(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && <div className="is-toast is-toast-danger">{error}</div>}
        {success && <div className="is-toast is-toast-success">{success}</div>}

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || !file || !declaredCraft || pendingWarnings !== null}
          >
            <UploadIcon size={14} />
            {submitting ? 'Submitting…' : 'Submit for review'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
