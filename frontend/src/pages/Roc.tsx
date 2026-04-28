import { useState } from 'react';
import { Pencil, SlidersHorizontal } from 'lucide-react';
import { useRocTemplates, useCurrentUser, hasRole, type RocTemplateRow } from '@/lib/queries';
import { RocTemplateModal } from '@/components/roc/RocTemplateModal';

const seqs = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function RocPage() {
  const { data: templates, isLoading, error } = useRocTemplates();
  const { data: me } = useCurrentUser();
  const canEdit = hasRole(me?.role, 'admin');

  const [editing, setEditing] = useState<RocTemplateRow | null>(null);

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
        Failed to load ROC templates: {(error as Error).message}
      </div>
    );
  }

  if ((templates ?? []).length === 0) {
    return (
      <div className="is-surface is-empty">
        <div className="is-empty-icon">
          <SlidersHorizontal size={28} />
        </div>
        <div className="is-empty-title">No ROC templates yet</div>
        <p className="is-empty-caption">
          ROC templates are seeded per discipline. Run <span className="font-mono">npm run seed:demo</span>{' '}
          to populate the library.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {templates!.map((tpl) => (
          <RocCard
            key={tpl.id}
            template={tpl}
            canEdit={canEdit}
            onEdit={() => setEditing(tpl)}
          />
        ))}
      </div>
      <RocTemplateModal
        open={!!editing}
        onClose={() => setEditing(null)}
        template={editing}
      />
    </div>
  );
}

function RocCard({
  template,
  canEdit,
  onEdit,
}: {
  template: RocTemplateRow;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const total = template.milestones.reduce((s, m) => s + m.weight, 0);
  const totalPct = total * 100;
  const totalOk = Math.abs(totalPct - 100) < 0.01;
  const totalChip = totalOk ? 'is-chip-success' : 'is-chip-danger';

  return (
    <div className="is-surface p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="is-eyebrow mb-1">{template.discipline_code}</div>
          <h3 className="text-base font-semibold leading-tight">{template.name}</h3>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
            v{template.version}
            {template.is_default && ' · Default'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`is-chip ${totalChip} font-mono`}>{totalPct.toFixed(2)}%</span>
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit template"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-soft)] transition-colors"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {seqs.map((seq) => {
          const m = template.milestones.find((x) => x.seq === seq);
          const weightPct = (m?.weight ?? 0) * 100;
          return (
            <div
              key={seq}
              className="rounded-md border p-2 text-center"
              style={{
                background: 'var(--color-raised)',
                borderColor: 'var(--color-line)',
              }}
            >
              <div className="text-[10px] uppercase tracking-wide font-bold text-[color:var(--color-text-muted)]">
                M{seq}
              </div>
              <div className="text-[11px] mt-0.5 h-8 overflow-hidden leading-tight text-[color:var(--color-text)]">
                {m?.label ?? '—'}
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
