import { FolderOpen } from 'lucide-react';

/**
 * Shared "pick a project" empty state — every project-scoped page renders
 * this when no project is selected in the top bar, so the treatment (and
 * any future "create one" CTA) stays consistent app-wide.
 */
export function NoProjectSelected({
  message = 'Pick a project from the top bar, or create one in Project Setup.',
}: {
  message?: string;
}) {
  return (
    <div className="is-surface is-empty">
      <div className="is-empty-icon">
        <FolderOpen size={28} />
      </div>
      <div className="is-empty-title">No project selected</div>
      <p className="is-empty-caption">{message}</p>
    </div>
  );
}
