// import-progress-records
//
// Accepts the parsed-row payload produced by frontend/src/lib/progressParser.ts
// and writes progress_records + progress_record_milestones, then creates a
// weekly progress_snapshots + progress_snapshot_items capture.
//
// Body shape:
//   { projectId, weekEnding?, label?, sourceFilename?, items: ParsedRow[] }
//
// Whole-batch atomicity: if any DB write fails, this function returns the
// error and the caller is expected to inspect the partial state. Each
// upload mints fresh records with sequential record_no — Phase 4 doesn't
// dedupe on re-upload.

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Milestone = { name: string; pct: number };
type Item = {
  dwg?: string;
  name?: string;
  budget_hrs?: number;
  actual_hrs?: number;
  percent_complete?: number;
  unit?: string;
  budget_qty?: number;
  actual_qty?: number;
  foreman_name?: string;
  iwp_name?: string;
  attr_type?: string;
  attr_size?: string;
  attr_spec?: string;
  line_area?: string;
  milestones?: Milestone[];
};
type Payload = {
  projectId: string;
  weekEnding?: string;
  label?: string;
  sourceFilename?: string;
  items: Item[];
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

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'pm', 'pc_reviewer', 'editor']);

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
    return json({ error: `role ${caller.role} cannot import` }, 403);
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
    .select('id, tenant_id')
    .eq('id', body.projectId)
    .maybeSingle();
  if (!project || project.tenant_id !== caller.tenant_id) {
    return json({ error: 'project not in your tenant' }, 404);
  }

  const [iwpsRes, aliasesRes, maxRowRes] = await Promise.all([
    admin.from('iwps').select('id, name').eq('project_id', body.projectId),
    admin.from('foreman_aliases').select('name, user_id').eq('tenant_id', caller.tenant_id),
    admin
      .from('progress_records')
      .select('record_no')
      .eq('project_id', body.projectId)
      .order('record_no', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const iwpMap = new Map(((iwpsRes.data ?? []) as { id: string; name: string }[]).map((i) => [i.name.toLowerCase(), i.id]));
  const aliasMap = new Map(
    ((aliasesRes.data ?? []) as { name: string; user_id: string }[]).map((a) => [a.name.toLowerCase(), a.user_id]),
  );
  let nextRecordNo = ((maxRowRes.data?.record_no as number | null) ?? 0) + 1;

  const insertRows = body.items.map((item) => ({
    tenant_id: caller.tenant_id,
    project_id: body.projectId,
    iwp_id: item.iwp_name ? (iwpMap.get(item.iwp_name.toLowerCase()) ?? null) : null,
    record_no: nextRecordNo++,
    source_type: 'import',
    source_filename: body.sourceFilename ?? null,
    dwg: item.dwg ?? null,
    description: item.name ?? '(unnamed)',
    uom: (item.unit ?? 'EA').toUpperCase(),
    budget_qty: item.budget_qty ?? null,
    actual_qty: item.actual_qty ?? null,
    budget_hrs: item.budget_hrs ?? 0,
    actual_hrs: item.actual_hrs ?? 0,
    percent_complete: item.percent_complete ?? 0,
    status: 'active',
    foreman_name: item.foreman_name ?? null,
    foreman_user_id: item.foreman_name ? (aliasMap.get(item.foreman_name.toLowerCase()) ?? null) : null,
    attr_type: item.attr_type ?? null,
    attr_size: item.attr_size ?? null,
    attr_spec: item.attr_spec ?? null,
    line_area: item.line_area ?? null,
  }));

  const { data: inserted, error: insertErr } = await admin
    .from('progress_records')
    .insert(insertRows)
    .select('id');
  if (insertErr) return json({ error: 'records: ' + insertErr.message }, 400);

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
        value: m.pct,
      });
    });
  }
  if (milestoneRows.length > 0) {
    const { error: msErr } = await admin
      .from('progress_record_milestones')
      .upsert(milestoneRows, { onConflict: 'progress_record_id,seq' });
    if (msErr) return json({ error: 'milestones: ' + msErr.message }, 400);
  }

  const totalBudgetHrs = insertRows.reduce((acc, r) => acc + (r.budget_hrs ?? 0), 0);
  const totalActualHrs = insertRows.reduce((acc, r) => acc + (r.actual_hrs ?? 0), 0);
  const totalEarnedHrs = insertRows.reduce(
    (acc, r) => acc + (r.budget_hrs ?? 0) * ((r.percent_complete ?? 0) / 100),
    0,
  );

  const { data: snapshot, error: snapErr } = await admin
    .from('progress_snapshots')
    .insert({
      tenant_id: caller.tenant_id,
      project_id: body.projectId,
      kind: 'weekly',
      week_ending: body.weekEnding ?? null,
      label: body.label ?? `Import ${new Date().toISOString().slice(0, 10)}`,
      total_budget_hrs: totalBudgetHrs,
      total_earned_hrs: totalEarnedHrs,
      total_actual_hrs: totalActualHrs,
      cpi: totalActualHrs > 0 ? totalEarnedHrs / totalActualHrs : null,
      spi: totalBudgetHrs > 0 ? totalEarnedHrs / totalBudgetHrs : null,
      source_filename: body.sourceFilename ?? null,
      uploaded_by: callerId,
    })
    .select('id')
    .single();
  if (snapErr) return json({ error: 'snapshot: ' + snapErr.message }, 400);

  const snapItems = inserted!.map((rec, i) => {
    const r = insertRows[i]!;
    const pctFrac = (r.percent_complete ?? 0) / 100;
    return {
      snapshot_id: snapshot.id,
      progress_record_id: rec.id,
      tenant_id: caller.tenant_id,
      project_id: body.projectId,
      percent_complete: r.percent_complete ?? 0,
      earned_hrs: (r.budget_hrs ?? 0) * pctFrac,
      earned_qty: r.budget_qty != null ? r.budget_qty * pctFrac : null,
      actual_hrs: r.actual_hrs ?? 0,
      actual_qty: r.actual_qty,
    };
  });
  if (snapItems.length > 0) {
    const { error: snapItemErr } = await admin
      .from('progress_snapshot_items')
      .insert(snapItems);
    if (snapItemErr) return json({ error: 'snapshot_items: ' + snapItemErr.message }, 400);
  }

  return json({
    inserted: insertRows.length,
    snapshot_id: snapshot.id,
  });
});
