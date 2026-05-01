import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { selectClass } from '@/components/ui/FormField';
import { useCurrentUser, hasRole, type UserRole } from '@/lib/queries';
import { InviteUserModal } from './InviteUserModal';

type TenantUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  status: string;
  created_at: string;
};

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  pm: 'PM',
  pc_reviewer: 'PC Reviewer',
  editor: 'Editor',
  viewer: 'Viewer',
};

export function UsersCard() {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canEdit = hasRole(me?.role, 'admin');
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data: users, isLoading } = useQuery({
    queryKey: ['tenant-users'] as const,
    queryFn: async (): Promise<TenantUser[]> => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, email, display_name, role, status, created_at')
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as TenantUser[];
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      const { error } = await supabase.rpc('admin_set_user_role', {
        p_user_id: userId,
        p_new_role: role,
        p_reason: null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-users'] }),
  });

  return (
    <Card padded={false}>
      <div className="px-6 pt-5">
        <CardHeader
          eyebrow="Tenant access"
          title="Users & invites"
          caption="People in this tenant. Inviting sends a Supabase Auth email with an /accept-invite link."
          actions={
            canEdit && (
              <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
                <Plus size={14} /> Invite
              </Button>
            )
          }
        />
      </div>
      <div className="overflow-x-auto">
        <table className="is-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Display name</th>
              <th style={{ width: 180 }}>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="text-center py-6">
                  <div className="is-skeleton mx-auto" style={{ width: '60%' }} />
                </td>
              </tr>
            )}
            {!isLoading &&
              (users ?? []).map((u) => {
                const isMe = u.id === me?.id;
                return (
                  <tr key={u.id}>
                    <td className="font-mono">
                      {u.email}
                      {isMe && (
                        <span className="is-chip is-chip-primary ml-2" style={{ fontSize: 10 }}>
                          You
                        </span>
                      )}
                    </td>
                    <td>{u.display_name ?? <span className="text-[color:var(--color-text-subtle)]">—</span>}</td>
                    <td>
                      {canEdit && !isMe ? (
                        <select
                          className={selectClass}
                          value={u.role}
                          onChange={(e) =>
                            setRole.mutate({ userId: u.id, role: e.target.value as UserRole })
                          }
                          disabled={setRole.isPending}
                          style={{ minHeight: 32, padding: '4px 28px 4px 10px', fontSize: 13 }}
                        >
                          {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="is-chip is-chip-neutral">{ROLE_LABEL[u.role]}</span>
                      )}
                    </td>
                    <td className="text-[color:var(--color-text-muted)]">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            {!isLoading && (users ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-[color:var(--color-text-muted)] py-6">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {setRole.error && (
        <div className="px-6 py-3 border-t border-[color:var(--color-line)]">
          <div className="is-toast is-toast-danger">{(setRole.error as Error).message}</div>
        </div>
      )}

      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </Card>
  );
}
