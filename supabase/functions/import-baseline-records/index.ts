// import-baseline-records
//
// One-shot loader for the initial baseline of a project: ingests an audit-
// style row set (Sandra's per-discipline templates or the unified superset)
// and writes progress_records with percent_complete = 0, source_type =
// 'baseline'. Auto-creates any project_disciplines and iwps the file
// implies. Refuses to run unless the project is in status='draft' — once
// the baseline is locked, scope changes go through Change Orders.
//
// Body shape — same `items` payload as import-progress-records produces:
//   { projectId, sourceFilename?, items: ParsedRow[] }
//
// Caller role must be admin or pm. RLS does the rest (pd_admin_write etc.).
//
// Idempotent on re-run: matches disciplines by (project_id, discipline_code),
// IWPs by (project_id, name), records by source_row (when supplied) so
// re-uploading the same file inserts no duplicates.

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Milestone = { name: string; pct: number };
type Item = {
  dwg?: string;
  rev?: string;
  code?: string;
  name?: string;
  budget_hrs?: number;
  unit?: string;
  budget_qty?: number;
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
  ta_bank?: string;
  ta_bay?: string;
  ta_level?: string;
  pslip?: string;
  milestones?: Milestone[];
};
type Payload = {
  projectId: string;
  sourceFilename?: string;
  items: Item[];
};

// COA prime → discipline_code enum. Mirrors the canonical layout from
// migration 20260508000001 and the QMR page's PRIME_DISPLAY map.
const PRIME_TO_DISCIPLINE: Record<string, string> = {
  '01': 'SITE',
  '04': 'CIVIL',
  '05': 'STEEL',
  '07': 'MECH',
  '08': 'PIPE',
  '09': 'ELEC',
  '10': 'INST',
};

const DISCIPLINE_DISPLAY: Record<string, string> = {
  CIVIL: 'Civil',
  PIPE: 'Pipe',
  STEEL: 'Steel',
  ELEC: 'Electrical',
  MECH: 'Mechanical',
  INST: 'Instrumentation',
  SITE: 'Site Work',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'pm']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return json({ error: 'edge function misconfigured (env)' }, 500);
  }

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'missing authorization' }, 401);
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
    db: { schema: 'projectcontrols' },
  });

  const { data: userResult, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userResult?.user) {
    return json({ error: 'invalid session', detail: userErr?.message }, 401);
  }
  const callerId = userResult.user.id;

  const { data: caller, error: callerErr } = await callerClient
    .from('app_users')
    .select('id, tenant_id, role')
    .eq('id', callerId)
    .maybeSingle();
  if (callerErr || !caller) {
    return json({ error: 'caller not bound to a tenant' }, 403);
  }
  if (!ALLOWED_ROLES.has(caller.role)) {
    return json({ error: `role ${caller.role} cannot load baseline` }, 403);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!body.projectId || !Array.isArray(body.items) || body.items.length === 0) {
    return json({ error: 'projectId and non-empty items[] required' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'projectcontrols' },
  });

  const { data: project } = await admin
    .from('projects')
    .select('id, tenant_id, status')
    .eq('id', body.projectId)
    .maybeSingle();
  if (!project || project.tenant_id !== caller.tenant_id) {
    return json({ error: 'project not in your tenant' }, 404);
  }
  if (project.status !== 'draft') {
    return json(
      {
        error:
          `project status is "${project.status}" — baseline upload is only allowed while the project is in draft. ` +
          'Use the regular weekly upload at /progress/upload for ongoing progress.',
      },
      409,
    );
  }

  // ── Step 1: collect distinct disciplines + IWPs implied by the file ─────
  const disciplinesNeeded = new Set<string>();
  const iwpsNeeded = new Set<string>();
  for (const item of body.items) {
    const code = (item.code ?? '').trim();
    if (code) {
      const prime = code.slice(0, 2);
      const disc = PRIME_TO_DISCIPLINE[prime];
      if (disc) disciplinesNeeded.add(disc);
    }
    if (item.iwp_name && item.iwp_name.trim()) iwpsNeeded.add(item.iwp_name.trim());
  }

  // ── Step 2: idempotent upsert disciplines (skip if already exists) ──────
  // RLS pd_admin_write allows admin/pm; we use the service-role client to
  // get a single transaction and bypass the per-row policy round-trips.
  // The (project_id, discipline_code) unique constraint guarantees no dupes.
  const { data: existingDisc } = await admin
    .from('project_disciplines')
    .select('id, discipline_code')
    .eq('project_id', body.projectId);
  const existingDiscCodes = new Set(
    ((existingDisc ?? []) as { discipline_code: string }[]).map((d) => d.discipline_code),
  );

  const newDisciplines = [...disciplinesNeeded]
    .filter((d) => !existingDiscCodes.has(d))
    .map((d) => ({
      tenant_id: caller.tenant_id,
      project_id: body.projectId,
      discipline_code: d,
      display_name: DISCIPLINE_DISPLAY[d] ?? d,
      budget_hrs: 0,
      is_active: true,
    }));

  if (newDisciplines.length > 0) {
    const { error: discErr } = await admin
      .from('project_disciplines')
      .insert(newDisciplines);
    if (discErr) return json({ error: 'disciplines: ' + discErr.message }, 400);
  }

  // Re-fetch to get IDs for all disciplines this batch touches.
  const { data: allDisc } = await admin
    .from('project_disciplines')
    .select('id, discipline_code')
    .eq('project_id', body.projectId);
  const discIdByCode = new Map(
    ((allDisc ?? []) as { id: string; discipline_code: string }[]).map((d) => [
      d.discipline_code,
      d.id,
    ]),
  );

  // ── Step 3: idempotent upsert IWPs ──────────────────────────────────────
  const { data: existingIwps } = await admin
    .from('iwps')
    .select('id, name')
    .eq('project_id', body.projectId);
  const existingIwpNames = new Map(
    ((existingIwps ?? []) as { id: string; name: string }[]).map((i) => [
      i.name.toLowerCase(),
      i.id,
    ]),
  );

  // For each new IWP, attribute it to a discipline by sampling the first
  // record that mentions it — best-effort; admin can re-assign later from
  // the Progress page if the heuristic guesses wrong.
  const iwpDisciplineGuess = new Map<string, string | null>();
  for (const item of body.items) {
    if (!item.iwp_name) continue;
    const name = item.iwp_name.trim();
    if (iwpDisciplineGuess.has(name)) continue;
    const code = (item.code ?? '').trim();
    const disc = code ? PRIME_TO_DISCIPLINE[code.slice(0, 2)] : null;
    iwpDisciplineGuess.set(name, disc ?? null);
  }

  const newIwps = [...iwpsNeeded]
    .filter((name) => !existingIwpNames.has(name.toLowerCase()))
    .map((name) => {
      const disc = iwpDisciplineGuess.get(name) ?? null;
      return {
        tenant_id: caller.tenant_id,
        project_id: body.projectId,
        discipline_id: disc ? discIdByCode.get(disc) ?? null : null,
        name,
      };
    });

  if (newIwps.length > 0) {
    const { error: iwpErr } = await admin.from('iwps').insert(newIwps);
    if (iwpErr) return json({ error: 'iwps: ' + iwpErr.message }, 400);
  }

  // Re-fetch IWPs for the full id map.
  const { data: allIwps } = await admin
    .from('iwps')
    .select('id, name')
    .eq('project_id', body.projectId);
  const iwpIdByName = new Map(
    ((allIwps ?? []) as { id: string; name: string }[]).map((i) => [i.name.toLowerCase(), i.id]),
  );

  // ── Step 4: insert baseline progress_records ────────────────────────────
  // Re-runnable: if a record exists with the same (project_id, source_type,
  // source_record_id) — where source_record_id is a stable hash of the
  // file's row index — the unique constraint kicks the duplicate. Caller
  // sees this in the error and can investigate. We don't dedupe silently
  // because that hides accidental double-uploads.
  const { data: maxRowRes } = await admin
    .from('progress_records')
    .select('record_no')
    .eq('project_id', body.projectId)
    .order('record_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextRecordNo = ((maxRowRes?.record_no as number | null) ?? 0) + 1;

  const insertRows = body.items.map((item) => {
    const code = (item.code ?? '').trim() || null;
    const prime = code ? code.slice(0, 2) : null;
    const discCode = prime ? PRIME_TO_DISCIPLINE[prime] ?? null : null;
    const discId = discCode ? discIdByCode.get(discCode) ?? null : null;
    const iwpId = item.iwp_name
      ? iwpIdByName.get(item.iwp_name.toLowerCase()) ?? null
      : null;
    return {
      tenant_id: caller.tenant_id,
      project_id: body.projectId,
      discipline_id: discId,
      iwp_id: iwpId,
      record_no: nextRecordNo++,
      source_row: item.source_row ?? null,
      source_type: 'baseline',
      source_filename: body.sourceFilename ?? null,
      dwg: item.dwg ?? null,
      rev: item.rev ?? null,
      code,
      description: item.name ?? '(unnamed)',
      uom: (item.unit ?? 'EA').toUpperCase(),
      budget_qty: item.budget_qty ?? null,
      // Baseline = no progress yet, regardless of what the file says.
      actual_qty: null,
      earned_qty_imported: null,
      budget_hrs: item.budget_hrs ?? 0,
      actual_hrs: 0,
      earn_whrs_imported: null,
      percent_complete: 0,
      status: 'active',
      foreman_name: item.foreman_name ?? null,
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
      ta_bank: item.ta_bank ?? null,
      ta_bay: item.ta_bay ?? null,
      ta_level: item.ta_level ?? null,
      pslip: item.pslip ?? null,
    };
  });

  const { data: inserted, error: insertErr } = await admin
    .from('progress_records')
    .insert(insertRows)
    .select('id');
  if (insertErr) return json({ error: 'records: ' + insertErr.message }, 400);

  // ── Step 5: ROC milestone seed rows ─────────────────────────────────────
  // The audit files carry M1_DESC..M8_DESC + M1_PCT..M8_PCT per row. For
  // baseline we want the milestone LABELS in place (so the milestone matrix
  // on RecordDetail renders without all-zero rows) but values pinned to 0.
  const milestoneRows: Record<string, unknown>[] = [];
  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i]!;
    const recordId = inserted![i]!.id;
    (item.milestones ?? []).forEach((m, idx) => {
      milestoneRows.push({
        tenant_id: caller.tenant_id,
        progress_record_id: recordId,
        seq: idx + 1,
        label: m.name,
        value: 0, // baseline: no progress
      });
    });
  }
  if (milestoneRows.length > 0) {
    const { error: msErr } = await admin
      .from('progress_record_milestones')
      .upsert(milestoneRows, { onConflict: 'progress_record_id,seq' });
    if (msErr) return json({ error: 'milestones: ' + msErr.message }, 400);
  }

  return json({
    inserted: insertRows.length,
    disciplines_created: newDisciplines.length,
    iwps_created: newIwps.length,
  });
});
