// queue-approve-upload
//
// A20 Wave 2 — auditor approve / reject endpoint. Reads the cached
// parsed.json from Storage (NOT a re-parse — keeps "what the auditor saw"
// equal to "what got committed"), runs it through the shared import body,
// flips the queue row's status via upload_queue_state_transition.
//
// Body shape:
//   { queueId, action: 'approve' | 'reject', rejectionReason? }
//
// Authorization: pc_reviewer+. The state-transition RPC re-asserts role.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  importProgressRecords,
  type ImportedItem,
} from '../_shared/importProgressRecords.ts';

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

type Payload = {
  queueId?: string;
  action?: 'approve' | 'reject';
  rejectionReason?: string;
};

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
    return json({ error: `role ${caller.role} cannot review queue` }, 403);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!body.queueId) return json({ error: 'queueId required' }, 400);
  if (body.action !== 'approve' && body.action !== 'reject') {
    return json({ error: 'action must be "approve" or "reject"' }, 400);
  }
  if (body.action === 'reject' && !body.rejectionReason?.trim()) {
    return json({ error: 'rejectionReason required when action=reject' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'projectcontrols' },
  });

  // Load queue row to verify tenant scope + grab the parsed-path / project.
  const { data: row, error: rowErr } = await admin
    .from('upload_queue')
    .select('id, tenant_id, project_id, parsed_path, original_filename, week_ending, label, status')
    .eq('id', body.queueId)
    .maybeSingle();
  if (rowErr || !row) {
    return json({ error: 'queue row not found', detail: rowErr?.message }, 404);
  }
  if (row.tenant_id !== caller.tenant_id) {
    return json({ error: 'queue row not in your tenant' }, 403);
  }
  if (row.status !== 'queued') {
    return json({ error: `queue row in status ${row.status}` }, 409);
  }

  // Reject path: just call the state-transition RPC. No import.
  if (body.action === 'reject') {
    const { error: rejectErr } = await callerClient.rpc(
      'upload_queue_state_transition',
      {
        p_queue_id: row.id,
        p_action: 'rejected',
        p_snapshot_id: null,
        p_rejection_reason: body.rejectionReason!.trim(),
      },
    );
    if (rejectErr) return json({ error: 'reject: ' + rejectErr.message }, 400);
    return json({ ok: true, status: 'rejected' });
  }

  // Approve path: download parsed.json, run shared import, then flip
  // status with the resulting snapshot id.
  //
  // KNOWN CONCURRENCY LIMITATION: two auditors approving the same
  // queue row simultaneously will both pass the status='queued' check
  // here, both run importProgressRecords (creating two snapshots +
  // duplicate progress_records), and only one wins the
  // state-transition RPC. Mitigation deferred: single-auditor reality
  // makes this exceedingly unlikely. A future migration could add a
  // 'processing' status + CAS claim before the import — track as
  // Wave 2 follow-up if this becomes a real-world issue.
  const parsedDl = await admin.storage.from('upload-queue').download(row.parsed_path);
  if (parsedDl.error || !parsedDl.data) {
    return json(
      { error: 'parsed.json download failed', detail: parsedDl.error?.message },
      500,
    );
  }
  let items: ImportedItem[];
  try {
    items = JSON.parse(await parsedDl.data.text()) as ImportedItem[];
  } catch (err) {
    return json({ error: `parsed.json corrupt: ${(err as Error).message}` }, 500);
  }
  if (!Array.isArray(items) || items.length === 0) {
    return json({ error: 'parsed.json has no rows' }, 500);
  }

  const result = await importProgressRecords({
    admin,
    tenantId: caller.tenant_id,
    projectId: row.project_id,
    callerId,
    weekEnding: row.week_ending ?? null,
    label: row.label ?? null,
    sourceFilename: row.original_filename ?? null,
    items,
  });
  if (!result.ok) return json({ error: 'import: ' + result.error }, 400);

  const { error: approveErr } = await callerClient.rpc(
    'upload_queue_state_transition',
    {
      p_queue_id: row.id,
      p_action: 'approved',
      p_snapshot_id: result.snapshotId,
      p_rejection_reason: null,
    },
  );
  if (approveErr) {
    // The import committed but the state-transition failed. Surface so
    // the auditor knows the snapshot exists but the queue row is in
    // limbo — admin intervention required.
    return json(
      {
        error: 'state-transition failed (snapshot already created): ' + approveErr.message,
        snapshot_id: result.snapshotId,
      },
      500,
    );
  }

  return json({
    ok: true,
    status: 'approved',
    inserted: result.inserted,
    snapshot_id: result.snapshotId,
  });
});
