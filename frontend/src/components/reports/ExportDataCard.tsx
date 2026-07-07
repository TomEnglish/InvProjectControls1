import { useState } from 'react';
import { Download, Database } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useCurrentUser, hasRole, useProjectMeta } from '@/lib/queries';
import { useProjectStore } from '@/stores/project';
import { exportProjectData } from '@/lib/exportData';

/**
 * Full-data export, Controllers (admin) and above. Downloads a multi-sheet
 * .xlsx workbook — one sheet per table — for either the current project or
 * every project in the tenant. Render-gated on admin+; RLS re-asserts on the
 * reads, so a lower role that forced the component in would still get an
 * empty/failed pull.
 */
export function ExportDataCard() {
  const { data: me } = useCurrentUser();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const meta = useProjectMeta(projectId);
  const [busy, setBusy] = useState<'project' | 'all' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!hasRole(me?.role, 'admin')) return null;

  const stamp = new Date().toISOString().slice(0, 10);

  const run = async (mode: 'project' | 'all') => {
    setBusy(mode);
    setMsg(null);
    setErr(null);
    try {
      const filenameBase =
        mode === 'project'
          ? `projectcontrols_${meta.data?.project_code ?? 'project'}_${stamp}`
          : `projectcontrols_all-projects_${stamp}`;
      const { sheets, rows } = await exportProjectData({
        projectId: mode === 'project' ? projectId : null,
        filenameBase,
      });
      setMsg(`Exported ${rows.toLocaleString()} rows across ${sheets} sheets.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        eyebrow="Controllers"
        title="Export data"
        caption={
          'Download the full dataset as a multi-sheet Excel workbook — one sheet per table ' +
          '(records, milestones, change orders, actuals, and the COA/work-type libraries). ' +
          'Export just the selected project, or every project in your organization.'
        }
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!projectId || busy !== null}
              onClick={() => run('project')}
            >
              <Download size={14} /> {busy === 'project' ? 'Exporting…' : 'This Project (.xlsx)'}
            </Button>
            <Button variant="primary" disabled={busy !== null} onClick={() => run('all')}>
              <Database size={14} /> {busy === 'all' ? 'Exporting…' : 'All Projects (.xlsx)'}
            </Button>
          </div>
        }
      />
      {msg && (
        <div className="text-sm text-[color:var(--color-variance-favourable)]">{msg}</div>
      )}
      {err && <div className="is-toast is-toast-danger">{err}</div>}
    </Card>
  );
}
