// import-audit-records
//
// Accepts a .xlsx workbook, validates each row against a subset of the
// 61-column unified schema (the columns the database needs — drawing,
// quantity, COA, discipline, status), and calls record_bulk_upsert in a
// single transaction. Whole-file atomicity: any validation failure
// rejects the import; the RPC additionally rejects on FK miss.
//
// Frontend invokes this via supabase.functions.invoke('import-audit-records', {
//   body: { project_id, file: <base64-xlsx> }
// })
//
// Deploy: `supabase functions deploy import-audit-records`

import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';

const MAX_ROWS = parseInt(Deno.env.get('IMPORT_MAX_ROWS') ?? '50000', 10);

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

const REQUIRED = ['rec_no', 'dwg', 'rev', 'description', 'discipline_code', 'coa_code', 'uom', 'fld_qty'] as const;
const UOMS = new Set(['LF', 'CY', 'EA', 'TONS', 'SF', 'HR', 'LS']);
const DISCIPLINES = new Set(['CIVIL', 'PIPE', 'STEEL', 'ELEC', 'MECH', 'INST', 'SITE']);
const STATUSES = new Set(['draft', 'active', 'complete', 'void']);

type ParsedRow = {
  rec_no: number;
  dwg: string;
  rev: string;
  description: string;
  discipline_code: string;
  coa_code: string;
  uom: string;
  fld_qty: number;
  fld_whrs: number | null;
  record_status: string | null;
};

type RowError = { source_row: number; field: string; message: string };

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in o && o[k] != null && o[k] !== '') return o[k];
  }
  return undefined;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function validateRow(row: Record<string, unknown>, sourceRow: number): { row?: ParsedRow; errors: RowError[] } {
  const errors: RowError[] = [];

  // Tolerant column-name mapping: workbooks use varying casings.
  const lookup = (...keys: string[]) => {
    const lc: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) lc[k.toLowerCase().replace(/[\s/]+/g, '_')] = v;
    return pick(lc, ...keys.map((k) => k.toLowerCase()));
  };

  const recNo = num(lookup('rec_no', 'rec', 'rec#', 'record_number'));
  if (recNo == null) errors.push({ source_row: sourceRow, field: 'rec_no', message: 'required integer' });

  const dwg = str(lookup('dwg', 'drawing', 'dwg_no'));
  if (!dwg) errors.push({ source_row: sourceRow, field: 'dwg', message: 'required' });

  const rev = str(lookup('rev', 'revision'));
  if (!rev) errors.push({ source_row: sourceRow, field: 'rev', message: 'required' });

  const description = str(lookup('description', 'desc'));
  if (!description) errors.push({ source_row: sourceRow, field: 'description', message: 'required' });

  const disc = (str(lookup('discipline_code', 'discipline', 'disc')) ?? '').toUpperCase();
  if (!DISCIPLINES.has(disc))
    errors.push({
      source_row: sourceRow,
      field: 'discipline_code',
      message: `must be one of ${[...DISCIPLINES].join(', ')}`,
    });

  const coa = str(lookup('coa_code', 'coa', 'cost_code'));
  if (!coa) errors.push({ source_row: sourceRow, field: 'coa_code', message: 'required' });

  const uom = (str(lookup('uom', 'unit')) ?? '').toUpperCase();
  if (!UOMS.has(uom))
    errors.push({ source_row: sourceRow, field: 'uom', message: `must be one of ${[...UOMS].join(', ')}` });

  const fldQty = num(lookup('fld_qty', 'fld_quantity', 'field_qty'));
  if (fldQty == null) errors.push({ source_row: sourceRow, field: 'fld_qty', message: 'required number' });
  else if (fldQty < 0) errors.push({ source_row: sourceRow, field: 'fld_qty', message: 'must be ≥ 0' });

  const fldWhrs = num(lookup('fld_whrs', 'fld_hours', 'field_hours'));

  const statusRaw = str(lookup('record_status', 'status'))?.toLowerCase() ?? null;
  if (statusRaw && !STATUSES.has(statusRaw)) {
    errors.push({
      source_row: sourceRow,
      field: 'record_status',
      message: `must be one of ${[...STATUSES].join(', ')}`,
    });
  }

  if (errors.length > 0) return { errors };

  return {
    row: {
      rec_no: recNo!,
      dwg: dwg!,
      rev: rev!,
      description: description!,
      discipline_code: disc,
      coa_code: coa!,
      uom,
      fld_qty: fldQty!,
      fld_whrs: fldWhrs,
      record_status: statusRaw,
    },
    errors: [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  if (!SUPABASE_URL || !ANON_KEY) {
    return json({ error: 'edge function misconfigured (missing env)' }, 500);
  }

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return json({ error: 'missing authorization' }, 401);

  let body: { project_id?: string; file?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json — expected { project_id, file: <base64> }' }, 400);
  }
  if (!body.project_id) return json({ error: 'project_id is required' }, 400);
  if (!body.file) return json({ error: 'file (base64) is required' }, 400);

  // Decode base64 → Uint8Array → workbook → first sheet.
  let rows: Record<string, unknown>[];
  try {
    const b64 = body.file.replace(/^data:[^;]+;base64,/, '');
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const wb = XLSX.read(bin, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return json({ error: 'workbook has no sheets' }, 400);
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  } catch (e) {
    return json({ error: `failed to parse workbook: ${(e as Error).message}` }, 400);
  }

  if (rows.length === 0) return json({ error: 'workbook has no data rows' }, 400);
  if (rows.length > MAX_ROWS) {
    return json({ error: `workbook exceeds ${MAX_ROWS} rows; split into batches` }, 413);
  }

  // Validate every row before sending anything to the DB. Whole-file atomicity.
  const validated: ParsedRow[] = [];
  const errors: RowError[] = [];
  rows.forEach((r, i) => {
    const result = validateRow(r, i + 2); // +2 because 1-indexed and the header row
    if (result.errors.length) errors.push(...result.errors);
    else if (result.row) validated.push(result.row);
  });

  if (errors.length > 0) {
    return json(
      {
        error: 'validation failed',
        errors: errors.slice(0, 50),
        truncated: errors.length > 50,
      },
      400,
    );
  }

  // Caller-scoped client — RPC enforces tenant + role gating internally.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
    db: { schema: 'projectcontrols' },
  });

  const { data, error } = await callerClient.rpc('record_bulk_upsert', {
    p_project_id: body.project_id,
    p_rows: validated,
  });

  if (error) return json({ error: error.message }, 400);

  return json({ ok: true, ...(data as Record<string, unknown>) });
});
