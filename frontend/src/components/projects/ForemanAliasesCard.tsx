import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Unlink, Link2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { selectClass } from '@/components/ui/FormField';
import { useCurrentUser, hasRole, useForemanAliases } from '@/lib/queries';
import { useProjectStore } from '@/stores/project';

type TenantUser = { id: string; email: string; display_name: string | null };

export function ForemanAliasesCard() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canEdit = hasRole(me?.role, 'admin');
  const aliases = useForemanAliases();

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users-min'] as const,
    queryFn: async (): Promise<TenantUser[]> => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, email, display_name')
        .order('email');
      if (error) throw error;
      return (data ?? []) as TenantUser[];
    },
  });

  const { data: foremenInRecords } = useQuery({
    queryKey: ['foremen-in-records', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('progress_records')
        .select('foreman_name')
        .eq('project_id', projectId!)
        .not('foreman_name', 'is', null);
      if (error) throw error;
      const set = new Set<string>();
      for (const row of data ?? []) {
        const name = (row as { foreman_name: string | null }).foreman_name;
        if (name) set.add(name);
      }
      return Array.from(set).sort();
    },
  });

  const linkedNames = useMemo(
    () => new Set((aliases.data ?? []).map((a) => a.name.toLowerCase())),
    [aliases.data],
  );

  const unmatched = useMemo(
    () => (foremenInRecords ?? []).filter((n) => !linkedNames.has(n.toLowerCase())),
    [foremenInRecords, linkedNames],
  );

  const userById = useMemo(() => {
    const m = new Map<string, TenantUser>();
    for (const u of tenantUsers ?? []) m.set(u.id, u);
    return m;
  }, [tenantUsers]);

  const link = useMutation({
    mutationFn: async ({ name, userId }: { name: string; userId: string }) => {
      const { data: meRow, error: meErr } = await supabase
        .from('app_users')
        .select('tenant_id')
        .eq('id', me!.id)
        .single();
      if (meErr) throw meErr;
      const { error } = await supabase
        .from('foreman_aliases')
        .upsert(
          { tenant_id: meRow.tenant_id, name, user_id: userId, created_by: me!.id },
          { onConflict: 'tenant_id,name' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['foreman-aliases'] });
      qc.invalidateQueries({ queryKey: ['foremen-in-records', projectId] });
    },
  });

  const unlink = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('foreman_aliases').delete().eq('name', name);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['foreman-aliases'] });
      qc.invalidateQueries({ queryKey: ['foremen-in-records', projectId] });
    },
  });

  return (
    <Card padded={false}>
      <div className="px-6 pt-5">
        <CardHeader
          eyebrow="Foreman aliases"
          title="Linked names"
          caption="Map free-text foreman names from imports to tenant users."
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="border-r border-[color:var(--color-line)]">
          <div className="px-6 py-2 text-[10px] uppercase tracking-widest text-[color:var(--color-text-subtle)] font-bold border-b border-[color:var(--color-line)]">
            Linked ({(aliases.data ?? []).length})
          </div>
          <div>
            {(aliases.data ?? []).length === 0 && (
              <div className="px-6 py-6 text-sm text-[color:var(--color-text-muted)]">
                No aliases yet.
              </div>
            )}
            {(aliases.data ?? []).map((a) => {
              const user = userById.get(a.user_id);
              return (
                <div
                  key={`${a.name}-${a.user_id}`}
                  className="px-6 py-3 border-b border-[color:var(--color-line)] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm truncate">{a.name}</div>
                    <div className="text-xs text-[color:var(--color-text-muted)] truncate">
                      <Link2 size={11} className="inline mr-1" />
                      {user?.email ?? a.user_id}
                    </div>
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={unlink.isPending}
                      onClick={() => {
                        if (confirm(`Unlink ${a.name}?`)) unlink.mutate(a.name);
                      }}
                    >
                      <Unlink size={12} /> Unlink
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="px-6 py-2 text-[10px] uppercase tracking-widest text-[color:var(--color-text-subtle)] font-bold border-b border-[color:var(--color-line)]">
            Unmatched in this project ({unmatched.length})
          </div>
          {unmatched.length === 0 && (
            <div className="px-6 py-6 text-sm text-[color:var(--color-text-muted)]">
              Every foreman name in records is linked.
            </div>
          )}
          {unmatched.map((name) => (
            <UnmatchedRow
              key={name}
              name={name}
              users={tenantUsers ?? []}
              canEdit={canEdit}
              isPending={link.isPending}
              onLink={(userId) => link.mutate({ name, userId })}
            />
          ))}
        </div>
      </div>

      {(link.error || unlink.error) && (
        <div className="px-6 py-3 border-t border-[color:var(--color-line)]">
          <div className="is-toast is-toast-danger">
            {((link.error || unlink.error) as Error).message}
          </div>
        </div>
      )}
    </Card>
  );
}

function UnmatchedRow({
  name,
  users,
  canEdit,
  isPending,
  onLink,
}: {
  name: string;
  users: TenantUser[];
  canEdit: boolean;
  isPending: boolean;
  onLink: (userId: string) => void;
}) {
  const [userId, setUserId] = useState('');
  return (
    <div className="px-6 py-3 border-b border-[color:var(--color-line)] flex items-center gap-2">
      <div className="font-mono text-sm flex-1 truncate">{name}</div>
      {canEdit ? (
        <>
          <select
            className={selectClass}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            style={{ minWidth: 200 }}
          >
            <option value="">— pick user —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name ? `${u.display_name} (${u.email})` : u.email}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            disabled={!userId || isPending}
            onClick={() => onLink(userId)}
          >
            <Plus size={12} /> Link
          </Button>
        </>
      ) : (
        <span className="text-xs text-[color:var(--color-text-muted)]">Admin only</span>
      )}
    </div>
  );
}
