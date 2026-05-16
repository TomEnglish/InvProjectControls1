// queue-progress-upload
//
// A20 Wave 2 — clerk-callable submit endpoint. Receives a progress file +
// metadata, parses it server-side, stores both the original and the
// parsed-row JSON in Storage, creates a 'queued' upload_queue row via
// upload_queue_submit RPC, then fires the async LLM consistency scan
// (queue-llm-check) via EdgeRuntime.waitUntil so the response returns
// immediately on the heuristic result.
//
// Multipart fields:
//   projectId          — uuid
//   declaredCraft      — discipline_code enum value
//   weekEnding         — yyyy-mm-dd (optional)
//   label              — display label (optional)
//   overrideWarnings   — 'true' to submit over a heuristic mismatch
//   file               — the actual file
//
// Returns:
//   { queueId, parseSummary, heuristicWarnings, llmScanState: 'pending' }
//
// Authorization: any role >= clerk. The RPC re-asserts the role + the
// (project, craft) permission via project_clerk_crafts.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  parseProgressWorkbook,
  type ParseResult,
  type ParsedRow,
} from '../_shared/progressParser.ts';
import * as XLSX from 'npm:xlsx@0.18.5';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

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

// Heuristic check — runs synchronously on the parsed rows. Surfaces
// deterministic mismatches (wrong DISCIPLINE column, WORK_TYPE belongs
// to another craft) so the clerk gets immediate feedback. The LLM scan
// (separate fn) covers fuzzier "does this look like a {craft} audit"
// patterns the heuristic can't catch.
type HeuristicWarnings = {
  disciplineMismatch: { rowIndex: number; declared: string; rowValue: string }[];
  workTypeMismatch: { rowIndex: number; declared: string; code: string; codeCraft: string }[];
};

async function buildHeuristicWarnings(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  declaredCraft: string,
  rows: ParsedRow[],
): Promise<HeuristicWarnings> {
  const warnings: HeuristicWarnings = {
    disciplineMismatch: [],
    workTypeMismatch: [],
  };

  // Row-level DISCIPLINE column check (case-insensitive substring match
  // — audit files use "Civil", "Foundations", etc. vs our enum CIVIL).
  rows.forEach((r, i) => {
    const rowDisc = r.discipline_label?.trim();
    if (!rowDisc) return;
    if (rowDisc.toLowerCase().slice(0, 4) !== declaredCraft.toLowerCase().slice(0, 4)) {
      warnings.disciplineMismatch.push({
        rowIndex: i,
        declared: declaredCraft,
        rowValue: rowDisc,
      });
    }
  });

  // WORK_TYPE → discipline check. Look up referenced codes in
  // work_types; flag any whose discipline_code != declaredCraft.
  const codes = Array.from(
    new Set(
      rows
        .map((r) => r.work_type?.trim())
        .filter((c): c is string => !!c)
        .map((c) => c.toLowerCase()),
    ),
  );
  if (codes.length > 0) {
    const { data: wts } = await admin
      .from('work_types')
      .select('work_type_code, discipline_code')
      .eq('tenant_id', tenantId);
    const codeMap = new Map<string, string>();
    for (const w of (wts ?? []) as { work_type_code: string; discipline_code: string }[]) {
      codeMap.set(w.work_type_code.toLowerCase(), w.discipline_code);
    }
    rows.forEach((r, i) => {
      const c = r.work_type?.trim();
      if (!c) return;
      const codeCraft = codeMap.get(c.toLowerCase());
      if (codeCraft && codeCraft !== declaredCraft) {
        warnings.workTypeMismatch.push({
          rowIndex: i,
          declared: declaredCraft,
          code: c,
          codeCraft,
        });
      }
    });
  }

  return warnings;
}

function summarize(parsed: ParseResult): Record<string, unknown> {
  return {
    row_count: parsed.rows.length,
    unmapped_headers: parsed.unmappedHeaders,
    inferred_roc_weights: parsed.inferredRocWeights,
    inferred_roc_labels: parsed.inferredRocLabels,
  };
}

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

  // Caller client (anon + caller's JWT) — used to assert auth and read
  // app_users for tenant resolution.
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
  // assert_role in upload_queue_submit handles the full check, but we
  // pre-gate here so we don't bother parsing on a definite-deny.
  const ALLOWED_ROLES = new Set([
    'clerk',
    'editor',
    'pc_reviewer',
    'pm',
    'admin',
    'super_admin',
  ]);
  if (!ALLOWED_ROLES.has(caller.role)) {
    return json({ error: `role ${caller.role} cannot submit to queue` }, 403);
  }

  // Multipart parse.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'multipart/form-data required' }, 400);
  }

  const projectId = form.get('projectId');
  const declaredCraft = form.get('declaredCraft');
  const weekEnding = form.get('weekEnding');
  const label = form.get('label');
  const overrideWarningsRaw = form.get('overrideWarnings');
  const file = form.get('file');

  if (typeof projectId !== 'string' || !projectId) {
    return json({ error: 'projectId required' }, 400);
  }
  if (typeof declaredCraft !== 'string' || !declaredCraft) {
    return json({ error: 'declaredCraft required' }, 400);
  }
  if (!(file instanceof File)) {
    return json({ error: 'file required (multipart field name "file")' }, 400);
  }
  if (file.size === 0) {
    return json({ error: 'file is empty' }, 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return json(
      { error: `file too large (${file.size} bytes; max ${MAX_FILE_BYTES})` },
      413,
    );
  }
  const overrideWarnings = overrideWarningsRaw === 'true';

  // Service-role client — needed for storage writes (clerk has no
  // bucket-INSERT policy) and the RPCs that are SECURITY DEFINER.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'projectcontrols' },
  });

  // Parse the file. xlsx handles csv/xlsx/xls uniformly via the workbook
  // interface — read the buffer once and dispatch by extension hint.
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  let workbook: XLSX.WorkBook;
  try {
    if (ext === 'csv') {
      const text = await file.text();
      workbook = XLSX.read(text, { type: 'string' });
    } else {
      const buf = await file.arrayBuffer();
      workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
    }
  } catch (err) {
    return json({ error: `parse failed: ${(err as Error).message}` }, 400);
  }

  const parsed = parseProgressWorkbook(workbook);
  if (parsed.rows.length === 0) {
    return json({ error: 'no rows parsed from file' }, 400);
  }

  const heuristicWarnings = await buildHeuristicWarnings(
    admin,
    caller.tenant_id,
    declaredCraft,
    parsed.rows,
  );
  const hasHeuristicWarning =
    heuristicWarnings.disciplineMismatch.length > 0 ||
    heuristicWarnings.workTypeMismatch.length > 0;
  if (hasHeuristicWarning && !overrideWarnings) {
    // Surface back so the client UI can show the warning + a confirm
    // "submit anyway" button which re-POSTs with overrideWarnings=true.
    return json(
      {
        error: 'heuristic warnings present — submit again with overrideWarnings=true to confirm',
        heuristicWarnings,
        parseSummary: summarize(parsed),
      },
      409,
    );
  }

  // Storage path: <tenant_id>/<project_id>/<random-uuid>/<filename>.
  // The third segment is a fresh uuid (not the upload_queue.id) because
  // the queue row's id is generated by gen_random_uuid() inside the
  // upload_queue_submit RPC and we need a stable path before that
  // returns. The canonical path is persisted to upload_queue.file_path
  // + parsed_path, so every downstream consumer (queue-approve-upload,
  // admin cleanup) reads the path from the column rather than deriving
  // it from the queue id.
  const pathSegment = crypto.randomUUID();
  const baseFilename = file.name.replace(/[^\w.\-]/g, '_');
  const filePath = `${caller.tenant_id}/${projectId}/${pathSegment}/${baseFilename}`;
  const parsedPath = `${caller.tenant_id}/${projectId}/${pathSegment}/parsed.json`;

  // Storage uploads via service role. We do file then parsed.json so a
  // file-upload failure leaves no orphan parsed.json. RPC follows; an
  // RPC failure leaves Storage objects but no queue row — those are
  // cleanable by an admin sweep (not blocking).
  const fileBuf = await file.arrayBuffer();
  const fileUpload = await admin.storage
    .from('upload-queue')
    .upload(filePath, fileBuf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (fileUpload.error) {
    return json({ error: `storage (file): ${fileUpload.error.message}` }, 500);
  }

  const parsedJson = new TextEncoder().encode(JSON.stringify(parsed.rows));
  const parsedUpload = await admin.storage
    .from('upload-queue')
    .upload(parsedPath, parsedJson, {
      contentType: 'application/json',
      upsert: false,
    });
  if (parsedUpload.error) {
    // Best-effort cleanup of the original file so we don't leak an
    // orphan storage object. The row didn't get inserted, so the
    // orphan would be harmless but storage costs aren't free.
    await admin.storage.from('upload-queue').remove([filePath]);
    return json({ error: `storage (parsed): ${parsedUpload.error.message}` }, 500);
  }

  // upload_queue_submit asserts role + (project, craft) permission,
  // INSERTs the queued row (id generated by the RPC), and writes the
  // submit audit_log line.
  const { data: submitData, error: submitErr } = await callerClient.rpc(
    'upload_queue_submit',
    {
      p_project_id: projectId,
      p_declared_craft: declaredCraft,
      p_file_path: filePath,
      p_parsed_path: parsedPath,
      p_original_filename: file.name,
      p_file_size_bytes: file.size,
      p_parse_summary: summarize(parsed),
      p_heuristic_warnings: hasHeuristicWarning ? heuristicWarnings : null,
      p_override_warnings: overrideWarnings,
      p_week_ending: typeof weekEnding === 'string' ? weekEnding : null,
      p_label: typeof label === 'string' ? label : null,
    },
  );
  if (submitErr) {
    // Submission rejected (role / craft permission / project mismatch).
    // Clean up Storage so a corrected resubmit doesn't get a path
    // collision warning.
    await admin.storage.from('upload-queue').remove([filePath, parsedPath]);
    return json({ error: `submit: ${submitErr.message}` }, 400);
  }
  const realQueueId = submitData as string;

  // Fire-and-forget LLM scan. EdgeRuntime.waitUntil keeps the in-flight
  // request alive past this fn's response so the LLM result lands on
  // the queue row when it completes.
  const llmUrl = `${SUPABASE_URL}/functions/v1/queue-llm-check`;
  const llmReq = fetch(llmUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ queueId: realQueueId }),
  }).catch(() => {
    // Swallow — the queue row's llm_scan_state stays 'pending' and the
    // auditor sees only heuristic results. Logged in llm_invocation_log
    // by queue-llm-check if it ever runs.
  });
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === 'function') {
    er.waitUntil(llmReq);
  }

  return json({
    queueId: realQueueId,
    parseSummary: summarize(parsed),
    heuristicWarnings: hasHeuristicWarning ? heuristicWarnings : null,
    llmScanState: 'pending',
  });
});
