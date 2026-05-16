// queue-llm-check
//
// A20 Wave 2 — async LLM consistency scan. Invoked fire-and-forget by
// queue-progress-upload via EdgeRuntime.waitUntil. Reads the queued
// upload's parsed.json from Storage, asks Claude whether the file looks
// like a {declared_craft} audit, writes warnings (or "none") back to the
// queue row via the upload_queue_llm_update SECURITY DEFINER RPC.
//
// Body shape:  { queueId: uuid }
// Authorization: service_role JWT (caller is the queue-progress-upload
// edge fn). RLS bypass; the upload_queue_llm_update RPC is the only
// authorized write path for llm_warnings / llm_scan_state.
//
// Rate limit: max N (env: LLM_RATE_PER_HOUR, default 30) invocations
// per uploaded_by user per hour. Pre-INSERTs a row in llm_invocation_log
// before calling Anthropic so the count includes in-flight invocations.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

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

type LlmVerdict = 'consistent' | 'maybe_mismatch' | 'likely_mismatch';
type LlmWarnings = {
  verdict: LlmVerdict;
  concerns: string[];
};

// The prompt asks Claude to classify the parsed file against the declared
// craft. We give it the headers (first row), a sample of rows, and the
// list of known work_types for that craft, and ask for a structured JSON
// return. The model returns the JSON directly; we tolerate small drift
// in the wrapper (e.g. backticks) by extracting the first {...} block.
function buildPrompt(args: {
  declaredCraft: string;
  parsedRows: Record<string, unknown>[];
  workTypesForCraft: string[];
}): string {
  const sampleSize = Math.min(10, args.parsedRows.length);
  const sample = args.parsedRows.slice(0, sampleSize);
  const allKeys = new Set<string>();
  for (const r of args.parsedRows) {
    for (const k of Object.keys(r)) allKeys.add(k);
  }
  return [
    `You are auditing a construction-progress data file before it gets imported.`,
    `The clerk declared this file is a "${args.declaredCraft}" audit.`,
    ``,
    `Known WORK_TYPE codes for ${args.declaredCraft}:`,
    args.workTypesForCraft.length > 0
      ? args.workTypesForCraft.map((c) => `  - ${c}`).join('\n')
      : '  (none registered)',
    ``,
    `Fields present in the parsed rows: ${[...allKeys].join(', ')}`,
    ``,
    `First ${sampleSize} parsed rows (JSON):`,
    JSON.stringify(sample, null, 2),
    ``,
    `Does this file look consistent with a "${args.declaredCraft}" audit, or does it look like it was mis-declared?`,
    ``,
    `Return ONLY a JSON object with this exact shape, no prose:`,
    `{"verdict": "consistent" | "maybe_mismatch" | "likely_mismatch", "concerns": ["short string", ...]}`,
    ``,
    `"consistent" — fields, work types, descriptions are typical for the declared craft.`,
    `"maybe_mismatch" — some weak signals don't fit; could be a multi-discipline file or unusual project.`,
    `"likely_mismatch" — strong signals this is a different craft (e.g. clerk declared "CIVIL" but rows are all pipe spools).`,
    ``,
    `"concerns" is a list of short human-readable strings (max 3) explaining specific evidence; empty if verdict is "consistent".`,
  ].join('\n');
}

function extractJsonBlock(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'edge function misconfigured (env)' }, 500);
  }

  // Caller must hold the service-role key (this fn is invoked fire-and-
  // forget from queue-progress-upload). Reject any other JWT so a clerk
  // can't spoof an LLM result by hitting this URL directly.
  const auth = req.headers.get('Authorization') ?? '';
  const expected = `Bearer ${SERVICE_KEY}`;
  if (auth !== expected) {
    return json({ error: 'service-role required' }, 401);
  }

  let body: { queueId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!body.queueId) return json({ error: 'queueId required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'projectcontrols' },
  });

  // Load the queue row to get tenant + uploader + paths + declared craft.
  const { data: row, error: rowErr } = await admin
    .from('upload_queue')
    .select('id, tenant_id, uploaded_by, declared_craft, parsed_path, llm_scan_state')
    .eq('id', body.queueId)
    .maybeSingle();
  if (rowErr || !row) {
    return json({ error: 'queue row not found', detail: rowErr?.message }, 404);
  }
  if (row.llm_scan_state !== 'pending') {
    // Already scanned (or marked failed). No-op so retries don't double-bill.
    return json({ ok: true, skipped: true });
  }

  // Rate-limit: count this user's invocations in the last hour. Insert the
  // log row BEFORE the API call so concurrent submissions can't race past
  // the cap. ok defaults to false; we UPDATE on success.
  const limitPerHour = Number(Deno.env.get('LLM_RATE_PER_HOUR') ?? '30');
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recent, error: countErr } = await admin
    .from('llm_invocation_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', row.uploaded_by)
    .gt('invoked_at', hourAgo);
  if (countErr) {
    return json({ error: 'rate-limit count failed', detail: countErr.message }, 500);
  }
  if ((recent ?? 0) >= limitPerHour) {
    await admin.rpc('upload_queue_llm_update', {
      p_queue_id: row.id,
      p_warnings: { verdict: 'consistent', concerns: ['rate limit — scan skipped'] },
      p_state: 'failed',
    });
    return json({ ok: true, rateLimited: true });
  }

  const { data: logRow, error: logErr } = await admin
    .from('llm_invocation_log')
    .insert({
      tenant_id: row.tenant_id,
      user_id: row.uploaded_by,
      queue_id: row.id,
      model: MODEL,
    })
    .select('id')
    .single();
  if (logErr || !logRow) {
    return json({ error: 'rate-limit insert failed', detail: logErr?.message }, 500);
  }

  // Anthropic optional — if not configured we still bookkeep + mark
  // failed so the auditor knows the LLM result is unavailable but
  // doesn't see an indefinite "scanning…" state.
  if (!ANTHROPIC_API_KEY) {
    await admin
      .from('llm_invocation_log')
      .update({ ok: false, error: 'ANTHROPIC_API_KEY not configured' })
      .eq('id', logRow.id);
    await admin.rpc('upload_queue_llm_update', {
      p_queue_id: row.id,
      p_warnings: null,
      p_state: 'failed',
    });
    return json({ ok: true, skipped: true, reason: 'no-api-key' });
  }

  // Load parsed.json + work_types for the declared craft.
  const parsedDl = await admin.storage.from('upload-queue').download(row.parsed_path);
  if (parsedDl.error || !parsedDl.data) {
    await admin
      .from('llm_invocation_log')
      .update({ ok: false, error: `storage: ${parsedDl.error?.message ?? 'no data'}` })
      .eq('id', logRow.id);
    await admin.rpc('upload_queue_llm_update', {
      p_queue_id: row.id,
      p_warnings: null,
      p_state: 'failed',
    });
    return json({ error: 'parsed.json download failed' }, 500);
  }
  let parsedRows: Record<string, unknown>[];
  try {
    parsedRows = JSON.parse(await parsedDl.data.text());
  } catch (err) {
    await admin
      .from('llm_invocation_log')
      .update({ ok: false, error: `parse parsed.json: ${(err as Error).message}` })
      .eq('id', logRow.id);
    await admin.rpc('upload_queue_llm_update', {
      p_queue_id: row.id,
      p_warnings: null,
      p_state: 'failed',
    });
    return json({ error: 'parsed.json corrupt' }, 500);
  }

  const { data: wts } = await admin
    .from('work_types')
    .select('work_type_code')
    .eq('tenant_id', row.tenant_id)
    .eq('discipline_code', row.declared_craft);
  const workTypesForCraft = ((wts ?? []) as { work_type_code: string }[]).map(
    (w) => w.work_type_code,
  );

  const prompt = buildPrompt({
    declaredCraft: row.declared_craft,
    parsedRows,
    workTypesForCraft,
  });

  let warnings: LlmWarnings | null = null;
  let apiOk = false;
  let apiErr: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) {
      apiErr = `anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
    } else {
      const j = await resp.json();
      inputTokens = j?.usage?.input_tokens ?? null;
      outputTokens = j?.usage?.output_tokens ?? null;
      const text = j?.content?.[0]?.text ?? '';
      const parsed = extractJsonBlock(text);
      if (
        parsed &&
        typeof parsed === 'object' &&
        ['consistent', 'maybe_mismatch', 'likely_mismatch'].includes(
          (parsed as LlmWarnings).verdict,
        )
      ) {
        warnings = {
          verdict: (parsed as LlmWarnings).verdict,
          concerns: Array.isArray((parsed as LlmWarnings).concerns)
            ? (parsed as LlmWarnings).concerns.slice(0, 5).map((c) => String(c))
            : [],
        };
        apiOk = true;
      } else {
        apiErr = 'LLM response did not contain a valid verdict object';
      }
    }
  } catch (err) {
    apiErr = (err as Error).message;
  }

  // Update the log row with the API outcome.
  await admin
    .from('llm_invocation_log')
    .update({
      ok: apiOk,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      error: apiErr,
    })
    .eq('id', logRow.id);

  // Persist the warnings (or null on failure) and flip the queue row's
  // llm_scan_state via the narrow SECURITY DEFINER RPC.
  const { error: updErr } = await admin.rpc('upload_queue_llm_update', {
    p_queue_id: row.id,
    p_warnings: apiOk ? warnings : null,
    p_state: apiOk ? 'done' : 'failed',
  });
  if (updErr) {
    return json({ error: 'llm_update rpc: ' + updErr.message }, 500);
  }

  return json({ ok: true, verdict: warnings?.verdict ?? null });
});
