import { useMemo, useState } from 'react';
import { Pencil, Printer, SlidersHorizontal, Star } from 'lucide-react';
import { useWorkTypes, useCurrentUser, hasRole, type WorkTypeRow } from '@/lib/queries';
import { WorkTypeModal } from '@/components/work-types/WorkTypeModal';
import { printWorkType } from '@/components/work-types/printWorkType';

const DISCIPLINE_DISPLAY: Record<string, string> = {
  CIVIL: 'Civil',
  PIPE: 'Pipe',
  STEEL: 'Steel',
  ELEC: 'Electrical',
  MECH: 'Mechanical',
  INST: 'Instrumentation',
  SITE: 'Site Work',
  FOUNDATIONS: 'Foundations',
};

const DISCIPLINE_ORDER = ['CIVIL', 'FOUNDATIONS', 'STEEL', 'PIPE', 'ELEC', 'MECH', 'INST', 'SITE'];

export function WorkTypesPage() {
  const { data: workTypes, isLoading, error } = useWorkTypes();
  const { data: me } = useCurrentUser();
  const canEdit = hasRole(me?.role, 'admin');

  const [editing, setEditing] = useState<WorkTypeRow | null>(null);

  const grouped = useMemo(() => {
    const byDisc = new Map<string, WorkTypeRow[]>();
    for (const wt of workTypes ?? []) {
      const arr = byDisc.get(wt.discipline_code) ?? [];
      arr.push(wt);
      byDisc.set(wt.discipline_code, arr);
    }
    return DISCIPLINE_ORDER
      .filter((d) => byDisc.has(d))
      .map((d) => ({ discipline: d, items: byDisc.get(d)! }));
  }, [workTypes]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="is-surface p-6">
            <div className="is-skeleton mb-3" style={{ width: '40%' }} />
            <div className="is-skeleton" style={{ height: 120, width: '100%' }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load work types: {(error as Error).message}
      </div>
    );
  }

  if ((workTypes ?? []).length === 0) {
    return (
      <div className="is-surface is-empty">
        <div className="is-empty-icon">
          <SlidersHorizontal size={28} />
        </div>
        <div className="is-empty-title">No work types yet</div>
        <p className="is-empty-caption">
          Work types are seeded from the senior SME's Unified Audit Workbook on
          first migration. If you're seeing this, the seed ran on a tenant that
          didn't exist when migration 20260511000001 was applied — run{' '}
          <span className="font-mono">npm run seed:demo</span> or re-apply the
          migration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(({ discipline, items }) => (
        <section key={discipline}>
          <div className="is-eyebrow mb-2">
            {DISCIPLINE_DISPLAY[discipline] ?? discipline}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {items.map((wt) => (
              <WorkTypeCard
                key={wt.id}
                workType={wt}
                canEdit={canEdit}
                onEdit={() => setEditing(wt)}
              />
            ))}
          </div>
        </section>
      ))}

      <WorkTypeModal
        open={!!editing}
        onClose={() => setEditing(null)}
        workType={editing}
      />
    </div>
  );
}

function WorkTypeCard({
  workType,
  canEdit,
  onEdit,
}: {
  workType: WorkTypeRow;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const total = workType.milestones.reduce((s, m) => s + m.weight, 0);
  const totalPct = total * 100;
  const totalOk = Math.abs(totalPct - 100) < 0.01;
  const totalChip = totalOk ? 'is-chip-success' : 'is-chip-danger';

  return (
    <div className="is-surface p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-mono font-bold tracking-tight">
              {workType.work_type_code}
            </h3>
            {workType.is_default && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide font-bold"
                style={{ color: 'var(--color-primary)' }}
                title="Discipline default"
              >
                <Star size={10} fill="currentColor" /> Default
              </span>
            )}
          </div>
          <p className="text-sm text-[color:var(--color-text-muted)] mt-0.5">
            {workType.description}
          </p>
          <p className="text-xs text-[color:var(--color-text-subtle)] mt-0.5">
            v{workType.version} · {workType.milestones.length} milestone
            {workType.milestones.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`is-chip ${totalChip} font-mono`}>{totalPct.toFixed(2)}%</span>
          <button
            type="button"
            onClick={() => printWorkType(workType)}
            aria-label="Print work type"
            title="Print or save as PDF"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-soft)] transition-colors"
          >
            <Printer size={14} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit work type"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-soft)] transition-colors"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {workType.milestones.map((m) => {
          const weightPct = m.weight * 100;
          return (
            <div
              key={m.seq}
              className="rounded-md border p-2 text-center"
              style={{
                background: 'var(--color-raised)',
                borderColor: 'var(--color-line)',
              }}
            >
              <div className="text-[10px] uppercase tracking-wide font-bold text-[color:var(--color-text-muted)]">
                M{m.seq}
              </div>
              <div className="text-[11px] mt-0.5 h-8 overflow-hidden leading-tight text-[color:var(--color-text)]">
                {m.label}
              </div>
              <div className="text-xs mt-1 font-mono font-semibold text-[color:var(--color-primary)]">
                {weightPct.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
