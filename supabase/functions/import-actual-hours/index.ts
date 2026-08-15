// Import period actual hours and apply them to the locked project baseline.
//
// Body shape:
//   {
//     projectId,
//     periodId,
//     sourceFilename?,
//     items: [{ discipline_label, dwg, tag_no?, spool_fr?, attr_spec, hours }]
//   }

import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  resolveActualHoursRows,
  type ActualHoursImportItem,
} from '../_shared/importActualHours.ts';
import type { ExistingProgressRecord } from '../_shared/importMatch.ts';
import type { DisciplineReference } from '../_shared/discipline.ts';

type Payload = {
  projectId: string;
  periodId: string;
  sourceFilename?: string;
  items: ActualHoursImportItem[];
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

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'pm', 'pc_reviewer']);
const PAGE_SIZE = 1000;
const MAX_ROWS = 10_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

async function fetchBaselineRecords(
  admin: SupabaseClient<any, any, any>,
  projectId: string,
): Promise<{ data: ExistingProgressRecord[]; error: string | null }> {
  const records: ExistingProgressRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from('progress_records')
      .select('id, discipline_id, source_row, dwg, tag_no, spool_fr, attr_spec, source_type')
      .eq('project_id', projectId)
      .eq('source_type', 'baseline')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error: error.message };
    const page = (data ?? []) as ExistingProgressRecord[];
    records.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { data: records, error: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'edge function misconfigured (env)' }, 500);
  }

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'missing authorization' }, 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
    db: { schema: 'projectcontrols' },
  });

  const { data: userResult, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userResult?.user) {
    return json({ error: 'invalid session', detail: userErr?.message }, 401);
  }

  const { data: caller, error: callerErr } = await callerClient
    .from('app_users')
    .select('id, tenant_id, role')
    .eq('id', userResult.user.id)
    .maybeSingle();
  if (callerErr || !caller) return json({ error: 'caller not bound to a tenant' }, 403);
  if (!ALLOWED_ROLES.has(caller.role)) {
    return json({ error: `role ${caller.role} cannot import actual hours` }, 403);
  }

  let body: Payload;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ error: 'actual-hours upload is too large' }, 413);
    }
    body = JSON.parse(rawBody) as Payload;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (
    !body ||
    typeof body.projectId !== 'string' ||
    typeof body.periodId !== 'string' ||
    !body.projectId ||
    !body.periodId ||
    !Array.isArray(body.items) ||
    body.items.length === 0
  ) {
    return json({ error: 'projectId, periodId, and non-empty items[] required' }, 400);
  }
  if (!body.items.every((item) => item && typeof item === 'object')) {
    return json({ error: 'items[] must contain objects' }, 422);
  }
  if (body.items.length > MAX_ROWS) {
    return json({ error: `actual-hours upload cannot exceed ${MAX_ROWS.toLocaleString()} rows` }, 413);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'projectcontrols' },
  });

  const { data: project, error: projectErr } = await admin
    .from('projects')
    .select('id, tenant_id, baseline_locked_at')
    .eq('id', body.projectId)
    .maybeSingle();
  if (projectErr) return json({ error: projectErr.message }, 500);
  if (!project || project.tenant_id !== caller.tenant_id) {
    return json({ error: 'project not in your tenant' }, 404);
  }
  if (!project.baseline_locked_at) {
    return json({ error: 'project baseline must be locked before importing actual hours' }, 409);
  }

  const { data: period, error: periodErr } = await admin
    .from('progress_periods')
    .select('id, project_id, tenant_id, locked_at')
    .eq('id', body.periodId)
    .eq('project_id', body.projectId)
    .eq('tenant_id', caller.tenant_id)
    .maybeSingle();
  if (periodErr) return json({ error: periodErr.message }, 500);
  if (!period) return json({ error: 'period not found in this project' }, 404);
  if (period.locked_at) return json({ error: 'selected period is already closed' }, 409);

  const [{ data: disciplines, error: disciplinesErr }, baselineResult] = await Promise.all([
    admin
      .from('project_disciplines')
      .select('id, discipline_code')
      .eq('project_id', body.projectId)
      .eq('is_active', true),
    fetchBaselineRecords(admin, body.projectId),
  ]);
  if (disciplinesErr) return json({ error: disciplinesErr.message }, 500);
  if (baselineResult.error) return json({ error: `baseline records: ${baselineResult.error}` }, 500);

  const resolution = resolveActualHoursRows(
    body.items,
    (disciplines ?? []) as DisciplineReference[],
    baselineResult.data,
  );
  if (resolution.issues.length > 0) {
    return json({
      error: 'Actual-hours upload blocked: every row must match the locked project baseline.',
      issues: resolution.issues,
    }, 422);
  }

  const { data: applied, error: applyErr } = await callerClient.rpc('actual_hours_upload_apply', {
    p_project_id: body.projectId,
    p_period_id: body.periodId,
    p_rows: resolution.rows.map((row) => ({
      record_id: row.recordId,
      hours: row.hours,
    })),
  });
  if (applyErr) return json({ error: applyErr.message }, 400);

  return json({
    ok: true,
    applied: Number((applied as { applied?: number } | null)?.applied ?? resolution.rows.length),
    period_id: body.periodId,
    source_filename: body.sourceFilename ?? null,
  });
});
