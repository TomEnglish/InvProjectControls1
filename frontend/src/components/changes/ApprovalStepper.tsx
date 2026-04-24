import type { ChangeOrder } from '@/lib/queries';

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
    <div className="space-y-1.5">
      {STAGES.map((s, i) => {
        const reached = !isRejected && i <= active;
        const current = !isRejected && i === active;
        const bg = reached
          ? current
            ? 'var(--color-accent)'
            : 'var(--color-variance-favourable)'
          : 'var(--color-line)';
        return (
          <div key={s.key}>
            <div className="flex items-center gap-3">
              <div
                className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[11px] font-semibold"
                style={{ background: bg }}
              >
                {i + 1}
              </div>
              <div>
                <div className="text-sm font-semibold">{s.label}</div>
                <div className="text-xs text-[color:var(--color-text-muted)]">{s.desc}</div>
              </div>
            </div>
            {i < STAGES.length - 1 && (
              <div className="w-0.5 h-3 bg-[color:var(--color-line)] ml-[11px]" />
            )}
          </div>
        );
      })}
      {isRejected && (
        <div className="mt-3 text-xs text-[color:var(--color-status-pending-fg)] bg-[color:var(--color-status-pending-bg)] rounded-md px-3 py-2">
          Rejected.
        </div>
      )}
    </div>
  );
}
