import { useProjectStore } from '@/stores/project';
import { useDashboardSummary } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { fmt } from '@/lib/format';

function NoProject() {
  return (
    <Card>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Pick a project in the top bar to view discipline progress.
      </p>
    </Card>
  );
}

export function DisciplineProgressPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const summary = useDashboardSummary(projectId);

  if (!projectId) return <NoProject />;
  if (summary.isLoading) {
    return (
      <Card>
        <div className="is-skeleton" style={{ height: 280, width: '100%' }} />
      </Card>
    );
  }
  if (summary.error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load discipline progress: {summary.error.message}
      </div>
    );
  }
  const s = summary.data;
  if (!s) return <NoProject />;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {s.disciplines.length === 0 && (
        <Card>
          <p className="text-sm text-[color:var(--color-text-muted)]">No active disciplines yet.</p>
        </Card>
      )}
      {s.disciplines.map((d) => {
        const earnedFrac = d.budget_hrs > 0 ? d.earned_hrs / d.budget_hrs : 0;
        const actualFrac = d.budget_hrs > 0 ? Math.min(1, d.actual_hrs / d.budget_hrs) : 0;
        const overActual = d.actual_hrs > d.budget_hrs;
        return (
          <Card key={d.discipline_id}>
            <CardHeader
              eyebrow={d.discipline_code}
              title={d.display_name}
              caption={`${d.records} records · ${fmt.int(d.budget_hrs)} budget hrs`}
            />
            <div className="grid grid-cols-3 gap-3 text-xs mb-3">
              <Stat label="Earned" value={`${fmt.int(d.earned_hrs)} hrs`} />
              <Stat label="Actual" value={`${fmt.int(d.actual_hrs)} hrs`} />
              <Stat
                label="CPI"
                value={fmt.ratio(d.cpi ?? undefined)}
                tone={
                  d.cpi == null
                    ? 'neutral'
                    : d.cpi >= 1
                      ? 'favourable'
                      : 'unfavourable'
                }
              />
            </div>

            <Bar
              label="Earned vs Budget"
              percent={Math.min(100, earnedFrac * 100)}
              displayPct={d.earned_pct}
              color="var(--color-variance-favourable)"
            />
            <Bar
              label="Actual vs Budget"
              percent={actualFrac * 100}
              displayPct={d.budget_hrs > 0 ? d.actual_hrs / d.budget_hrs : 0}
              color={overActual ? 'var(--color-variance-unfavourable)' : 'var(--color-accent)'}
            />
          </Card>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'favourable' | 'unfavourable' | 'neutral';
}) {
  const colour =
    tone === 'favourable'
      ? 'var(--color-variance-favourable)'
      : tone === 'unfavourable'
        ? 'var(--color-variance-unfavourable)'
        : 'var(--color-text)';
  return (
    <div>
      <div className="is-stat-label">{label}</div>
      <div className="font-mono font-medium" style={{ color: colour }}>
        {value}
      </div>
    </div>
  );
}

function Bar({
  label,
  percent,
  displayPct,
  color,
}: {
  label: string;
  percent: number;
  displayPct: number;
  color: string;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[color:var(--color-text-muted)]">{label}</span>
        <span className="font-mono">{fmt.pct(displayPct)}</span>
      </div>
      <div
        className="rounded-full h-2 overflow-hidden"
        style={{ background: 'var(--color-raised)' }}
      >
        <div
          className="h-full transition-[width]"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color }}
        />
      </div>
    </div>
  );
}
