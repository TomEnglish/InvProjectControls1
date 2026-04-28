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
import { selectClass } from '@/components/ui/FormField';
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
        <div className="is-skeleton" style={{ height: 280, width: '100%' }} />
      </Card>
    );
  }
  if (error) {
    return (
      <div className="is-toast is-toast-danger">{(error as Error).message}</div>
    );
  }

  const approvedHrs = rollup?.approved_changes_hrs ?? 0;
  const pendingHrs = rollup?.pending_changes_hrs ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <select
          aria-label="Status filter"
          className={selectClass}
          style={{ width: 200 }}
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

      <div className="is-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-[color:var(--color-line)]">
          <h3 className="text-sm font-semibold">Change Orders</h3>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
            Click a row to view its approval stage.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="is-table">
            <thead>
              <tr>
                <th>CO #</th>
                <th>Date</th>
                <th>Discipline</th>
                <th>Type</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th>UOM</th>
                <th style={{ textAlign: 'right' }}>Hrs Impact</th>
                <th>Status</th>
                <th>Requested By</th>
                <th></th>
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
                  <td colSpan={11} className="text-center text-[color:var(--color-text-muted)] py-6">
                    No change orders match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Impact Summary" />
          <div className="overflow-x-auto -mx-6 -mb-6 mt-2">
            <table className="is-table">
              <thead>
                <tr>
                  <th></th>
                  <th style={{ textAlign: 'right' }}>Approved</th>
                  <th style={{ textAlign: 'right' }}>Pending</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Hours Impact</td>
                  <td className="text-right font-mono">{fmt.int(approvedHrs)}</td>
                  <td className="text-right font-mono">{fmt.int(pendingHrs)}</td>
                  <td className="text-right font-mono font-semibold">
                    {fmt.int(approvedHrs + pendingHrs)}
                  </td>
                </tr>
                {rollup && (
                  <tr>
                    <td>Budget Impact</td>
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
                      style={{ color: 'var(--color-warn)' }}
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
          </div>
        </Card>

        <Card>
          <CardHeader
            title={selected ? `Approval Workflow — ${selected.co_number}` : 'Approval Workflow'}
          />
          <ApprovalStepper status={selected?.status ?? null} />
          {!selected && (
            <p className="mt-3 text-xs text-[color:var(--color-text-muted)]">
              Click a CO above to view its stage.
            </p>
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
      className="cursor-pointer"
      style={selected ? { background: 'var(--color-primary-soft)' } : undefined}
    >
      <td className="font-mono font-semibold">{co.co_number}</td>
      <td>{co.date}</td>
      <td>{co.discipline_name ?? '—'}</td>
      <td className="capitalize">{co.type.replace(/_/g, ' ')}</td>
      <td className="max-w-md">{co.description}</td>
      <td className="text-right font-mono" style={{ color: qtyColor }}>
        {co.qty_change > 0 ? '+' : ''}
        {co.qty_change}
      </td>
      <td>{co.uom}</td>
      <td className="text-right font-mono" style={{ color: hrsColor }}>
        {co.hrs_impact > 0 ? '+' : ''}
        {fmt.int(co.hrs_impact)}
      </td>
      <td>
        <StatusChip kind={co.status} />
      </td>
      <td>{co.requested_by}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1 flex-wrap">
          {co.status === 'pending' && canPcReview && (
            <>
              <Button size="sm" variant="primary" disabled={pcBusy} onClick={() => onPcReview('forward')}>
                Forward
              </Button>
              <Button size="sm" variant="danger" disabled={pcBusy} onClick={() => onPcReview('reject')}>
                Reject
              </Button>
            </>
          )}
          {co.status === 'pc_reviewed' && canApprove && (
            <>
              <Button size="sm" variant="primary" disabled={approveBusy} onClick={() => onApprove('forward')}>
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
