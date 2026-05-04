import '@/lib/charts';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, Info, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useProjectStore } from '@/stores/project';
import {
  useBudgetRollup,
  useDashboardSummary,
  useCurrentUser,
  hasRole,
} from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { ChartCard, ChartCardSkeleton } from '@/components/dashboard/ChartCard';
import { fmt } from '@/lib/format';
import { LockBaselineModal } from '@/components/budget/LockBaselineModal';
import { BudgetByDisciplineChart } from '@/components/budget/BudgetByDisciplineChart';

type Project = {
  id: string;
  project_code: string;
  name: string;
  status: string;
  baseline_locked_at: string | null;
};

function ThreeBudgetPrimer() {
  return (
    <div className="is-surface p-6">
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-10 h-10 rounded-md flex items-center justify-center"
          style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
        >
          <Info size={18} />
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-1">The three-budget model</h3>
          <ul className="text-sm text-[color:var(--color-text-muted)] space-y-1.5 leading-relaxed">
            <li>
              <span className="font-semibold text-[color:var(--color-text)]">Original Budget</span> —
              the discipline budgets at the moment the baseline was locked. Immutable thereafter.
            </li>
            <li>
              <span className="font-semibold text-[color:var(--color-text)]">Current Budget</span> —
              Original + approved Change Orders. The figure all execution metrics (CPI, EAC) measure
              against.
            </li>
            <li>
              <span className="font-semibold text-[color:var(--color-text)]">Forecast Budget</span> —
              Current + pending and PC-reviewed Change Orders. Projected end-state if everything
              currently in flight gets approved.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function BudgetPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data: me } = useCurrentUser();
  const canLock = hasRole(me?.role, 'admin');
  const [lockModalOpen, setLockModalOpen] = useState(false);

  const { data: project } = useQuery({
    queryKey: ['project', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<Project | null> => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, project_code, name, status, baseline_locked_at')
        .eq('id', projectId!)
        .maybeSingle();
      if (error) throw error;
      return data as Project | null;
    },
  });

  const rollup = useBudgetRollup(projectId);
  const summary = useDashboardSummary(projectId);

  if (!projectId || !project) {
    return (
      <div className="is-surface p-8 text-center">
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Pick a project in the top bar to view its budget.
        </p>
      </div>
    );
  }

  if (rollup.isLoading || summary.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="is-surface is-stat-card">
              <div className="is-skeleton" style={{ width: '40%' }} />
              <div className="is-skeleton" style={{ height: 28, width: '60%' }} />
              <div className="is-skeleton" style={{ width: '70%' }} />
            </div>
          ))}
        </div>
        <ChartCardSkeleton title="Budget by Discipline" />
      </div>
    );
  }

  if (rollup.error || summary.error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load budget: {(rollup.error ?? summary.error)!.message}
      </div>
    );
  }

  const r = rollup.data!;
  const s = summary.data!;
  const isDraft = project.status === 'draft';
  const recordCount = s.disciplines.reduce((acc, d) => acc + d.records, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <BudgetTile
          tone="primary"
          label="Original Budget"
          hrs={r.original_budget}
          caption="Locked at baseline"
        />
        <BudgetTile
          tone="accent"
          label="Current Budget"
          hrs={r.current_budget}
          caption={
            r.approved_changes_hrs === 0
              ? 'No approved changes'
              : `OB ${r.approved_changes_hrs > 0 ? '+' : ''}${fmt.int(r.approved_changes_hrs)} approved`
          }
        />
        <BudgetTile
          tone="warn"
          label="Forecast Budget"
          hrs={r.forecast_budget}
          caption={
            r.pending_changes_hrs === 0
              ? 'No pending changes'
              : `CB ${r.pending_changes_hrs > 0 ? '+' : ''}${fmt.int(r.pending_changes_hrs)} pending`
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ChartCard
            title="Budget by Discipline"
            caption="Original / Current / Forecast budget hours per discipline."
          >
            {s.disciplines.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-[color:var(--color-text-muted)]">
                No active disciplines yet.
              </div>
            ) : (
              <BudgetByDisciplineChart
                disciplines={s.disciplines}
                approvedHrs={r.approved_changes_hrs}
                pendingHrs={r.pending_changes_hrs}
              />
            )}
          </ChartCard>
        </div>
        <div className="space-y-4">
          <BaselineControlsCard
            project={project}
            canLock={canLock}
            onLock={() => setLockModalOpen(true)}
          />
          <ThreeBudgetPrimer />
        </div>
      </div>

      <LockBaselineModal
        open={lockModalOpen && isDraft}
        onClose={() => setLockModalOpen(false)}
        projectId={project.id}
        projectCode={project.project_code}
        projectName={project.name}
        totalBudgetHrs={s.total_budget_hrs}
        recordCount={recordCount}
      />
    </div>
  );
}

type Tone = 'primary' | 'accent' | 'warn';
const toneBorder: Record<Tone, string> = {
  primary: 'var(--color-primary)',
  accent: 'var(--color-accent)',
  warn: 'var(--color-warn)',
};

function BudgetTile({
  tone,
  label,
  hrs,
  caption,
}: {
  tone: Tone;
  label: string;
  hrs: number;
  caption: string;
}) {
  return (
    <div
      className="is-surface is-stat-card relative overflow-hidden"
      style={{ borderLeft: `4px solid ${toneBorder[tone]}`, paddingLeft: 20 }}
    >
      <div className="is-stat-label">{label}</div>
      <div className="is-stat-value">{fmt.int(hrs)}</div>
      <div className="text-xs text-[color:var(--color-text-muted)] mt-1">{caption}</div>
    </div>
  );
}

function BaselineControlsCard({
  project,
  canLock,
  onLock,
}: {
  project: Project;
  canLock: boolean;
  onLock: () => void;
}) {
  const isDraft = project.status === 'draft';
  const lockedDate = project.baseline_locked_at
    ? new Date(project.baseline_locked_at).toLocaleDateString()
    : null;

  return (
    <div className="is-surface p-6">
      <div className="is-eyebrow mb-1.5">Baseline</div>
      <h3 className="text-base font-semibold leading-tight">
        {isDraft ? 'Ready to lock' : 'Locked'}
      </h3>
      <p className="text-sm text-[color:var(--color-text-muted)] mt-1.5 leading-relaxed">
        {isDraft
          ? 'Locking the baseline freezes discipline budgets and snapshot data. From then on, scope changes flow through Change Orders.'
          : `Baseline locked on ${lockedDate}. Discipline budgets are read-only — use Change Management to adjust scope.`}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {isDraft ? (
          <Button
            variant="primary"
            disabled={!canLock}
            onClick={onLock}
            className="w-full justify-center"
          >
            <Lock size={14} /> Lock baseline
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled
            className="w-full justify-center"
            title="Baseline export — Phase 3"
          >
            <Download size={14} /> Export snapshot
          </Button>
        )}
        {!canLock && isDraft && (
          <p className="text-xs text-[color:var(--color-text-muted)] text-center">
            Admin role required to lock baseline.
          </p>
        )}
      </div>
    </div>
  );
}
