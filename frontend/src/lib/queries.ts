import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './auth';

export type UserRole = 'admin' | 'pm' | 'pc_reviewer' | 'editor' | 'viewer';

export type AppUser = {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
};

/**
 * Current user's app_users row. Drives role-based UI gating across modules.
 * Server-side assert_role enforces the real authorization.
 */
export function useCurrentUser() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['current-user', user?.id] as const,
    enabled: !!user?.id,
    queryFn: async (): Promise<AppUser | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('app_users')
        .select('id, tenant_id, email, display_name, role')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as AppUser | null;
    },
  });
}

const roleRank: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  pc_reviewer: 3,
  pm: 4,
  admin: 5,
};

export function hasRole(current: UserRole | undefined | null, min: UserRole): boolean {
  if (!current) return false;
  return roleRank[current] >= roleRank[min];
}

export type DisciplineRollup = {
  discipline_id: string;
  discipline_code: string;
  display_name: string;
  records: number;
  budget_hrs: number;
  earned_hrs: number;
  actual_hrs: number;
  earned_pct: number;
  cpi: number | null;
};

export type ProjectSummary = {
  project_id: string;
  total_budget_hrs: number;
  total_earned_hrs: number;
  total_actual_hrs: number;
  overall_pct: number;
  cpi: number | null;
  spi: number | null;
  disciplines: DisciplineRollup[];
};

export type ProgressPeriod = {
  id: string;
  period_number: number;
  start_date: string;
  end_date: string;
  locked_at: string | null;
  bcws_hrs: number | null;
  bcwp_hrs: number | null;
  acwp_hrs: number | null;
};

export function useProjectSummary(projectId: string | null) {
  return useQuery({
    queryKey: ['project-summary', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectSummary> => {
      const { data, error } = await supabase.rpc('project_summary', { p_project_id: projectId });
      if (error) throw error;
      return data as ProjectSummary;
    },
  });
}

export type ProgressRecord = {
  id: string;
  rec_no: number;
  dwg: string;
  rev: string;
  description: string;
  uom: string;
  fld_qty: number;
  fld_whrs: number;
  status: string;
  discipline_id: string;
  discipline_code: string;
  discipline_name: string;
  coa_code: string;
  milestones: { seq: number; value: number }[];
  earn_pct: number;
  ern_qty: number;
  earn_whrs: number;
};

export type RocMilestone = { seq: number; label: string; weight: number };

export function useProgressRecords(projectId: string | null) {
  return useQuery({
    queryKey: ['progress-records', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<ProgressRecord[]> => {
      // Pull records + milestones + discipline metadata + earned-value view in parallel.
      const [recordsRes, msRes, evRes] = await Promise.all([
        supabase
          .from('audit_records')
          .select(
            'id, rec_no, dwg, rev, description, uom, fld_qty, fld_whrs, status, discipline_id, project_disciplines!audit_records_discipline_id_fkey(discipline_code, display_name), coa_codes!audit_records_coa_code_id_fkey(code)',
          )
          .eq('project_id', projectId!)
          .order('rec_no'),
        supabase
          .from('audit_record_milestones')
          .select('record_id, seq, value'),
        supabase
          .from('v_audit_record_ev')
          .select('record_id, earn_pct, ern_qty, earn_whrs')
          .eq('project_id', projectId!),
      ]);

      if (recordsRes.error) throw recordsRes.error;
      if (msRes.error) throw msRes.error;
      if (evRes.error) throw evRes.error;

      const msByRecord = new Map<string, { seq: number; value: number }[]>();
      for (const row of msRes.data ?? []) {
        const arr = msByRecord.get(row.record_id) ?? [];
        arr.push({ seq: row.seq, value: Number(row.value) });
        msByRecord.set(row.record_id, arr);
      }

      const evByRecord = new Map<string, { earn_pct: number; ern_qty: number; earn_whrs: number }>();
      for (const row of evRes.data ?? []) {
        evByRecord.set(row.record_id, {
          earn_pct: Number(row.earn_pct),
          ern_qty: Number(row.ern_qty),
          earn_whrs: Number(row.earn_whrs),
        });
      }

      return (recordsRes.data ?? []).map((r) => {
        const pd = (r as unknown as { project_disciplines: { discipline_code: string; display_name: string } | null }).project_disciplines;
        const coa = (r as unknown as { coa_codes: { code: string } | null }).coa_codes;
        const ms = (msByRecord.get(r.id) ?? []).sort((a, b) => a.seq - b.seq);
        const ev = evByRecord.get(r.id) ?? { earn_pct: 0, ern_qty: 0, earn_whrs: 0 };
        return {
          id: r.id,
          rec_no: r.rec_no,
          dwg: r.dwg,
          rev: r.rev,
          description: r.description,
          uom: r.uom,
          fld_qty: Number(r.fld_qty),
          fld_whrs: Number(r.fld_whrs),
          status: r.status,
          discipline_id: r.discipline_id,
          discipline_code: pd?.discipline_code ?? '',
          discipline_name: pd?.display_name ?? '',
          coa_code: coa?.code ?? '',
          milestones: ms,
          ...ev,
        };
      });
    },
  });
}

export function useRocMilestonesForDiscipline(disciplineId: string | null) {
  return useQuery({
    queryKey: ['roc-milestones', disciplineId] as const,
    enabled: !!disciplineId,
    queryFn: async (): Promise<RocMilestone[]> => {
      const { data: pd, error: pdErr } = await supabase
        .from('project_disciplines')
        .select('roc_template_id')
        .eq('id', disciplineId!)
        .maybeSingle();
      if (pdErr) throw pdErr;
      if (!pd?.roc_template_id) return [];

      const { data, error } = await supabase
        .from('roc_milestones')
        .select('seq, label, weight')
        .eq('template_id', pd.roc_template_id)
        .order('seq');
      if (error) throw error;
      return (data ?? []).map((m) => ({
        seq: m.seq,
        label: m.label,
        weight: Number(m.weight),
      }));
    },
  });
}

export type ChangeOrder = {
  id: string;
  co_number: string;
  date: string;
  discipline_id: string | null;
  discipline_code: string | null;
  discipline_name: string | null;
  type: string;
  description: string;
  qty_change: number;
  uom: string;
  hrs_impact: number;
  status: 'draft' | 'pending' | 'pc_reviewed' | 'approved' | 'rejected';
  requested_by: string;
  rejection_reason: string | null;
};

export function useChangeOrders(projectId: string | null) {
  return useQuery({
    queryKey: ['change-orders', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<ChangeOrder[]> => {
      const { data, error } = await supabase
        .from('change_orders')
        .select(
          'id, co_number, date, discipline_id, type, description, qty_change, uom, hrs_impact, status, requested_by, rejection_reason, project_disciplines!change_orders_discipline_id_fkey(discipline_code, display_name)',
        )
        .eq('project_id', projectId!)
        .order('co_number');
      if (error) throw error;
      return (data ?? []).map((row) => {
        const pd = (row as unknown as { project_disciplines: { discipline_code: string; display_name: string } | null }).project_disciplines;
        return {
          id: row.id,
          co_number: row.co_number,
          date: row.date,
          discipline_id: row.discipline_id,
          discipline_code: pd?.discipline_code ?? null,
          discipline_name: pd?.display_name ?? null,
          type: row.type,
          description: row.description,
          qty_change: Number(row.qty_change),
          uom: row.uom,
          hrs_impact: Number(row.hrs_impact),
          status: row.status,
          requested_by: row.requested_by,
          rejection_reason: row.rejection_reason,
        };
      });
    },
  });
}

export function useBudgetRollup(projectId: string | null) {
  return useQuery({
    queryKey: ['budget-rollup', projectId] as const,
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('budget_rollup', { p_project_id: projectId });
      if (error) throw error;
      return data as {
        original_budget: number;
        current_budget: number;
        forecast_budget: number;
        approved_changes_hrs: number;
        pending_changes_hrs: number;
      };
    },
  });
}

export function useProgressPeriods(projectId: string | null) {
  return useQuery({
    queryKey: ['progress-periods', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<ProgressPeriod[]> => {
      const { data, error } = await supabase
        .from('progress_periods')
        .select('id, period_number, start_date, end_date, locked_at, bcws_hrs, bcwp_hrs, acwp_hrs')
        .eq('project_id', projectId!)
        .order('period_number');
      if (error) throw error;
      return (data ?? []) as ProgressPeriod[];
    },
  });
}
