// _shared/importProgressRecords.ts
//
// The "apply parsed rows to progress_records + a weekly snapshot" body,
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
import { resolveDisciplineId, type DisciplineReference } from './discipline.ts';
import {
  matchBaselineRecords,
  type ExistingProgressRecord,
  type ImportedRecordIdentity,
} from './importMatch.ts';
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

export type ImportedItemValidationIssue = {
  code: 'invalid_item';
  row: number;
  field: string;
  message: string;
};

const IMPORT_DISCIPLINES = new Set([
  'site', 'site work', 'civil', 'foundations', 'electrical', 'pipe', 'steel',
  'mechanical', 'instrumentation',
]);

const IMPORT_NUMERIC_FIELDS: ReadonlyArray<keyof ImportedItem> = [
  'budget_hrs', 'actual_hrs', 'percent_complete', 'budget_qty', 'actual_qty',
  'earned_qty_imported', 'earn_whrs_imported', 'spl_cnt', 'source_row',
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Server-side guard for both direct imports and queue approvals. */
export function validateImportedItems(items: ImportedItem[]): ImportedItemValidationIssue[] {
  const issues: ImportedItemValidationIssue[] = [];
  items.forEach((item, index) => {
    const row = index + 1;
    const discipline = item.discipline_label?.trim().toLowerCase().replace(/_/g, ' ');
    if (!discipline || !IMPORT_DISCIPLINES.has(discipline)) {
      issues.push({
        code: 'invalid_item',
        row,
        field: 'discipline_label',
        message: `Row ${row}: DISCIPLINE is missing or invalid.`,
      });
    }
    if (!isFiniteNumber(item.source_row) || !Number.isInteger(item.source_row) || item.source_row <= 0) {
      issues.push({
        code: 'invalid_item',
        row,
        field: 'source_row',
        message: `Row ${row}: REC_NO must be a positive whole number.`,
      });
    }
    if (![item.dwg, item.name, item.tag_no, item.spool_fr].some((value) => typeof value === 'string' && value.trim())) {
      issues.push({
        code: 'invalid_item',
        row,
        field: 'identity',
        message: `Row ${row}: at least one drawing, description, tag, or spool identifier is required.`,
      });
    }
    for (const field of IMPORT_NUMERIC_FIELDS) {
      const value = item[field];
      if (value === undefined || value === null) continue;
      if (!isFiniteNumber(value)) {
        issues.push({
          code: 'invalid_item',
          row,
          field: String(field),
          message: `Row ${row}: ${String(field)} must be numeric.`,
        });
      } else if (value < 0 || (field === 'percent_complete' && value > 100)) {
        issues.push({
          code: 'invalid_item',
          row,
          field: String(field),
          message: `Row ${row}: ${String(field)} is outside the allowed range.`,
        });
      }
    }
    (item.milestones ?? []).forEach((milestone, milestoneIndex) => {
      if (typeof milestone.name !== 'string' || !milestone.name.trim() ||
          !isFiniteNumber(milestone.pct) || milestone.pct < 0 || milestone.pct > 100) {
        issues.push({
          code: 'invalid_item',
          row,
          field: `milestones[${milestoneIndex}]`,
          message: `Row ${row}: milestone values must have a text name and a percent from 0 to 100.`,
        });
      }
    });
  });
  return issues;
}

export type ImportParams = {
  // Edge functions create this client with the projectcontrols schema as the
  // default, so keep the schema generic instead of assuming Supabase's
  // public-schema default.
  admin: SupabaseClient<any, any, any>;
  tenantId: string;
  projectId: string;
  callerId: string;
  declaredDiscipline?: string | null;
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
  const validationIssues = validateImportedItems(p.items);
  if (validationIssues.length > 0) {
    return { ok: false, error: validationIssues.map((issue) => issue.message).join(' ') };
  }

  const [iwpsRes, aliasesRes, workTypesRes, workTypeMilestonesRes, disciplinesRes, existingRes] = await Promise.all([
    p.admin.from('iwps').select('id, name').eq('project_id', p.projectId),
    p.admin.from('foreman_aliases').select('name, user_id').eq('tenant_id', p.tenantId),
    p.admin.from('work_types').select('id, work_type_code').eq('tenant_id', p.tenantId),
    p.admin.from('work_type_milestones').select('work_type_id, seq, weight').eq('tenant_id', p.tenantId),
    p.admin
      .from('project_disciplines')
      .select('id, discipline_code')
      .eq('project_id', p.projectId)
      .eq('is_active', true),
    // Audit rows may only apply to the locked baseline. Imported rows from
    // previous weeks are intentionally excluded from matching.
    p.admin
      .from('progress_records')
      .select('id, discipline_id, source_row, dwg, tag_no, spool_fr, attr_spec, source_type, percent_complete, earned_qty_imported, earn_whrs_imported, work_type_id, work_type_raw')
      .eq('project_id', p.projectId)
      .eq('source_type', 'baseline'),
  ]);
  if (existingRes.error) {
    return { ok: false, error: 'existing records: ' + existingRes.error.message };
  }

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
  const workTypeWeights = new Map<string, Map<number, number>>();
  for (const milestone of (workTypeMilestonesRes.data ?? []) as {
    work_type_id: string;
    seq: number;
    weight: number | string;
  }[]) {
    const weights = workTypeWeights.get(milestone.work_type_id) ?? new Map<number, number>();
    weights.set(Number(milestone.seq), Number(milestone.weight));
    workTypeWeights.set(milestone.work_type_id, weights);
  }
  const disciplines = (disciplinesRes.data ?? []) as DisciplineReference[];
  const existingRecords = (existingRes.data ?? []) as ExistingProgressRecord[];

  const recordRows = p.items.map((item) => {
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
    const weights = workTypeId ? workTypeWeights.get(workTypeId) : null;
    const milestonePercent = weights && (item.milestones?.length ?? 0) > 0
      ? item.milestones!.reduce(
          (total, milestone, index) =>
            total + (milestone.pct / 100) * (weights.get(index + 1) ?? 0),
          0,
        ) * 100
      : null;
    const disciplineId = resolveDisciplineId(
      item.discipline_label,
      p.declaredDiscipline,
      disciplines,
    );
    return {
      item,
      identity: {
        disciplineId,
        sourceRow: item.source_row ?? null,
        dwg: item.dwg,
        tagNo: item.tag_no,
        spoolFr: item.spool_fr,
        attrSpec: item.attr_spec,
      } satisfies ImportedRecordIdentity,
      record: {
        tenant_id: p.tenantId,
        project_id: p.projectId,
        discipline_id: disciplineId,
        iwp_id: item.iwp_name ? (iwpMap.get(item.iwp_name.toLowerCase()) ?? null) : null,
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
        // The milestone matrix is authoritative for earned progress. The
        // generated earned_qty/earned_hrs columns and the EV view must agree
        // with the same weighted result, even if PCT_EARNED in the source is
        // stale or calculated using a different template.
        percent_complete: milestonePercent ?? item.percent_complete ?? 0,
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
      },
    };
  });

  const matchResult = matchBaselineRecords(
    recordRows.map((row) => row.identity),
    existingRecords,
  );
  if (matchResult.issues.length > 0) {
    return {
      ok: false,
      error: matchResult.issues.map((issue) => issue.message).join(' '),
    };
  }
  const recordIds = matchResult.ids as string[];

  const { data: beforeMilestoneRows, error: beforeMilestoneErr } = await p.admin
    .from('progress_record_milestones')
    .select('progress_record_id, seq, roc_milestone_id, label, value')
    .in('progress_record_id', recordIds);
  if (beforeMilestoneErr) {
    return { ok: false, error: 'existing milestones: ' + beforeMilestoneErr.message };
  }

  const beforeRecordById = new Map(
    (existingRecords as (ExistingProgressRecord & {
      percent_complete?: number | string | null;
      earned_qty_imported?: number | string | null;
      earn_whrs_imported?: number | string | null;
      work_type_id?: string | null;
      work_type_raw?: string | null;
    })[]).map((record) => [record.id, record]),
  );
  const beforeMilestonesByRecord = new Map<string, Record<string, unknown>[]>();
  for (const milestone of (beforeMilestoneRows ?? []) as Record<string, unknown>[]) {
    const rows = beforeMilestonesByRecord.get(String(milestone.progress_record_id)) ?? [];
    rows.push({
      seq: milestone.seq,
      roc_milestone_id: milestone.roc_milestone_id ?? null,
      label: milestone.label ?? null,
      value: milestone.value,
    });
    beforeMilestonesByRecord.set(String(milestone.progress_record_id), rows);
  }

  for (const recordId of recordIds) {
    if (!beforeRecordById.has(recordId)) {
      return { ok: false, error: `existing record ${recordId} disappeared during import` };
    }
  }

  // Weekly uploads update the matching locked-baseline row so the Progress
  // page shows the new milestone values on the record the user already knows.
  // Audit uploads never create new project-scope records.
  for (let i = 0; i < recordRows.length; i++) {
    const matchedId = recordIds[i]!;
    const row = recordRows[i]!.record;
    const progressUpdate: Record<string, unknown> = {
      // Audit uploads update earned progress only. Budget, identity, and
      // actual-hours fields remain owned by the baseline/actual-hours flows.
      percent_complete: row.percent_complete,
      earned_qty_imported: row.earned_qty_imported ?? null,
      earn_whrs_imported: row.earn_whrs_imported ?? null,
    };
    if (row.work_type_id) {
      progressUpdate.work_type_id = row.work_type_id;
      progressUpdate.work_type_raw = row.work_type_raw;
    }
    const { error: updateErr } = await p.admin
      .from('progress_records')
      .update({
        ...progressUpdate,
        ...(row.work_type_id
          ? { work_type_id: row.work_type_id, work_type_raw: row.work_type_raw }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchedId)
      .eq('project_id', p.projectId);
    if (updateErr) return { ok: false, error: 'records: ' + updateErr.message };
  }

  const milestoneRows: Record<string, unknown>[] = [];
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!;
    const recordId = recordIds[i]!;
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

  const importedRecords = recordRows.map((row) => row.record);
  const totalBudgetHrs = importedRecords.reduce((acc, r) => acc + (r.budget_hrs ?? 0), 0);
  const totalActualHrs = importedRecords.reduce((acc, r) => acc + (r.actual_hrs ?? 0), 0);
  const totalEarnedHrs = importedRecords.reduce(
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

  const snapItems = importedRecords.map((r, i) => {
    const recordId = recordIds[i]!;
    const before = beforeRecordById.get(recordId)!;
    const pctFrac = (r.percent_complete ?? 0) / 100;
    return {
      snapshot_id: snapshot.id,
      progress_record_id: recordId,
      tenant_id: p.tenantId,
      project_id: p.projectId,
      percent_complete: r.percent_complete ?? 0,
      earned_hrs: (r.budget_hrs ?? 0) * pctFrac,
      earned_qty: r.budget_qty != null ? r.budget_qty * pctFrac : null,
      actual_hrs: r.actual_hrs ?? 0,
      actual_qty: r.actual_qty,
      before_percent_complete: before.percent_complete != null ? Number(before.percent_complete) : 0,
      before_earned_qty_imported: before.earned_qty_imported != null ? Number(before.earned_qty_imported) : null,
      before_earn_whrs_imported: before.earn_whrs_imported != null ? Number(before.earn_whrs_imported) : null,
      before_work_type_id: before.work_type_id ?? null,
      before_work_type_raw: before.work_type_raw ?? null,
      before_milestones: beforeMilestonesByRecord.get(recordId) ?? [],
    };
  });
  if (snapItems.length > 0) {
    const { error: snapItemErr } = await p.admin
      .from('progress_snapshot_items')
      .insert(snapItems);
    if (snapItemErr) return { ok: false, error: 'snapshot_items: ' + snapItemErr.message };
  }

  return { ok: true, inserted: importedRecords.length, snapshotId: snapshot.id };
}
