import type { ChangeOrder } from '@/lib/queries';
import { Check } from 'lucide-react';

const STAGES = [
  { key: 'submitted', label: 'Field Request', desc: 'Originator submits CO' },
  { key: 'pc_review', label: 'PC Review', desc: 'Project Controls evaluates impact' },
  { key: 'pm_approval', label: 'PM Approval', desc: 'Project Manager approves/rejects' },
  { key: 'budget_update', label: 'Budget Update', desc: 'Current Budget adjusts automatically' },
] as const;

function stageIndex(status: ChangeOrder['status']) {
  switch (status) {
    case 'draft':
    case 'pending':
      return 0;
    case 'pc_reviewed':
      return 1;
    case 'approved':
      return 3;
    case 'rejected':
      return -1;
    default:
      return 0;
  }
}

export function ApprovalStepper({ status }: { status: ChangeOrder['status'] | null }) {
  const active = status ? stageIndex(status) : -2;
  const isRejected = status === 'rejected';

  return (
    <div>
      {STAGES.map((s, i) => {
        const reached = !isRejected && i < active;
        const current = !isRejected && i === active;
        const dotBg = reached
          ? 'var(--color-success)'
          : current
            ? 'var(--color-primary)'
            : 'var(--color-line-strong)';
        const labelColor = reached || current ? 'var(--color-text)' : 'var(--color-text-muted)';
        return (
          <div key={s.key}>
            <div className="flex items-start gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 text-white"
                style={{ background: dotBg }}
              >
                {reached ? <Check size={14} /> : i + 1}
              </div>
              <div className="pt-0.5">
                <div className="text-sm font-semibold" style={{ color: labelColor }}>
                  {s.label}
                </div>
                <div className="text-xs text-[color:var(--color-text-muted)] mt-0.5">{s.desc}</div>
              </div>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className="ml-[13px] my-1 w-px h-4"
                style={{ background: 'var(--color-line)' }}
              />
            )}
          </div>
        );
      })}
      {isRejected && (
        <div className="is-toast is-toast-danger mt-4">
          This change order was rejected.
        </div>
      )}
    </div>
  );
}
