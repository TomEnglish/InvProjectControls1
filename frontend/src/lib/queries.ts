import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './auth';

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'pm'
  | 'pc_reviewer'
  | 'editor'
  | 'clerk'
  | 'viewer';

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

// Rank order MUST match the PG assert_role ladder
// (supabase/migrations/20260515000001_assert_role_v3.sql). Clerks sit
// between viewer and editor — they have read access plus a narrow INSERT
// right on upload_queue via SECURITY DEFINER RPC, but no live-table writes.
const roleRank: Record<UserRole, number> = {
  viewer: 1,
  clerk: 2,
  editor: 3,
  pc_reviewer: 4,
  pm: 5,
  admin: 6,
  super_admin: 7,
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

export type WorkTypeMilestone = { seq: number; label: string; weight: number };

/**
 * Milestones for the work_type assigned to a record. Falls back to the
 * discipline's default_work_type_id if the record's own work_type_id is
 * null — the same fallback the v_progress_record_ev view applies.
 */
export function useWorkTypeMilestonesForRecord(
  workTypeId: string | null,
  disciplineId: string | null,
) {
  return useQuery({
    queryKey: ['work-type-milestones-for-record', workTypeId, disciplineId] as const,
    enabled: !!(workTypeId || disciplineId),
    queryFn: async (): Promise<WorkTypeMilestone[]> => {
      let resolved = workTypeId;
      if (!resolved && disciplineId) {
        const { data: pd, error: pdErr } = await supabase
          .from('project_disciplines')
          .select('default_work_type_id')
          .eq('id', disciplineId)
          .maybeSingle();
        if (pdErr) throw pdErr;
        resolved = pd?.default_work_type_id ?? null;
      }
      if (!resolved) return [];

      const { data, error } = await supabase
        .from('work_type_milestones')
        .select('seq, label, weight')
        .eq('work_type_id', resolved)
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
// Work Types — finer-grained ROC template per the unified workbook
// ─────────────────────────────────────────────────────────────────────
export type WorkTypeRow = {
  id: string;
  work_type_code: string;
  discipline_code: string;
  description: string;
  version: number;
  is_default: boolean;
  milestones: WorkTypeMilestone[];
};

export function useWorkTypes() {
  return useQuery({
    queryKey: ['work-types'] as const,
    queryFn: async (): Promise<WorkTypeRow[]> => {
      const { data: tpls, error: tplsErr } = await supabase
        .from('work_types')
        .select('id, work_type_code, discipline_code, description, version, is_default')
        .order('discipline_code')
        .order('work_type_code');
      if (tplsErr) throw tplsErr;
      if (!tpls || tpls.length === 0) return [];

      const { data: ms, error: msErr } = await supabase
        .from('work_type_milestones')
        .select('work_type_id, seq, label, weight')
        .in(
          'work_type_id',
          tpls.map((t) => t.id),
        )
        .order('seq');
      if (msErr) throw msErr;

      const byTpl = new Map<string, WorkTypeMilestone[]>();
      for (const m of ms ?? []) {
        const list = byTpl.get(m.work_type_id) ?? [];
        list.push({ seq: m.seq, label: m.label, weight: Number(m.weight) });
        byTpl.set(m.work_type_id, list);
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
  tag_no: string | null;
  spool_fr: string | null;
  uom: string;
  work_type_id: string | null;
  work_type_code: string | null;
  work_type_description: string | null;
  discipline_label: string | null;
  service: string | null;
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
  // Audit-file columns persisted as of 20260508000004. All nullable —
  // populated when records arrive via Sandra's per-discipline templates,
  // null for records created via the New Record modal unless typed in.
  sched_id: string | null;
  system: string | null;
  carea: string | null;
  var_area: string | null;
  test_pkg: string | null;
  cwp: string | null;
  spl_cnt: number | null;
  gen_foreman_name: string | null;
  paint_spec: string | null;
  insu_spec: string | null;
  heat_trace_spec: string | null;
  ta_bank: string | null;
  ta_bay: string | null;
  ta_level: string | null;
  pslip: string | null;
  earned_qty_imported: number | null;
  earn_whrs_imported: number | null;
  whrs_unit: number | null; // generated column: budget_hrs / budget_qty
  source_row: number | null;
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
        tag_no: string | null;
        spool_fr: string | null;
        uom: string;
        work_type_id: string | null;
        discipline_label: string | null;
        service: string | null;
        work_types: { work_type_code: string; description: string } | null;
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
        sched_id: string | null;
        system: string | null;
        carea: string | null;
        var_area: string | null;
        test_pkg: string | null;
        cwp: string | null;
        spl_cnt: number | null;
        gen_foreman_name: string | null;
        paint_spec: string | null;
        insu_spec: string | null;
        heat_trace_spec: string | null;
        ta_bank: string | null;
        ta_bay: string | null;
        ta_level: string | null;
        pslip: string | null;
        earned_qty_imported: number | string | null;
        earn_whrs_imported: number | string | null;
        whrs_unit: number | string | null;
        source_row: number | null;
        project_disciplines: { discipline_code: string; display_name: string } | null;
        iwps: { name: string } | null;
      };

      const [recordsRes, msRes, evRes] = await Promise.all([
        supabase
          .from('progress_records')
          .select(
            'id, project_id, discipline_id, iwp_id, record_no, source_row, source_type, dwg, rev, code, description, ' +
              'tag_no, spool_fr, uom, ' +
              'budget_qty, actual_qty, earned_qty, earned_qty_imported, budget_hrs, actual_hrs, earned_hrs, earn_whrs_imported, ' +
              'whrs_unit, percent_complete, status, ' +
              'foreman_user_id, foreman_name, gen_foreman_name, attr_type, attr_size, attr_spec, line_area, ' +
              'sched_id, system, carea, var_area, test_pkg, cwp, spl_cnt, paint_spec, insu_spec, heat_trace_spec, service, ' +
              'ta_bank, ta_bay, ta_level, pslip, work_type_id, discipline_label, ' +
              'project_disciplines(discipline_code, display_name), iwps(name), ' +
              'work_types(work_type_code, description)',
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
          tag_no: r.tag_no,
          spool_fr: r.spool_fr,
          work_type_id: r.work_type_id,
          work_type_code: r.work_types?.work_type_code ?? null,
          work_type_description: r.work_types?.description ?? null,
          discipline_label: r.discipline_label,
          service: r.service,
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
          sched_id: r.sched_id,
          system: r.system,
          carea: r.carea,
          var_area: r.var_area,
          test_pkg: r.test_pkg,
          cwp: r.cwp,
          spl_cnt: r.spl_cnt,
          gen_foreman_name: r.gen_foreman_name,
          paint_spec: r.paint_spec,
          insu_spec: r.insu_spec,
          heat_trace_spec: r.heat_trace_spec,
          ta_bank: r.ta_bank,
          ta_bay: r.ta_bay,
          ta_level: r.ta_level,
          pslip: r.pslip,
          earned_qty_imported: r.earned_qty_imported != null ? Number(r.earned_qty_imported) : null,
          earn_whrs_imported: r.earn_whrs_imported != null ? Number(r.earn_whrs_imported) : null,
          whrs_unit: r.whrs_unit != null ? Number(r.whrs_unit) : null,
          source_row: r.source_row,
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

// ─────────────────────────────────────────────────────────────────────
// A20 — Upload queue (clerk submission → auditor review)
// ─────────────────────────────────────────────────────────────────────

export type UploadQueueStatus = 'queued' | 'approved' | 'rejected';
export type LlmScanState = 'pending' | 'done' | 'failed';

export type HeuristicWarnings = {
  disciplineMismatch: Array<{ rowIndex: number; declared: string; rowValue: string }>;
  workTypeMismatch: Array<{
    rowIndex: number;
    declared: string;
    code: string;
    codeCraft: string;
  }>;
};

export type LlmWarnings = {
  verdict: 'consistent' | 'maybe_mismatch' | 'likely_mismatch';
  concerns: string[];
};

export type UploadQueueRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  project_code: string | null;
  project_name: string | null;
  declared_craft: string;
  uploaded_by: string;
  uploader_display_name: string | null;
  uploader_email: string | null;
  file_path: string;
  parsed_path: string;
  original_filename: string;
  file_size_bytes: number;
  status: UploadQueueStatus;
  parse_summary: { row_count?: number; unmapped_headers?: string[] } & Record<string, unknown>;
  heuristic_warnings: HeuristicWarnings | null;
  llm_warnings: LlmWarnings | null;
  llm_scan_state: LlmScanState;
  override_warnings: boolean;
  week_ending: string | null;
  label: string | null;
  reviewed_by: string | null;
  reviewer_display_name: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  snapshot_id: string | null;
  created_at: string;
  updated_at: string;
};

type RawQueueRow = Omit<
  UploadQueueRow,
  | 'project_code'
  | 'project_name'
  | 'uploader_display_name'
  | 'uploader_email'
  | 'reviewer_display_name'
> & {
  projects: { project_code: string; name: string } | null;
};

// FK join on projects is safe (single FK to projects table) but the
// uploaded_by / reviewed_by joins to app_users would need disambiguation
// (two FKs to the same table). Instead we hydrate uploader + reviewer
// in a second query so the SELECT stays simple and the relationship
// resolution doesn't depend on PG's auto-generated constraint names.
const QUEUE_SELECT =
  'id, tenant_id, project_id, declared_craft, uploaded_by, file_path, parsed_path, original_filename, file_size_bytes, status, parse_summary, heuristic_warnings, llm_warnings, llm_scan_state, override_warnings, week_ending, label, reviewed_by, reviewed_at, rejection_reason, snapshot_id, created_at, updated_at, ' +
  'projects(project_code, name)';

async function hydrateUsers(
  rows: RawQueueRow[],
): Promise<{
  uploaders: Map<string, { display_name: string | null; email: string }>;
  reviewers: Map<string, { display_name: string | null }>;
}> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.uploaded_by) ids.add(r.uploaded_by);
    if (r.reviewed_by) ids.add(r.reviewed_by);
  }
  if (ids.size === 0) return { uploaders: new Map(), reviewers: new Map() };
  const { data } = await supabase
    .from('app_users')
    .select('id, display_name, email')
    .in('id', Array.from(ids));
  const byId = new Map<string, { display_name: string | null; email: string }>();
  for (const u of (data ?? []) as { id: string; display_name: string | null; email: string }[]) {
    byId.set(u.id, { display_name: u.display_name, email: u.email });
  }
  return { uploaders: byId, reviewers: byId };
}

function mapQueueRow(
  r: RawQueueRow,
  uploaders: Map<string, { display_name: string | null; email: string }>,
  reviewers: Map<string, { display_name: string | null }>,
): UploadQueueRow {
  const up = uploaders.get(r.uploaded_by);
  const rv = r.reviewed_by ? reviewers.get(r.reviewed_by) : null;
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    project_id: r.project_id,
    project_code: r.projects?.project_code ?? null,
    project_name: r.projects?.name ?? null,
    declared_craft: r.declared_craft,
    uploaded_by: r.uploaded_by,
    uploader_display_name: up?.display_name ?? null,
    uploader_email: up?.email ?? null,
    file_path: r.file_path,
    parsed_path: r.parsed_path,
    original_filename: r.original_filename,
    file_size_bytes: r.file_size_bytes,
    status: r.status,
    parse_summary: r.parse_summary,
    heuristic_warnings: r.heuristic_warnings,
    llm_warnings: r.llm_warnings,
    llm_scan_state: r.llm_scan_state,
    override_warnings: r.override_warnings,
    week_ending: r.week_ending,
    label: r.label,
    reviewed_by: r.reviewed_by,
    reviewer_display_name: rv?.display_name ?? null,
    reviewed_at: r.reviewed_at,
    rejection_reason: r.rejection_reason,
    snapshot_id: r.snapshot_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Auditor inbox: every queue row in the tenant. Subscribed to realtime
 * updates so the LLM-scan chip materializes without a manual refresh
 * after a submission. The status filter is enforced client-side because
 * the row mutations land via state-transition RPC, not refetch on tab
 * switch.
 *
 * Gated on role >= editor: clerks who URL-navigate to /upload-queue
 * hit a render-level bounce, but we also skip the query + realtime
 * channel so they don't burn server resources on a page they can't use.
 */
export function useUploadQueue() {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const isEditorPlus = hasRole(me?.role, 'editor');
  const query = useQuery({
    queryKey: ['upload-queue'] as const,
    enabled: isEditorPlus,
    queryFn: async (): Promise<UploadQueueRow[]> => {
      const { data, error } = await supabase
        .from('upload_queue')
        .select(QUEUE_SELECT)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as RawQueueRow[];
      const { uploaders, reviewers } = await hydrateUsers(rows);
      return rows.map((r) => mapQueueRow(r, uploaders, reviewers));
    },
  });

  useEffect(() => {
    if (!isEditorPlus) return;
    const channel = supabase
      .channel('upload-queue-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'projectcontrols', table: 'upload_queue' },
        () => {
          qc.invalidateQueries({ queryKey: ['upload-queue'] });
          qc.invalidateQueries({ queryKey: ['my-submissions'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, isEditorPlus]);

  return query;
}

/**
 * Clerk-side: this user's own submissions, last 10, regardless of
 * status. Used by the My Submissions card on /progress/upload.
 */
export function useMySubmissions() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['my-submissions', user?.id] as const,
    enabled: !!user?.id,
    queryFn: async (): Promise<UploadQueueRow[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('upload_queue')
        .select(QUEUE_SELECT)
        .eq('uploaded_by', user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      const rows = (data ?? []) as unknown as RawQueueRow[];
      const { uploaders, reviewers } = await hydrateUsers(rows);
      return rows.map((r) => mapQueueRow(r, uploaders, reviewers));
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`my-submissions-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'projectcontrols',
          table: 'upload_queue',
          filter: `uploaded_by=eq.${user.id}`,
        },
        () => qc.invalidateQueries({ queryKey: ['my-submissions', user.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  return query;
}

/**
 * Tenant-wide list of every clerk-role user + their (project, craft)
 * assignments. Drives the User Admin clerk-management panel. Returns
 * the full clerk list even when they have no assignments yet so the
 * admin sees who still needs setup.
 */
export type ClerkWithCrafts = {
  user_id: string;
  email: string;
  display_name: string | null;
  assignments: Array<{
    project_id: string;
    project_code: string | null;
    project_name: string | null;
    crafts: string[];
  }>;
};

export function useClerksWithCrafts() {
  return useQuery({
    queryKey: ['clerks-with-crafts'] as const,
    queryFn: async (): Promise<ClerkWithCrafts[]> => {
      const { data: clerks, error: clerksErr } = await supabase
        .from('app_users')
        .select('id, email, display_name')
        .eq('role', 'clerk')
        .order('email');
      if (clerksErr) throw clerksErr;
      if (!clerks || clerks.length === 0) return [];
      const ids = clerks.map((c) => c.id);
      const { data: pcc, error: pccErr } = await supabase
        .from('project_clerk_crafts')
        .select('user_id, project_id, craft, projects(project_code, name)')
        .in('user_id', ids);
      if (pccErr) throw pccErr;
      type Row = {
        user_id: string;
        project_id: string;
        craft: string;
        projects: { project_code: string; name: string } | null;
      };
      const byUser = new Map<string, Map<string, ClerkWithCrafts['assignments'][number]>>();
      for (const r of (pcc ?? []) as unknown as Row[]) {
        let perProject = byUser.get(r.user_id);
        if (!perProject) {
          perProject = new Map();
          byUser.set(r.user_id, perProject);
        }
        let entry = perProject.get(r.project_id);
        if (!entry) {
          entry = {
            project_id: r.project_id,
            project_code: r.projects?.project_code ?? null,
            project_name: r.projects?.name ?? null,
            crafts: [],
          };
          perProject.set(r.project_id, entry);
        }
        entry.crafts.push(r.craft);
      }
      return (clerks as { id: string; email: string; display_name: string | null }[]).map(
        (c) => ({
          user_id: c.id,
          email: c.email,
          display_name: c.display_name,
          assignments: Array.from(byUser.get(c.id)?.values() ?? []).map((a) => ({
            ...a,
            crafts: a.crafts.sort(),
          })),
        }),
      );
    },
  });
}

/**
 * Projects the current user can grant clerk-craft permissions on.
 * Admin / PM: restricted to projects they're members of (matches the
 * clerk_crafts_set RPC's check). Super_admin sees every tenant project.
 */
export function useAssignableProjects() {
  const { data: me } = useCurrentUser();
  return useQuery({
    queryKey: ['assignable-projects', me?.id, me?.role] as const,
    enabled: !!me?.id,
    queryFn: async (): Promise<Array<{ id: string; project_code: string; name: string }>> => {
      if (!me) return [];
      if (me.role === 'super_admin') {
        const { data, error } = await supabase
          .from('projects')
          .select('id, project_code, name')
          .order('project_code');
        if (error) throw error;
        return (data ?? []) as { id: string; project_code: string; name: string }[];
      }
      const { data, error } = await supabase
        .from('project_members')
        .select('project_id, projects(project_code, name)')
        .eq('user_id', me.id);
      if (error) throw error;
      type Row = {
        project_id: string;
        projects: { project_code: string; name: string } | null;
      };
      return ((data ?? []) as unknown as Row[])
        .filter((r) => r.projects)
        .map((r) => ({
          id: r.project_id,
          project_code: r.projects!.project_code,
          name: r.projects!.name,
        }))
        .sort((a, b) => a.project_code.localeCompare(b.project_code));
    },
  });
}

/**
 * Crafts the current user is permitted to submit for on a given project.
 * For clerks this scopes the declared-craft dropdown; for editor+ it
 * returns the full project_disciplines list since they have no
 * per-craft restriction.
 */
export function useProjectClerkCrafts(projectId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['project-clerk-crafts', projectId, user?.id] as const,
    enabled: !!projectId && !!user?.id,
    queryFn: async (): Promise<string[]> => {
      if (!projectId || !user?.id) return [];
      const { data, error } = await supabase
        .from('project_clerk_crafts')
        .select('craft')
        .eq('project_id', projectId)
        .eq('user_id', user.id);
      if (error) throw error;
      return ((data ?? []) as { craft: string }[]).map((r) => r.craft).sort();
    },
  });
}

/**
 * Signed URL for a Storage object on the upload-queue bucket. Used by
 * the auditor review modal to fetch parsed.json for the preview table
 * and to expose a download link for the original file.
 */
export async function signedUploadQueueUrl(
  path: string,
  expiresIn = 60,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('upload-queue')
    .createSignedUrl(path, expiresIn);
  if (error || !data) throw error ?? new Error('signed url failed');
  return data.signedUrl;
}

export type SubmitToQueueResult = {
  queueId: string;
  parseSummary: Record<string, unknown>;
  heuristicWarnings: HeuristicWarnings | null;
  llmScanState: LlmScanState;
};

/**
 * Multipart POST to queue-progress-upload. supabase.functions.invoke
 * goes through fetch with JSON encoding by default, so for multipart we
 * build the request ourselves.
 *
 * Returns a 409 + warnings shape when heuristic mismatches are
 * present and overrideWarnings is not set — caller is expected to
 * surface the warnings and re-call with overrideWarnings=true to confirm.
 */
export async function submitToUploadQueue(opts: {
  projectId: string;
  declaredCraft: string;
  file: File;
  weekEnding?: string;
  label?: string;
  overrideWarnings?: boolean;
}): Promise<
  | { ok: true; result: SubmitToQueueResult }
  | {
      ok: false;
      status: number;
      error: string;
      heuristicWarnings?: HeuristicWarnings | null;
      parseSummary?: Record<string, unknown>;
    }
> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return { ok: false, status: 401, error: 'no session' };

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/queue-progress-upload`;
  const form = new FormData();
  form.set('projectId', opts.projectId);
  form.set('declaredCraft', opts.declaredCraft);
  form.set('file', opts.file);
  if (opts.weekEnding) form.set('weekEnding', opts.weekEnding);
  if (opts.label) form.set('label', opts.label);
  if (opts.overrideWarnings) form.set('overrideWarnings', 'true');

  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = (await resp.json().catch(() => ({}))) as {
    error?: string;
    heuristicWarnings?: HeuristicWarnings | null;
    parseSummary?: Record<string, unknown>;
    queueId?: string;
    llmScanState?: LlmScanState;
  };
  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      error: body.error ?? `submit failed (${resp.status})`,
      heuristicWarnings: body.heuristicWarnings ?? null,
      parseSummary: body.parseSummary,
    };
  }
  return {
    ok: true,
    result: {
      queueId: body.queueId!,
      parseSummary: body.parseSummary ?? {},
      heuristicWarnings: body.heuristicWarnings ?? null,
      llmScanState: body.llmScanState ?? 'pending',
    },
  };
}
