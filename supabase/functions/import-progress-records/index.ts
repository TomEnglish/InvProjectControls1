// import-progress-records
//
// Direct-import path used by pc_reviewer+ callers on the /progress/upload page.
// Accepts the parsed-row payload produced by frontend/src/lib/progressParser.ts
// and writes progress_records + progress_record_milestones + a weekly
// progress_snapshots capture via the shared importProgressRecords body.
//
// Body shape:
//   { projectId, weekEnding?, label?, sourceFilename?, items: ParsedRow[] }
//
// Whole-batch atomicity: if any DB write fails, this function returns the
// error and the caller is expected to inspect the partial state. Each
// upload mints fresh records with sequential record_no — Phase 4 doesn't
// dedupe on re-upload.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  importProgressRecords,
  type ImportedItem,
} from '../_shared/importProgressRecords.ts';

type Payload = {
  projectId: string;
  weekEnding?: string;
  label?: string;
  sourceFilename?: string;
  items: ImportedItem[];
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

  const result = await importProgressRecords({
    admin,
    tenantId: caller.tenant_id,
    projectId: body.projectId,
    callerId,
    weekEnding: body.weekEnding ?? null,
    label: body.label ?? null,
    sourceFilename: body.sourceFilename ?? null,
    items: body.items,
  });
  if (!result.ok) return json({ error: result.error }, 400);

  return json({
    inserted: result.inserted,
    snapshot_id: result.snapshotId,
  });
});
