import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './auth';

export type UserRole = 'super_admin' | 'admin' | 'pm' | 'pc_reviewer' | 'editor' | 'viewer';

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
  super_admin: 6,
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

export type RocMilestone = { seq: number; label: string; weight: number };

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
  drawing: string | null;
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
          'id, co_number, date, drawing, discipline_id, type, description, qty_change, uom, hrs_impact, status, requested_by, rejection_reason, project_disciplines!change_orders_discipline_id_fkey(discipline_code, display_name)',
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
          drawing: row.drawing ?? null,
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

// ─────────────────────────────────────────────────────────────────────
// Attachments — file metadata for audit records and change orders
// ─────────────────────────────────────────────────────────────────────
export type AttachmentEntity = 'audit_record' | 'change_order' | 'report';

export type AttachmentRow = {
  id: string;
  entity: AttachmentEntity;
  entity_id: string;
  path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

export function useAttachments(entity: AttachmentEntity, entityId: string | null) {
  return useQuery({
    queryKey: ['attachments', entity, entityId] as const,
    enabled: !!entityId,
    queryFn: async (): Promise<AttachmentRow[]> => {
      const { data, error } = await supabase
        .from('attachments')
        .select(
          'id, entity, entity_id, path, original_filename, mime_type, size_bytes, uploaded_by, uploaded_at',
        )
        .eq('entity', entity)
        .eq('entity_id', entityId!)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AttachmentRow[];
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// COA — Cost-of-account library
// ─────────────────────────────────────────────────────────────────────
export type CoaCodeRow = {
  id: string;
  prime: string;
  code: string;
  description: string;
  parent: string | null;
  level: number;
  uom: string;
  base_rate: number;
  pf_adj: number;
  pf_rate: number;
};

export function useCoaCodes() {
  return useQuery({
    queryKey: ['coa-codes'] as const,
    queryFn: async (): Promise<CoaCodeRow[]> => {
      const { data, error } = await supabase
        .from('coa_codes')
        .select('id, prime, code, description, parent, level, uom, base_rate, pf_adj, pf_rate')
        .order('code');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        base_rate: Number(r.base_rate),
        pf_adj: Number(r.pf_adj),
        pf_rate: Number(r.pf_rate),
      })) as CoaCodeRow[];
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// ROC — Rules of Credit templates
// ─────────────────────────────────────────────────────────────────────
export type RocTemplateRow = {
  id: string;
  discipline_code: string;
  name: string;
  version: number;
  is_default: boolean;
  milestones: RocMilestone[];
};

export function useRocTemplates() {
  return useQuery({
    queryKey: ['roc-templates'] as const,
    queryFn: async (): Promise<RocTemplateRow[]> => {
      const { data: tpls, error: tplsErr } = await supabase
        .from('roc_templates')
        .select('id, discipline_code, name, version, is_default')
        .order('discipline_code');
      if (tplsErr) throw tplsErr;
      if (!tpls || tpls.length === 0) return [];

      const { data: ms, error: msErr } = await supabase
        .from('roc_milestones')
        .select('template_id, seq, label, weight')
        .in(
          'template_id',
          tpls.map((t) => t.id),
        )
        .order('seq');
      if (msErr) throw msErr;

      const byTpl = new Map<string, RocMilestone[]>();
      for (const m of ms ?? []) {
        const list = byTpl.get(m.template_id) ?? [];
        list.push({ seq: m.seq, label: m.label, weight: Number(m.weight) });
        byTpl.set(m.template_id, list);
      }

      return tpls.map((t) => ({
        ...t,
        milestones: byTpl.get(t.id) ?? [],
      }));
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

export type ProgressRow = {
  id: string;
  project_id: string;
  discipline_id: string | null;
  discipline_code: string | null;
  discipline_name: string | null;
  iwp_id: string | null;
  iwp_name: string | null;
  record_no: number | null;
  source_type: string;
  dwg: string | null;
  rev: string | null;
  code: string | null;
  description: string;
  uom: string;
  budget_qty: number | null;
  actual_qty: number | null;
  earned_qty: number | null;
  budget_hrs: number;
  actual_hrs: number;
  earned_hrs: number;
  percent_complete: number;
  status: string;
  foreman_user_id: string | null;
  foreman_name: string | null;
  attr_type: string | null;
  attr_size: string | null;
  attr_spec: string | null;
  line_area: string | null;
  milestones: { seq: number; value: number }[];
  earn_pct: number;
};

export function useProgressRows(projectId: string | null) {
  return useQuery({
    queryKey: ['progress-rows', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<ProgressRow[]> => {
      type RawRow = {
        id: string;
        project_id: string;
        discipline_id: string | null;
        iwp_id: string | null;
        record_no: number | null;
        source_type: string;
        dwg: string | null;
        rev: string | null;
        code: string | null;
        description: string;
        uom: string;
        budget_qty: number | string | null;
        actual_qty: number | string | null;
        earned_qty: number | string | null;
        budget_hrs: number | string;
        actual_hrs: number | string;
        earned_hrs: number | string;
        percent_complete: number | string;
        status: string;
        foreman_user_id: string | null;
        foreman_name: string | null;
        attr_type: string | null;
        attr_size: string | null;
        attr_spec: string | null;
        line_area: string | null;
        project_disciplines: { discipline_code: string; display_name: string } | null;
        iwps: { name: string } | null;
      };

      const [recordsRes, msRes, evRes] = await Promise.all([
        supabase
          .from('progress_records')
          .select(
            'id, project_id, discipline_id, iwp_id, record_no, source_type, dwg, rev, code, description, uom, ' +
              'budget_qty, actual_qty, earned_qty, budget_hrs, actual_hrs, earned_hrs, percent_complete, status, ' +
              'foreman_user_id, foreman_name, attr_type, attr_size, attr_spec, line_area, ' +
              'project_disciplines(discipline_code, display_name), iwps(name)',
          )
          .eq('project_id', projectId!)
          .order('dwg', { nullsFirst: false }),
        supabase
          .from('progress_record_milestones')
          .select('progress_record_id, seq, value'),
        supabase
          .from('v_progress_record_ev')
          .select('record_id, earn_pct')
          .eq('project_id', projectId!),
      ]);

      if (recordsRes.error) throw recordsRes.error;
      if (msRes.error) throw msRes.error;
      if (evRes.error) throw evRes.error;

      const msByRecord = new Map<string, { seq: number; value: number }[]>();
      for (const row of (msRes.data ?? []) as { progress_record_id: string; seq: number; value: number | string }[]) {
        const arr = msByRecord.get(row.progress_record_id) ?? [];
        arr.push({ seq: row.seq, value: Number(row.value) });
        msByRecord.set(row.progress_record_id, arr);
      }

      const evByRecord = new Map<string, number>();
      for (const row of (evRes.data ?? []) as { record_id: string; earn_pct: number | string }[]) {
        evByRecord.set(row.record_id, Number(row.earn_pct));
      }

      const rawRows = (recordsRes.data ?? []) as unknown as RawRow[];
      return rawRows.map((r) => {
        const ms = (msByRecord.get(r.id) ?? []).sort((a, b) => a.seq - b.seq);
        return {
          id: r.id,
          project_id: r.project_id,
          discipline_id: r.discipline_id,
          discipline_code: r.project_disciplines?.discipline_code ?? null,
          discipline_name: r.project_disciplines?.display_name ?? null,
          iwp_id: r.iwp_id,
          iwp_name: r.iwps?.name ?? null,
          record_no: r.record_no,
          source_type: r.source_type,
          dwg: r.dwg,
          rev: r.rev,
          code: r.code,
          description: r.description,
          uom: r.uom,
          budget_qty: r.budget_qty != null ? Number(r.budget_qty) : null,
          actual_qty: r.actual_qty != null ? Number(r.actual_qty) : null,
          earned_qty: r.earned_qty != null ? Number(r.earned_qty) : null,
          budget_hrs: Number(r.budget_hrs),
          actual_hrs: Number(r.actual_hrs),
          earned_hrs: Number(r.earned_hrs),
          percent_complete: Number(r.percent_complete),
          status: r.status,
          foreman_user_id: r.foreman_user_id,
          foreman_name: r.foreman_name,
          attr_type: r.attr_type,
          attr_size: r.attr_size,
          attr_spec: r.attr_spec,
          line_area: r.line_area,
          milestones: ms,
          earn_pct: evByRecord.get(r.id) ?? Number(r.percent_complete) / 100,
        };
      });
    },
  });
}

export type ProjectMetrics = {
  project_id: string;
  total_records: number;
  total_budget_hrs: number;
  total_earned_hrs: number;
  total_actual_hrs: number;
  percent_complete: number;
  cpi: number | null;
  spi: number | null;
  sv: number;
};

export function useProjectMetrics(projectId: string | null) {
  return useQuery({
    queryKey: ['project-metrics', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectMetrics | null> => {
      const { data, error } = await supabase.rpc('project_metrics', { p_project_id: projectId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      // RPC returns percent_complete in 0..100; normalize to 0..1 to match
      // fmt.pct and the chart/table consumers below.
      return {
        project_id: row.project_id,
        total_records: Number(row.total_records),
        total_budget_hrs: Number(row.total_budget_hrs),
        total_earned_hrs: Number(row.total_earned_hrs),
        total_actual_hrs: Number(row.total_actual_hrs),
        percent_complete: Number(row.percent_complete) / 100,
        cpi: row.cpi != null ? Number(row.cpi) : null,
        spi: row.spi != null ? Number(row.spi) : null,
        sv: Number(row.sv),
      };
    },
  });
}

export type DisciplineMetric = {
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

export function useDisciplineMetrics(projectId: string | null) {
  return useQuery({
    queryKey: ['discipline-metrics', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<DisciplineMetric[]> => {
      const { data, error } = await supabase.rpc('discipline_metrics', { p_project_id: projectId });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        discipline_id: r.discipline_id as string,
        discipline_code: r.discipline_code as string,
        display_name: r.display_name as string,
        records: Number(r.records),
        budget_hrs: Number(r.budget_hrs),
        earned_hrs: Number(r.earned_hrs),
        actual_hrs: Number(r.actual_hrs),
        // RPC returns earned_pct 0..100; normalize to 0..1 to match chart consumers.
        earned_pct: Number(r.earned_pct) / 100,
        cpi: r.cpi != null ? Number(r.cpi) : null,
      }));
    },
  });
}

/**
 * Per-discipline metrics computed against a frozen snapshot. Same shape as
 * useDisciplineMetrics, but source rows come from progress_snapshot_items
 * for the named snapshot.
 */
export function useDisciplineMetricsAtSnapshot(snapshotId: string | null) {
  return useQuery({
    queryKey: ['discipline-metrics-at-snapshot', snapshotId] as const,
    enabled: !!snapshotId,
    queryFn: async (): Promise<DisciplineMetric[]> => {
      const { data, error } = await supabase.rpc('discipline_metrics_at_snapshot', {
        p_snapshot_id: snapshotId,
      });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        discipline_id: r.discipline_id as string,
        discipline_code: r.discipline_code as string,
        display_name: r.display_name as string,
        records: Number(r.records),
        budget_hrs: Number(r.budget_hrs),
        earned_hrs: Number(r.earned_hrs),
        actual_hrs: Number(r.actual_hrs),
        earned_pct: Number(r.earned_pct) / 100,
        cpi: r.cpi != null ? Number(r.cpi) : null,
      }));
    },
  });
}

export type ProjectQtyRollup = {
  composite_pct: number;
  mode: 'hours_weighted' | 'equal' | 'custom';
};

export function useProjectQtyRollup(projectId: string | null) {
  return useQuery({
    queryKey: ['project-qty-rollup', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectQtyRollup | null> => {
      const { data, error } = await supabase.rpc('project_qty_rollup', { p_project_id: projectId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      // composite_pct comes back 0..100; normalize to 0..1.
      return {
        composite_pct: Number(row.composite_pct) / 100,
        mode: row.mode as ProjectQtyRollup['mode'],
      };
    },
  });
}

export type Snapshot = {
  id: string;
  kind: 'weekly' | 'baseline_first_audit';
  snapshot_date: string;
  week_ending: string | null;
  label: string;
  total_budget_hrs: number | null;
  total_earned_hrs: number | null;
  total_actual_hrs: number | null;
  cpi: number | null;
  spi: number | null;
};

export function useSnapshots(projectId: string | null) {
  return useQuery({
    queryKey: ['snapshots', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<Snapshot[]> => {
      const { data, error } = await supabase.rpc('list_snapshots', { p_project_id: projectId });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        kind: r.kind as Snapshot['kind'],
        snapshot_date: r.snapshot_date as string,
        week_ending: (r.week_ending as string | null) ?? null,
        label: r.label as string,
        total_budget_hrs: r.total_budget_hrs != null ? Number(r.total_budget_hrs) : null,
        total_earned_hrs: r.total_earned_hrs != null ? Number(r.total_earned_hrs) : null,
        total_actual_hrs: r.total_actual_hrs != null ? Number(r.total_actual_hrs) : null,
        cpi: r.cpi != null ? Number(r.cpi) : null,
        spi: r.spi != null ? Number(r.spi) : null,
      }));
    },
  });
}

export type SnapshotComparisonRow = {
  progress_record_id: string;
  dwg: string | null;
  description: string;
  pct_a: number;
  pct_b: number;
  delta_pct: number;
  earned_hrs_a: number;
  earned_hrs_b: number;
  delta_earned_hrs: number;
};

export function useSnapshotComparison(
  projectId: string | null,
  snapshotA: string | null,
  snapshotB: string | null,
) {
  return useQuery({
    queryKey: ['snapshot-comparison', projectId, snapshotA, snapshotB] as const,
    enabled: !!projectId && !!snapshotA && !!snapshotB,
    queryFn: async (): Promise<SnapshotComparisonRow[]> => {
      const { data, error } = await supabase.rpc('period_comparison', {
        p_project_id: projectId,
        p_snapshot_a: snapshotA,
        p_snapshot_b: snapshotB,
      });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        progress_record_id: r.progress_record_id as string,
        dwg: (r.dwg as string | null) ?? null,
        description: r.description as string,
        pct_a: Number(r.pct_a),
        pct_b: Number(r.pct_b),
        delta_pct: Number(r.delta_pct),
        earned_hrs_a: Number(r.earned_hrs_a),
        earned_hrs_b: Number(r.earned_hrs_b),
        delta_earned_hrs: Number(r.delta_earned_hrs),
      }));
    },
  });
}

export type Iwp = {
  id: string;
  project_id: string;
  discipline_id: string | null;
  name: string;
};

export function useIwps(projectId: string | null) {
  return useQuery({
    queryKey: ['iwps', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<Iwp[]> => {
      const { data, error } = await supabase
        .from('iwps')
        .select('id, project_id, discipline_id, name')
        .eq('project_id', projectId!)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Iwp[];
    },
  });
}

/**
 * Composer hook returning a `ProjectSummary`-shaped value built from the
 * project_metrics + discipline_metrics RPCs. Lets Dashboard / Reports /
 * Budget share one chart/table prop shape.
 */
export function useDashboardSummary(projectId: string | null) {
  const metrics = useProjectMetrics(projectId);
  const disciplines = useDisciplineMetrics(projectId);
  return {
    isLoading: metrics.isLoading || disciplines.isLoading,
    error: (metrics.error ?? disciplines.error) as Error | null,
    data:
      metrics.data && disciplines.data
        ? ({
            project_id: metrics.data.project_id,
            total_budget_hrs: metrics.data.total_budget_hrs,
            total_earned_hrs: metrics.data.total_earned_hrs,
            total_actual_hrs: metrics.data.total_actual_hrs,
            overall_pct: metrics.data.percent_complete,
            cpi: metrics.data.cpi,
            spi: metrics.data.spi,
            disciplines: disciplines.data.map((d) => ({
              discipline_id: d.discipline_id,
              discipline_code: d.discipline_code,
              display_name: d.display_name,
              records: d.records,
              budget_hrs: d.budget_hrs,
              earned_hrs: d.earned_hrs,
              actual_hrs: d.actual_hrs,
              earned_pct: d.earned_pct,
              cpi: d.cpi,
            })),
          } satisfies ProjectSummary)
        : null,
  };
}

/**
 * Composer hook returning a `ProjectSummary` for a specific snapshot.
 * Project-level totals come from the snapshot row directly; per-discipline
 * rollup comes from discipline_metrics_at_snapshot. Used by the Reports
 * "as of" date selector.
 *
 * Caller passes projectId explicitly because list_snapshots doesn't return
 * it (and faking with empty string is a footgun for downstream consumers).
 */
export function useDashboardSummaryAtSnapshot(
  snapshot: Snapshot | null,
  projectId: string | null,
) {
  const disciplines = useDisciplineMetricsAtSnapshot(snapshot?.id ?? null);
  return {
    isLoading: disciplines.isLoading,
    error: disciplines.error as Error | null,
    data:
      snapshot && disciplines.data && projectId
        ? ({
            project_id: projectId,
            total_budget_hrs: snapshot.total_budget_hrs ?? 0,
            total_earned_hrs: snapshot.total_earned_hrs ?? 0,
            total_actual_hrs: snapshot.total_actual_hrs ?? 0,
            overall_pct:
              snapshot.total_budget_hrs && snapshot.total_budget_hrs > 0
                ? (snapshot.total_earned_hrs ?? 0) / snapshot.total_budget_hrs
                : 0,
            cpi: snapshot.cpi,
            spi: snapshot.spi,
            disciplines: disciplines.data,
          } satisfies ProjectSummary)
        : null,
  };
}

export type ForemanAlias = {
  tenant_id: string;
  name: string;
  user_id: string;
  created_at: string;
};

export function useForemanAliases() {
  return useQuery({
    queryKey: ['foreman-aliases'] as const,
    queryFn: async (): Promise<ForemanAlias[]> => {
      const { data, error } = await supabase
        .from('foreman_aliases')
        .select('tenant_id, name, user_id, created_at')
        .order('name');
      if (error) throw error;
      return (data ?? []) as ForemanAlias[];
    },
  });
}

/**
 * Set of coa_code_ids enabled for a given project. Empty set means
 * the project hasn't been scoped yet; consumers may treat that as
 * "all codes available" until scoping happens.
 */
export function useProjectCoaCodes(projectId: string | null) {
  return useQuery({
    queryKey: ['project-coa-codes', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('project_coa_codes')
        .select('coa_code_id')
        .eq('project_id', projectId!)
        .eq('enabled', true);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.coa_code_id as string));
    },
  });
}
