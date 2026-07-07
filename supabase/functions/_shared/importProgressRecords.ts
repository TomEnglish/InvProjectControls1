// _shared/importProgressRecords.ts
//
// The "write parsed rows into progress_records + a weekly snapshot" body,
// extracted from import-progress-records/index.ts so both that fn (direct
// import path, pc_reviewer+ caller) and queue-approve-upload (auditor commits
// a clerk-submitted file) call the same logic with the same shape.
//
// Caller responsibilities:
//   - auth + role check before calling
//   - resolve tenant_id + the caller's user id
//   - pass a service-role-scoped Supabase client (this body bypasses RLS
//     for snapshot inserts; progress_snapshots write policy excludes editor)
//
// Returns ImportResult — never throws. Caller maps to HTTP response.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { normalizeUom } from './uom.ts';

export type ImportedMilestone = { name: string; pct: number };

export type ImportedItem = {
  dwg?: string;
  rev?: string;
  code?: string;
  name?: string;
  tag_no?: string;
  spool_fr?: string;
  budget_hrs?: number;
  actual_hrs?: number;
  percent_complete?: number;
  unit?: string;
  budget_qty?: number;
  actual_qty?: number;
  earned_qty_imported?: number;
  earn_whrs_imported?: number;
  foreman_name?: string;
  gen_foreman_name?: string;
  iwp_name?: string;
  attr_type?: string;
  attr_size?: string;
  attr_spec?: string;
  line_area?: string;
  system?: string;
  carea?: string;
  var_area?: string;
  sched_id?: string;
  test_pkg?: string;
  cwp?: string;
  spl_cnt?: number;
  source_row?: number;
  paint_spec?: string;
  insu_spec?: string;
  heat_trace_spec?: string;
  service?: string;
  ta_bank?: string;
  ta_bay?: string;
  ta_level?: string;
  pslip?: string;
  work_type?: string;
  discipline_label?: string;
  milestones?: ImportedMilestone[];
};

export type ImportParams = {
  admin: SupabaseClient;
  tenantId: string;
  projectId: string;
  callerId: string;
  weekEnding?: string | null;
  label?: string | null;
  sourceFilename?: string | null;
  items: ImportedItem[];
};

export type ImportResult =
  | { ok: true; inserted: number; snapshotId: string }
  | { ok: false; error: string };

export async function importProgressRecords(p: ImportParams): Promise<ImportResult> {
  if (!p.items.length) {
    return { ok: false, error: 'items required' };
  }

  const [iwpsRes, aliasesRes, workTypesRes, maxRowRes] = await Promise.all([
    p.admin.from('iwps').select('id, name').eq('project_id', p.projectId),
    p.admin.from('foreman_aliases').select('name, user_id').eq('tenant_id', p.tenantId),
    p.admin.from('work_types').select('id, work_type_code').eq('tenant_id', p.tenantId),
    p.admin
      .from('progress_records')
      .select('record_no')
      .eq('project_id', p.projectId)
      .order('record_no', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const iwpMap = new Map(
    ((iwpsRes.data ?? []) as { id: string; name: string }[]).map((i) => [
      i.name.toLowerCase(),
      i.id,
    ]),
  );
  const aliasMap = new Map(
    ((aliasesRes.data ?? []) as { name: string; user_id: string }[]).map((a) => [
      a.name.toLowerCase(),
      a.user_id,
    ]),
  );
  // WORK_TYPE codes are case-insensitive on lookup (audit files sometimes
  // lowercase). Unrecognised codes leave work_type_id null and fall back
  // to the discipline default via the EV view's coalesce.
  const workTypeMap = new Map(
    ((workTypesRes.data ?? []) as { id: string; work_type_code: string }[]).map((w) => [
      w.work_type_code.toLowerCase(),
      w.id,
    ]),
  );
  let nextRecordNo = ((maxRowRes.data?.record_no as number | null) ?? 0) + 1;

  const insertRows = p.items.map((item) => {
    // Description column accepts DESC_, falling back to TAG_NO or SPOOL_FR
    // if DESC_ is missing — the unified workbook treats these as discipline-
    // specific name variants, but downstream UI needs one resolved label.
    const description = item.name ?? item.tag_no ?? item.spool_fr ?? '(unnamed)';
    // Trim before lookup so a padded-but-valid code resolves (and matches the
    // trimmed work_type_raw we persist below — otherwise "  X  " would store
    // as "X" yet count as unmapped).
    const workTypeId = item.work_type?.trim()
      ? (workTypeMap.get(item.work_type.trim().toLowerCase()) ?? null)
      : null;
    return {
      tenant_id: p.tenantId,
      project_id: p.projectId,
      iwp_id: item.iwp_name ? (iwpMap.get(item.iwp_name.toLowerCase()) ?? null) : null,
      record_no: nextRecordNo++,
      source_row: item.source_row ?? null,
      source_type: 'import',
      source_filename: p.sourceFilename ?? null,
      dwg: item.dwg ?? null,
      rev: item.rev ?? null,
      code: item.code ?? null,
      description,
      tag_no: item.tag_no ?? null,
      spool_fr: item.spool_fr ?? null,
      uom: normalizeUom(item.unit),
      budget_qty: item.budget_qty ?? null,
      actual_qty: item.actual_qty ?? null,
      earned_qty_imported: item.earned_qty_imported ?? null,
      earn_whrs_imported: item.earn_whrs_imported ?? null,
      budget_hrs: item.budget_hrs ?? 0,
      actual_hrs: item.actual_hrs ?? 0,
      percent_complete: item.percent_complete ?? 0,
      status: 'active',
      foreman_name: item.foreman_name ?? null,
      foreman_user_id: item.foreman_name
        ? (aliasMap.get(item.foreman_name.toLowerCase()) ?? null)
        : null,
      gen_foreman_name: item.gen_foreman_name ?? null,
      attr_type: item.attr_type ?? null,
      attr_size: item.attr_size ?? null,
      attr_spec: item.attr_spec ?? null,
      line_area: item.line_area ?? null,
      system: item.system ?? null,
      carea: item.carea ?? null,
      var_area: item.var_area ?? null,
      sched_id: item.sched_id ?? null,
      test_pkg: item.test_pkg ?? null,
      cwp: item.cwp ?? null,
      spl_cnt: item.spl_cnt ?? null,
      paint_spec: item.paint_spec ?? null,
      insu_spec: item.insu_spec ?? null,
      heat_trace_spec: item.heat_trace_spec ?? null,
      service: item.service ?? null,
      ta_bank: item.ta_bank ?? null,
      ta_bay: item.ta_bay ?? null,
      ta_level: item.ta_level ?? null,
      pslip: item.pslip ?? null,
      work_type_id: workTypeId,
      // Raw WORK_TYPE code as it appeared in the file, so the Data Check can
      // tell a blank WORK_TYPE from one that simply isn't in the library.
      work_type_raw: item.work_type?.trim() || null,
      discipline_label: item.discipline_label ?? null,
    };
  });

  const { data: inserted, error: insertErr } = await p.admin
    .from('progress_records')
    .insert(insertRows)
    .select('id');
  if (insertErr) return { ok: false, error: 'records: ' + insertErr.message };

  const milestoneRows: Record<string, unknown>[] = [];
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!;
    const recordId = inserted![i]!.id;
    (item.milestones ?? []).forEach((m, idx) => {
      milestoneRows.push({
        tenant_id: p.tenantId,
        progress_record_id: recordId,
        seq: idx + 1,
        label: m.name,
        value: m.pct,
      });
    });
  }
  if (milestoneRows.length > 0) {
    const { error: msErr } = await p.admin
      .from('progress_record_milestones')
      .upsert(milestoneRows, { onConflict: 'progress_record_id,seq' });
    if (msErr) return { ok: false, error: 'milestones: ' + msErr.message };
  }

  const totalBudgetHrs = insertRows.reduce((acc, r) => acc + (r.budget_hrs ?? 0), 0);
  const totalActualHrs = insertRows.reduce((acc, r) => acc + (r.actual_hrs ?? 0), 0);
  const totalEarnedHrs = insertRows.reduce(
    (acc, r) => acc + (r.budget_hrs ?? 0) * ((r.percent_complete ?? 0) / 100),
    0,
  );

  const { data: snapshot, error: snapErr } = await p.admin
    .from('progress_snapshots')
    .insert({
      tenant_id: p.tenantId,
      project_id: p.projectId,
      kind: 'weekly',
      week_ending: p.weekEnding ?? null,
      label: p.label ?? `Import ${new Date().toISOString().slice(0, 10)}`,
      total_budget_hrs: totalBudgetHrs,
      total_earned_hrs: totalEarnedHrs,
      total_actual_hrs: totalActualHrs,
      cpi: totalActualHrs > 0 ? totalEarnedHrs / totalActualHrs : null,
      spi: totalBudgetHrs > 0 ? totalEarnedHrs / totalBudgetHrs : null,
      source_filename: p.sourceFilename ?? null,
      uploaded_by: p.callerId,
    })
    .select('id')
    .single();
  if (snapErr) return { ok: false, error: 'snapshot: ' + snapErr.message };

  const snapItems = inserted!.map((rec, i) => {
    const r = insertRows[i]!;
    const pctFrac = (r.percent_complete ?? 0) / 100;
    return {
      snapshot_id: snapshot.id,
      progress_record_id: rec.id,
      tenant_id: p.tenantId,
      project_id: p.projectId,
      percent_complete: r.percent_complete ?? 0,
      earned_hrs: (r.budget_hrs ?? 0) * pctFrac,
      earned_qty: r.budget_qty != null ? r.budget_qty * pctFrac : null,
      actual_hrs: r.actual_hrs ?? 0,
      actual_qty: r.actual_qty,
    };
  });
  if (snapItems.length > 0) {
    const { error: snapItemErr } = await p.admin
      .from('progress_snapshot_items')
      .insert(snapItems);
    if (snapItemErr) return { ok: false, error: 'snapshot_items: ' + snapItemErr.message };
  }

  return { ok: true, inserted: insertRows.length, snapshotId: snapshot.id };
}
