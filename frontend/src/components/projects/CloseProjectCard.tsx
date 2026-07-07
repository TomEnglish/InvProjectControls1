import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Close / reopen a project from Project Setup.
 *
 * Closing marks a finished project complete (active → closed): it drops out
 * of the main project switcher and reads as read-only. It does NOT delete
 * anything — the locked baseline and all history stay intact, and a mistaken
 * close is reversible via Reopen (closed → active). Both actions are pm+;
 * the RPCs re-assert the role and the required source status.
 *
 * Only rendered for active or closed projects — a draft has nothing to close.
 */
type Props = {
  projectId: string;
  status: string;
};

export function CloseProjectCard({ projectId, status }: Props) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['project', projectId] });
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['project-metadata', projectId] });
  };

  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('project_close', { p_project_id: projectId });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirming(false);
      invalidate();
    },
  });

  const reopen = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('project_reopen', { p_project_id: projectId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const isClosed = status === 'closed';
  const error = (close.error ?? reopen.error) as Error | null;

  return (
    <Card>
      <CardHeader
        eyebrow="Project lifecycle"
        title={isClosed ? 'Reopen project' : 'Close project'}
        caption={
          isClosed
            ? 'This project is closed. Its data is frozen — progress, uploads, change orders, ' +
              'and actuals are blocked at the database until it is reopened. Reopening returns ' +
              'it to Active with the locked baseline and all history untouched.'
            : 'Mark this project complete when work has finished. It drops out of the main ' +
              'project switcher and its data is frozen — no further progress, uploads, change ' +
              'orders, or actuals can be written until it is reopened. Nothing is deleted.'
        }
        actions={
          isClosed ? (
            <Button variant="primary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
              <RotateCcw size={14} /> {reopen.isPending ? 'Reopening…' : 'Reopen Project'}
            </Button>
          ) : confirming ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={close.isPending}>
                Cancel
              </Button>
              <Button variant="danger" disabled={close.isPending} onClick={() => close.mutate()}>
                {close.isPending ? 'Closing…' : 'Confirm — Close'}
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              <CheckCircle2 size={14} /> Mark Complete…
            </Button>
          )
        }
      />
      {error && <div className="is-toast is-toast-danger">{error.message}</div>}
    </Card>
  );
}
