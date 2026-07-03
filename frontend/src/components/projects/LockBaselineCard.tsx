import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { fmt } from '@/lib/format';
import { useBudgetRollup, useBaselineByDiscipline } from '@/lib/queries';
import { LockBaselineModal } from '@/components/budget/LockBaselineModal';

/**
 * Lock step at the end of the Project Setup flow.
 *
 * Setup reads top-to-bottom as: project info → disciplines → load baseline
 * → lock. The lock action itself (typed confirmation + effective-date
 * picker + immutable snapshot) previously lived only on Budget & Baseline,
 * which forced a mid-setup page hop; the same modal is reused here so both
 * entry points share one implementation. Render-gated by the caller on
 * pm+ and draft status — the RPC re-asserts both.
 */
type Props = {
  projectId: string;
  projectCode: string;
  projectName: string;
};

export function LockBaselineCard({ projectId, projectCode, projectName }: Props) {
  const rollup = useBudgetRollup(projectId);
  const baseline = useBaselineByDiscipline(projectId);
  const [lockOpen, setLockOpen] = useState(false);

  const recordCount =
    [...(baseline.data?.byDiscipline.values() ?? [])].reduce((n, d) => n + d.count, 0) +
    (baseline.data?.unassignedCount ?? 0);
  const budgetHrs = rollup.data?.current_budget ?? 0;
  const hasBaseline = recordCount > 0;

  return (
    <Card>
      <CardHeader
        eyebrow="Final step"
        title="Lock baseline"
        caption={
          'Locking freezes the current scope as the official baseline — an immutable ' +
          'snapshot is stored, the project moves to Active, and further scope changes go ' +
          'through Change Orders. Verify the load on the Data Check page first. You pick ' +
          'the effective baseline date in the confirmation step.'
        }
        actions={
          <Button
            variant="primary"
            disabled={!hasBaseline || rollup.isLoading}
            onClick={() => setLockOpen(true)}
          >
            <Lock size={14} /> Lock Baseline…
          </Button>
        }
      />
      <div className="text-sm text-[color:var(--color-text-muted)]">
        {hasBaseline ? (
          <>
            Ready to lock: <strong>{fmt.int(recordCount)}</strong> baseline records,{' '}
            <strong>{fmt.int(budgetHrs)}</strong> budget hours.
          </>
        ) : (
          'Load a baseline above before locking.'
        )}
      </div>

      <LockBaselineModal
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        projectId={projectId}
        projectCode={projectCode}
        projectName={projectName}
        totalBudgetHrs={budgetHrs}
        recordCount={recordCount}
      />
    </Card>
  );
}
