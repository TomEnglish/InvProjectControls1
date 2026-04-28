import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, inputClass, selectClass } from '@/components/ui/FormField';
import type { UserRole } from '@/lib/queries';

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: 'admin', label: 'Admin', hint: 'Full control. Locks baselines, edits COA/ROC, invites users.' },
  { value: 'pm', label: 'PM', hint: 'Approves change orders, closes projects.' },
  { value: 'pc_reviewer', label: 'PC Reviewer', hint: 'Forwards/rejects COs at the PC stage.' },
  { value: 'editor', label: 'Editor', hint: 'Updates milestones, submits COs.' },
  { value: 'viewer', label: 'Viewer', hint: 'Read-only.' },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function InviteUserModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('editor');
  const [success, setSuccess] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-invite-user', {
        body: {
          email: email.trim().toLowerCase(),
          display_name: displayName.trim() || null,
          role,
        },
      });
      // supabase-js returns a generic "non-2xx" Error on failure but stuffs
      // the response into error.context. Pull the real JSON body so the
      // toast shows the function's actual error message instead.
      if (error) {
        const ctx = (error as unknown as { context?: Response }).context;
        if (ctx && typeof ctx.clone === 'function') {
          try {
            const body = (await ctx.clone().json()) as { error?: string } | null;
            if (body?.error) throw new Error(body.error);
          } catch (e) {
            if (e instanceof Error && e.message) throw e;
          }
        }
        throw error;
      }
      const parsed = data as { ok?: boolean; error?: string } | null;
      if (parsed?.error) throw new Error(parsed.error);
      return parsed;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-users'] });
      setSuccess(`Invite sent to ${email}.`);
      setEmail('');
      setDisplayName('');
      setRole('editor');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    invite.mutate();
  };

  const handleClose = () => {
    invite.reset();
    setSuccess(null);
    setEmail('');
    setDisplayName('');
    setRole('editor');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Invite a user"
      caption="They'll receive an email link, set a password, and join this tenant with the role you pick."
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="Email" required>
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            required
            autoComplete="off"
          />
        </Field>

        <Field label="Display name" hint="Shown in audit logs and CO timelines.">
          <input
            className={inputClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Optional"
            autoComplete="off"
          />
        </Field>

        <Field label="Role" required hint={ROLES.find((r) => r.value === role)?.hint}>
          <select
            className={selectClass}
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            required
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        {success && <div className="is-toast is-toast-success">{success}</div>}
        {invite.error && (
          <div className="is-toast is-toast-danger">{(invite.error as Error).message}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={handleClose}>
            {success ? 'Close' : 'Cancel'}
          </Button>
          <Button type="submit" variant="primary" disabled={invite.isPending}>
            {invite.isPending ? 'Sending…' : success ? 'Send another' : 'Send invite'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
