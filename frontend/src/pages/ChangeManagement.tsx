import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useProjectStore } from '@/stores/project';
import {
  useChangeOrders,
  useBudgetRollup,
  useCurrentUser,
  hasRole,
  type ChangeOrder,
} from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/FormField';
import { StatusChip } from '@/components/ui/StatusChip';
import { fmt } from '@/lib/format';
import { ApprovalStepper } from '@/components/changes/ApprovalStepper';
import { NewChangeOrderModal } from '@/components/changes/NewChangeOrderModal';
import { CoDecisionModal, type CoDecisionKind } from '@/components/changes/CoDecisionModal';

function NoProject() {
  return (
    <Card>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Pick a project in the top bar to view change orders.
      </p>
    </Card>
  );
}

export function ChangeManagementPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();

  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [decision, setDecision] = useState<
    | { kind: CoDecisionKind; stage: 'pc_review' | 'approve'; coId: string; coNumber: string }
    | null
  >(null);

  const { data: cos, isLoading, error } = useChangeOrders(projectId);
  const { data: rollup } = useBudgetRollup(projectId);

  const filtered = useMemo(() => {
    if (!cos) return [];
    return statusFilter === 'All' ? cos : cos.filter((c) => c.status === statusFilter);
  }, [cos, statusFilter]);

  const selected = filtered.find((c) => c.id === selectedId) ?? null;

  const pcReview = useMutation({
    mutationFn: async ({ id, decision, notes }: { id: string; decision: CoDecisionKind; notes: string | null }) => {
      const { error } = await supabase.rpc('co_pc_review', {
        p_co_id: id,
        p_decision: decision,
        p_notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['change-orders', projectId] });
      qc.invalidateQueries({ queryKey: ['budget-rollup', projectId] });
      setDecision(null);
    },
  });

  const approve = useMutation({
    mutationFn: async ({ id, decision, notes }: { id: string; decision: CoDecisionKind; notes: string | null }) => {
      const { error } = await supabase.rpc('co_approve', {
        p_co_id: id,
        p_decision: decision,
        p_notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['change-orders', projectId] });
      qc.invalidateQueries({ queryKey: ['budget-rollup', projectId] });
      qc.invalidateQueries({ queryKey: ['project-summary', projectId] });
      setDecision(null);
    },
  });

  if (!projectId) return <NoProject />;
  if (isLoading) {
    return (
      <Card>
        <div className="h-[300px] bg-[color:var(--color-canvas)] rounded animate-pulse" />
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <div className="text-sm text-[color:var(--color-variance-unfavourable)]">
          {(error as Error).message}
        </div>
      </Card>
    );
  }

  const approvedHrs = rollup?.approved_changes_hrs ?? 0;
  const pendingHrs = rollup?.pending_changes_hrs ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <select
          aria-label="Status filter"
          className={inputClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="All">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="pc_reviewed">PC Reviewed</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <Button
          variant="primary"
          disabled={!hasRole(me?.role, 'editor')}
          onClick={() => setModalOpen(true)}
        >
          + New Change Order
        </Button>
      </div>

      <Card>
        <CardHeader title="Change Orders" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[color:var(--color-canvas)]">
                {['CO #', 'Date', 'Discipline', 'Type', 'Description', 'Qty', 'UOM', 'Hrs Impact', 'Status', 'Requested By', ''].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wide font-semibold text-[color:var(--color-text-muted)] border-b-2 border-[color:var(--color-line)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((co) => (
                <CoRow
                  key={co.id}
                  co={co}
                  selected={co.id === selectedId}
                  canPcReview={hasRole(me?.role, 'pc_reviewer')}
                  canApprove={hasRole(me?.role, 'pm')}
                  pcBusy={pcReview.isPending}
                  approveBusy={approve.isPending}
                  onSelect={() => setSelectedId(co.id === selectedId ? null : co.id)}
                  onPcReview={(kind) =>
                    setDecision({ kind, stage: 'pc_review', coId: co.id, coNumber: co.co_number })
                  }
                  onApprove={(kind) =>
                    setDecision({ kind, stage: 'approve', coId: co.id, coNumber: co.co_number })
                  }
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="px-3 py-6 text-center text-[color:var(--color-text-muted)] text-sm"
                  >
                    No change orders match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Impact Summary" />
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[color:var(--color-text-muted)] text-[11px] uppercase tracking-wide">
                <th className="text-left py-1"></th>
                <th className="text-right py-1">Approved</th>
                <th className="text-right py-1">Pending</th>
                <th className="text-right py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[color:var(--color-line)]">
                <td className="py-2">Hours Impact</td>
                <td className="text-right font-mono">{fmt.int(approvedHrs)}</td>
                <td className="text-right font-mono">{fmt.int(pendingHrs)}</td>
                <td className="text-right font-mono font-semibold">{fmt.int(approvedHrs + pendingHrs)}</td>
              </tr>
              {rollup && (
                <tr className="border-t border-[color:var(--color-line)]">
                  <td className="py-2">Budget Impact</td>
                  <td
                    className="text-right font-mono"
                    style={{ color: 'var(--color-variance-favourable)' }}
                  >
                    {rollup.original_budget > 0
                      ? fmt.pct(approvedHrs / rollup.original_budget)
                      : '—'}
                  </td>
                  <td
                    className="text-right font-mono"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    {rollup.original_budget > 0
                      ? fmt.pct(pendingHrs / rollup.original_budget)
                      : '—'}
                  </td>
                  <td className="text-right font-mono">
                    {rollup.original_budget > 0
                      ? fmt.pct((approvedHrs + pendingHrs) / rollup.original_budget)
                      : '—'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader
            title={selected ? `Approval Workflow — ${selected.co_number}` : 'Approval Workflow'}
          />
          <ApprovalStepper status={selected?.status ?? null} />
          {!selected && (
            <div className="mt-3 text-xs text-[color:var(--color-text-muted)]">
              Click a CO above to view its stage.
            </div>
          )}
        </Card>
      </div>

      <NewChangeOrderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        projectId={projectId}
      />

      {decision && (
        <CoDecisionModal
          open
          onClose={() => setDecision(null)}
          coNumber={decision.coNumber}
          verb={
            decision.kind === 'reject'
              ? 'Reject'
              : decision.stage === 'pc_review'
              ? 'Forward'
              : 'Approve'
          }
          decision={decision.kind}
          busy={pcReview.isPending || approve.isPending}
          onConfirm={(notes) => {
            if (decision.stage === 'pc_review') {
              pcReview.mutate({ id: decision.coId, decision: decision.kind, notes });
            } else {
              approve.mutate({ id: decision.coId, decision: decision.kind, notes });
            }
          }}
        />
      )}
    </div>
  );
}

function CoRow({
  co,
  selected,
  canPcReview,
  canApprove,
  pcBusy,
  approveBusy,
  onSelect,
  onPcReview,
  onApprove,
}: {
  co: ChangeOrder;
  selected: boolean;
  canPcReview: boolean;
  canApprove: boolean;
  pcBusy: boolean;
  approveBusy: boolean;
  onSelect: () => void;
  onPcReview: (decision: 'forward' | 'reject') => void;
  onApprove: (decision: 'forward' | 'reject') => void;
}) {
  const qtyColor =
    co.qty_change > 0
      ? 'var(--color-variance-favourable)'
      : co.qty_change < 0
      ? 'var(--color-variance-unfavourable)'
      : 'var(--color-text)';
  const hrsColor =
    co.hrs_impact > 0
      ? 'var(--color-variance-unfavourable)'
      : co.hrs_impact < 0
      ? 'var(--color-variance-favourable)'
      : 'var(--color-text)';

  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer border-b border-[color:var(--color-line)] ${
        selected ? 'bg-[color:var(--color-status-locked-bg)]' : 'hover:bg-[color:var(--color-canvas)]'
      }`}
    >
      <td className="px-3 py-2 font-mono"><strong>{co.co_number}</strong></td>
      <td className="px-3 py-2">{co.date}</td>
      <td className="px-3 py-2">{co.discipline_name ?? '—'}</td>
      <td className="px-3 py-2">{co.type}</td>
      <td className="px-3 py-2 max-w-md">{co.description}</td>
      <td className="px-3 py-2 text-right font-mono" style={{ color: qtyColor }}>
        {co.qty_change > 0 ? '+' : ''}
        {co.qty_change}
      </td>
      <td className="px-3 py-2">{co.uom}</td>
      <td className="px-3 py-2 text-right font-mono" style={{ color: hrsColor }}>
        {co.hrs_impact > 0 ? '+' : ''}
        {fmt.int(co.hrs_impact)}
      </td>
      <td className="px-3 py-2"><StatusChip kind={co.status} /></td>
      <td className="px-3 py-2">{co.requested_by}</td>
      <td
        className="px-3 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-1 flex-wrap">
          {co.status === 'pending' && canPcReview && (
            <>
              <Button size="sm" variant="success" disabled={pcBusy} onClick={() => onPcReview('forward')}>
                Forward
              </Button>
              <Button size="sm" variant="danger" disabled={pcBusy} onClick={() => onPcReview('reject')}>
                Reject
              </Button>
            </>
          )}
          {co.status === 'pc_reviewed' && canApprove && (
            <>
              <Button size="sm" variant="success" disabled={approveBusy} onClick={() => onApprove('forward')}>
                Approve
              </Button>
              <Button size="sm" variant="danger" disabled={approveBusy} onClick={() => onApprove('reject')}>
                Reject
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
