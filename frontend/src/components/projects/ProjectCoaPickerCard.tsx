import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/FormField';
import {
  useCurrentUser,
  useCoaCodes,
  useProjectCoaCodes,
  hasRole,
} from '@/lib/queries';

type Props = { projectId: string };

export function ProjectCoaPickerCard({ projectId }: Props) {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canEdit = hasRole(me?.role, 'admin');

  const codes = useCoaCodes();
  const selected = useProjectCoaCodes(projectId);

  const [search, setSearch] = useState('');
  const [showOnlySelected, setShowOnlySelected] = useState(false);

  const filtered = useMemo(() => {
    const all = codes.data ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((c) => {
      if (showOnlySelected && !selected.data?.has(c.id)) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.prime.toLowerCase().includes(q)
      );
    });
  }, [codes.data, selected.data, search, showOnlySelected]);

  const toggle = useMutation({
    mutationFn: async ({ coaCodeId, enable }: { coaCodeId: string; enable: boolean }) => {
      if (!me) throw new Error('not signed in');
      if (enable) {
        const { error } = await supabase
          .from('project_coa_codes')
          .upsert(
            {
              tenant_id: me.tenant_id,
              project_id: projectId,
              coa_code_id: coaCodeId,
              enabled: true,
              created_by: me.id,
            },
            { onConflict: 'project_id,coa_code_id' },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('project_coa_codes')
          .delete()
          .eq('project_id', projectId)
          .eq('coa_code_id', coaCodeId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-coa-codes', projectId] }),
  });

  const selectAllVisible = useMutation({
    mutationFn: async (visible: { id: string }[]) => {
      if (!me) throw new Error('not signed in');
      const rows = visible
        .filter((c) => !selected.data?.has(c.id))
        .map((c) => ({
          tenant_id: me.tenant_id,
          project_id: projectId,
          coa_code_id: c.id,
          enabled: true,
          created_by: me.id,
        }));
      if (rows.length === 0) return;
      const { error } = await supabase
        .from('project_coa_codes')
        .upsert(rows, { onConflict: 'project_id,coa_code_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-coa-codes', projectId] }),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('project_coa_codes')
        .delete()
        .eq('project_id', projectId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-coa-codes', projectId] }),
  });

  const selectedCount = selected.data?.size ?? 0;
  const totalCount = codes.data?.length ?? 0;

  return (
    <Card padded={false}>
      <div className="px-6 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <CardHeader
          eyebrow="COA scope"
          title="Codes in scope for this project"
          caption={
            selectedCount === 0
              ? 'Pick the COA codes that apply to this project. Other surfaces will dim out-of-scope codes.'
              : `${selectedCount} of ${totalCount} codes selected for this project.`
          }
        />
        {canEdit && selectedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearAll.mutate()}
            disabled={clearAll.isPending}
          >
            Clear all
          </Button>
        )}
      </div>

      <div className="px-6 pb-3 flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--color-text-muted)]"
          />
          <input
            className={`${inputClass} pl-8 w-72`}
            placeholder="Search code, description, or prime…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <label className="text-xs flex items-center gap-1.5 text-[color:var(--color-text-muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={showOnlySelected}
            onChange={(e) => setShowOnlySelected(e.target.checked)}
          />
          Show only selected
        </label>

        {canEdit && filtered.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectAllVisible.mutate(filtered)}
            disabled={selectAllVisible.isPending}
          >
            Select visible ({filtered.length})
          </Button>
        )}
      </div>

      {codes.isLoading || selected.isLoading ? (
        <div className="px-6 pb-6">
          <div className="is-skeleton" style={{ height: 240, width: '100%' }} />
        </div>
      ) : (
        <div className="overflow-x-auto" style={{ maxHeight: 480 }}>
          <table className="is-table">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--color-surface)' }}>
              <tr>
                <th style={{ width: 50 }}>In scope</th>
                <th>Code</th>
                <th>Description</th>
                <th>Prime</th>
                <th>UOM</th>
                <th className="text-right">PF rate</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-[color:var(--color-text-muted)] py-8">
                    {totalCount === 0 ? 'No COA codes in this tenant yet.' : 'No codes match your filter.'}
                  </td>
                </tr>
              )}
              {filtered.map((c) => {
                const isSelected = selected.data?.has(c.id) ?? false;
                return (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!canEdit || toggle.isPending}
                        onChange={(e) =>
                          toggle.mutate({ coaCodeId: c.id, enable: e.target.checked })
                        }
                        aria-label={`Toggle code ${c.code}`}
                      />
                    </td>
                    <td className="font-mono font-semibold">{c.code}</td>
                    <td>{c.description}</td>
                    <td className="font-mono">{c.prime}</td>
                    <td>{c.uom}</td>
                    <td className="text-right font-mono">{c.pf_rate.toFixed(4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(toggle.error || selectAllVisible.error || clearAll.error) && (
        <div className="px-6 pb-4">
          <div className="is-toast is-toast-danger">
            {((toggle.error ?? selectAllVisible.error ?? clearAll.error) as Error).message}
          </div>
        </div>
      )}
    </Card>
  );
}
