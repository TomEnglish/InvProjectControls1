import { Lock } from 'lucide-react';
import { useProjectClosed } from '@/lib/queries';

/**
 * Shown at the top of write-capable pages when the selected project is closed.
 * The database rejects writes to a closed project's data (freeze_closed
 * triggers); this banner explains why the page's actions are disabled and
 * points at the reopen path. Renders nothing for open projects.
 */
export function FrozenBanner({ projectId }: { projectId: string | null }) {
  const closed = useProjectClosed(projectId);
  if (!closed) return null;
  return (
    <div className="is-toast is-toast-warn">
      <Lock size={18} className="shrink-0 mt-0.5" />
      <div>
        <div className="font-semibold">This project is closed — its data is frozen.</div>
        <div className="opacity-90 mt-0.5">
          Progress, uploads, change orders, and actuals are read-only. To make changes, reopen the
          project on Project Setup.
        </div>
      </div>
    </div>
  );
}
