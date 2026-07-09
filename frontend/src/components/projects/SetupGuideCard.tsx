import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import {
  useBaselineByDiscipline,
  useImportManifests,
  useDataCheckSignoff,
  type Project,
} from '@/lib/queries';

/**
 * New-user orientation for the project-setup flow.
 *
 * UAT feedback: the setup sequence (info → baseline → verify → lock) is
 * only obvious once you've done it — and after locking, the lock card
 * disappears from this page with nothing saying setup is complete. This
 * guide states the steps in order, derives each step's done/pending state
 * from the project's actual data (not a stored checklist that can drift),
 * and stays visible after lock as the "setup complete" confirmation.
 */
type Props = { project: Project };

type Step = {
  title: string;
  detail: string;
  done: boolean;
  linkTo?: string;
  linkLabel?: string;
};

export function SetupGuideCard({ project }: Props) {
  const baseline = useBaselineByDiscipline(project.id);
  const manifests = useImportManifests(project.id);
  const signoff = useDataCheckSignoff(project.id);

  const baselineCount =
    [...(baseline.data?.byDiscipline.values() ?? [])].reduce((n, d) => n + d.count, 0) +
    (baseline.data?.unassignedCount ?? 0);
  const locked = project.status !== 'draft';

  // Verified = someone signed off on the Data Check page AND no import has
  // landed since (a newer manifest means the verified state is stale).
  const latestImportAt = (manifests.data ?? []).reduce<string | null>(
    (acc, m) => (acc === null || m.created_at > acc ? m.created_at : acc),
    null,
  );
  const verified =
    !!signoff.data && (!latestImportAt || signoff.data.verified_at >= latestImportAt);

  const steps: Step[] = [
    {
      title: 'Complete project information',
      detail:
        'Set the project code, name, client, and start/end dates in the card below. ' +
        'Everything stays editable until the baseline is locked.',
      done: !!(project.name && project.client && project.start_date && project.end_date),
    },
    {
      title: 'Load the baseline',
      detail:
        'Load the baseline one discipline at a time — drop each discipline\'s audit file ' +
        'into its zone in the Baseline by discipline card below. Disciplines are created ' +
        'automatically, and each upload is checked on the Data Check page.',
      done: baselineCount > 0,
    },
    {
      title: 'Verify the load',
      detail:
        'The Data Check page reconciles the file against the database — row counts, ' +
        'column coverage, sums, and work types. Review the checks, then click ' +
        '"Mark load verified" to sign off. Re-importing after sign-off asks for a fresh one.',
      done: verified,
      linkTo: '/data-check',
      linkLabel: 'Open Data Check',
    },
    {
      title: 'Lock the baseline',
      detail:
        'Locking freezes scope as the official baseline and moves the project to Active. ' +
        'You pick the effective baseline date in the confirmation. After locking, scope ' +
        'changes go through Change Orders and weekly progress comes in via the Upload page.',
      done: locked,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card>
      <CardHeader
        eyebrow="Setup guide"
        title={locked ? 'Setup complete — project is active' : 'Setting up this project'}
        caption={
          locked
            ? 'The baseline is locked. Weekly progress now flows through the Upload page, ' +
              'and scope changes go through Change Management.'
            : `${doneCount} of ${steps.length} steps done. Work top to bottom — each step ` +
              'unlocks the next.'
        }
      />
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 items-start">
            {s.done ? (
              <CheckCircle2
                size={18}
                className="text-[color:var(--color-variance-favourable)] shrink-0 mt-0.5"
              />
            ) : (
              <Circle size={18} className="text-[color:var(--color-text-subtle)] shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {i + 1}. {s.title}
              </div>
              <div className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
                {s.detail}{' '}
                {s.linkTo && (
                  <Link
                    to={s.linkTo}
                    className="inline-flex items-center gap-1 text-[color:var(--color-accent)] hover:underline"
                  >
                    {s.linkLabel} <ArrowRight size={12} />
                  </Link>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
