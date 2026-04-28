/**
 * Comprehensive smoke runner — exercises every mutating RPC and reports
 * pass/fail per test. Runs against your hosted Supabase project (or local
 * `supabase start`). Authenticates as a real admin (SMOKE_EMAIL +
 * SMOKE_PASSWORD) so RPCs see a real auth.uid() — service-role doesn't
 * work because every mutating RPC calls assert_role(min_role).
 *
 * Run: `npx tsx scripts/smoke/run.ts`
 *
 * Tests are grouped: setup, read paths, library mutations, audit-record
 * lifecycle, change-order workflow, cleanup. Destructive one-way RPCs
 * (project_lock_baseline, period_close, admin_set_user_role) are skipped
 * by default; pass `--include-destructive` to include `admin_set_user_role`
 * (the others are still skipped because they can't be reversed without a
 * fresh seed).
 *
 * Test data uses identifiers prefixed `SMOKE-` so it's easy to spot and
 * clean up by hand if anything goes sideways.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const COA_TEST_CODE = 'SMOKE-1';
const REC_NO_BASE = 99001;
const PROJECT_CODE = 'KIS-2026-001';

const ANSI = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
    }
  } catch {}
}

type Result = { name: string; ok: boolean; ms: number; err?: string; skipped?: boolean };
const results: Result[] = [];

async function step(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  process.stdout.write(`  ${name}...`);
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    process.stdout.write(` ${ANSI.green}✓${ANSI.reset} ${ANSI.dim}${ms}ms${ANSI.reset}\n`);
  } catch (e) {
    const ms = Date.now() - t0;
    const err = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, ms, err });
    process.stdout.write(` ${ANSI.red}✗${ANSI.reset} ${ANSI.dim}${ms}ms${ANSI.reset}\n`);
    process.stdout.write(`    ${ANSI.red}${err}${ANSI.reset}\n`);
  }
}

function skip(name: string, reason: string) {
  results.push({ name, ok: true, ms: 0, skipped: true, err: reason });
  process.stdout.write(`  ${name}... ${ANSI.yellow}⊘ skipped${ANSI.reset} ${ANSI.dim}(${reason})${ANSI.reset}\n`);
}

async function main() {
  loadEnv();
  const includeDestructive = process.argv.includes('--include-destructive');

  const url = process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;

  if (!url || !anon) {
    console.error('Missing SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
    process.exit(1);
  }
  if (!email || !password) {
    console.error('Set SMOKE_EMAIL and SMOKE_PASSWORD in .env to a real admin user.');
    process.exit(1);
  }

  console.log(`${ANSI.bold}Smoke runner${ANSI.reset}`);
  console.log(`  target:   ${url}`);
  console.log(`  user:     ${email}`);
  console.log(`  destructive: ${includeDestructive ? ANSI.yellow + 'on' + ANSI.reset : ANSI.dim + 'off' + ANSI.reset}\n`);

  const sb = createClient(url, anon, {
    auth: { persistSession: false },
    db: { schema: 'projectcontrols' },
  });

  // ─────────────────────────────────────────────────────────────────
  // Setup
  // ─────────────────────────────────────────────────────────────────
  console.log(`${ANSI.bold}1. Setup${ANSI.reset}`);

  await step('sign in', async () => {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  });

  let projectId = '';
  let disciplineId = '';
  let coaSpec = { id: '', code: '', pf_rate: 0 };
  let createdRecords: { id: string; rec_no: number }[] = [];
  let testCoId = '';

  await step(`fetch project ${PROJECT_CODE}`, async () => {
    const { data, error } = await sb
      .from('projects')
      .select('id')
      .eq('project_code', PROJECT_CODE)
      .single();
    if (error) throw new Error(error.message);
    projectId = data.id;
  });

  await step('fetch a project_disciplines row (PIPE)', async () => {
    const { data, error } = await sb
      .from('project_disciplines')
      .select('id')
      .eq('project_id', projectId)
      .eq('discipline_code', 'PIPE')
      .single();
    if (error) throw new Error(error.message);
    disciplineId = data.id;
  });

  await step('fetch a COA code (202 — Carbon Steel Pipe 2"-6")', async () => {
    const { data, error } = await sb
      .from('coa_codes')
      .select('id, code, pf_rate')
      .eq('code', '202')
      .single();
    if (error) throw new Error(error.message);
    coaSpec = { id: data.id, code: data.code, pf_rate: Number(data.pf_rate) };
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. Read paths — exercise the dashboard / reports SQL surface.
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${ANSI.bold}2. Read paths${ANSI.reset}`);

  await step('project_summary', async () => {
    const { error } = await sb.rpc('project_summary', { p_project_id: projectId });
    if (error) throw new Error(error.message);
  });

  await step('budget_rollup', async () => {
    const { error } = await sb.rpc('budget_rollup', { p_project_id: projectId });
    if (error) throw new Error(error.message);
  });

  await step('progress_periods list', async () => {
    const { error } = await sb
      .from('progress_periods')
      .select('id, period_number, locked_at')
      .eq('project_id', projectId);
    if (error) throw new Error(error.message);
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. Library mutations
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${ANSI.bold}3. Library mutations${ANSI.reset}`);

  await step('coa_code_upsert (insert SMOKE-1)', async () => {
    const { error } = await sb.rpc('coa_code_upsert', {
      p_payload: {
        prime: '999',
        code: COA_TEST_CODE,
        description: 'Smoke test cost code',
        parent: null,
        level: 2,
        uom: 'EA',
        base_rate: 1.0,
        pf_adj: 1.0,
      },
    });
    if (error) throw new Error(error.message);
  });

  await step('coa_code_upsert (update SMOKE-1)', async () => {
    const { error } = await sb.rpc('coa_code_upsert', {
      p_payload: {
        prime: '999',
        code: COA_TEST_CODE,
        description: 'Smoke test cost code (updated)',
        parent: null,
        level: 2,
        uom: 'EA',
        base_rate: 1.5,
        pf_adj: 1.1,
      },
    });
    if (error) throw new Error(error.message);
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. Audit record lifecycle
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${ANSI.bold}4. Audit records${ANSI.reset}`);

  await step('record_bulk_upsert (insert 2 rows)', async () => {
    const { error } = await sb.rpc('record_bulk_upsert', {
      p_project_id: projectId,
      p_rows: [
        {
          rec_no: REC_NO_BASE,
          dwg: 'SMOKE-1',
          rev: '1',
          description: 'Smoke test record A',
          discipline_code: 'PIPE',
          coa_code: '202',
          uom: 'LF',
          fld_qty: 100,
        },
        {
          rec_no: REC_NO_BASE + 1,
          dwg: 'SMOKE-2',
          rev: '1',
          description: 'Smoke test record B',
          discipline_code: 'PIPE',
          coa_code: '202',
          uom: 'LF',
          fld_qty: 50,
        },
      ],
    });
    if (error) throw new Error(error.message);
  });

  await step('audit_records list — verify SMOKE rows present', async () => {
    const { data, error } = await sb
      .from('audit_records')
      .select('id, rec_no')
      .eq('project_id', projectId)
      .gte('rec_no', REC_NO_BASE)
      .lte('rec_no', REC_NO_BASE + 1);
    if (error) throw new Error(error.message);
    if (!data || data.length !== 2) throw new Error(`expected 2 rows, got ${data?.length ?? 0}`);
    createdRecords = data.map((r) => ({ id: r.id as string, rec_no: r.rec_no as number }));
  });

  await step('record_update_milestones (set M1=0.5, M2=0.25)', async () => {
    const { error } = await sb.rpc('record_update_milestones', {
      p_record_id: createdRecords[0]?.id,
      p_milestones: [
        { seq: 1, value: 0.5 },
        { seq: 2, value: 0.25 },
      ],
    });
    if (error) throw new Error(error.message);
  });

  await step('audit_record_ev refreshed for the updated row', async () => {
    const { data, error } = await sb
      .from('audit_record_ev')
      .select('earn_pct, earn_whrs')
      .eq('record_id', createdRecords[0]?.id)
      .single();
    if (error) throw new Error(error.message);
    if (!data || Number(data.earn_pct) <= 0) {
      throw new Error(`earn_pct should be > 0, got ${data?.earn_pct}`);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // 5. Change order workflow
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${ANSI.bold}5. Change order workflow${ANSI.reset}`);

  await step('co_submit (scope_add, +25 LF)', async () => {
    const { data, error } = await sb.rpc('co_submit', {
      p_payload: {
        project_id: projectId,
        date: new Date().toISOString().slice(0, 10),
        discipline_id: disciplineId,
        type: 'scope_add',
        description: 'SMOKE test CO — added scope',
        qty_change: 25,
        uom: 'LF',
        requested_by: 'Smoke Runner',
      },
    });
    if (error) throw new Error(error.message);
    testCoId = data as string;
    if (!testCoId) throw new Error('co_submit returned no id');
  });

  await step('co_pc_review (forward)', async () => {
    const { error } = await sb.rpc('co_pc_review', {
      p_co_id: testCoId,
      p_decision: 'forward',
      p_notes: 'PC reviewed in smoke run',
    });
    if (error) throw new Error(error.message);
  });

  await step('co_approve (forward)', async () => {
    const { error } = await sb.rpc('co_approve', {
      p_co_id: testCoId,
      p_decision: 'forward',
      p_notes: 'PM approved in smoke run',
    });
    if (error) throw new Error(error.message);
  });

  await step('budget_rollup reflects approved CO', async () => {
    const { data, error } = await sb.rpc('budget_rollup', { p_project_id: projectId });
    if (error) throw new Error(error.message);
    const approved = Number((data as { approved_changes_hrs?: number }).approved_changes_hrs ?? 0);
    if (approved <= 0) {
      throw new Error(`approved_changes_hrs should be > 0 after approval, got ${approved}`);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // 6. Destructive (skipped by default)
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${ANSI.bold}6. Destructive RPCs${ANSI.reset}`);

  if (includeDestructive) {
    await step('admin_set_user_role (round-trip)', async () => {
      // Find ourselves; toggle role to admin (already admin) — no-op but
      // exercises the RPC path. This is the safest "destructive" test.
      const { data: u, error: uErr } = await sb.auth.getUser();
      if (uErr || !u?.user) throw new Error(uErr?.message ?? 'no auth user');
      const { error } = await sb.rpc('admin_set_user_role', {
        p_user_id: u.user.id,
        p_new_role: 'admin',
        p_reason: 'smoke test no-op',
      });
      if (error) throw new Error(error.message);
    });
  } else {
    skip('admin_set_user_role', 'pass --include-destructive to run');
  }
  skip('project_lock_baseline', 'one-way; needs a draft project');
  skip('period_close', 'one-way; locks a real period');

  // ─────────────────────────────────────────────────────────────────
  // 7. Cleanup — best-effort. Failures here don't fail the run since the
  //    main verification has already happened.
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${ANSI.bold}7. Cleanup${ANSI.reset}`);

  const cleanup = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      process.stdout.write(`  ${name}... ${ANSI.green}✓${ANSI.reset}\n`);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      process.stdout.write(`  ${name}... ${ANSI.yellow}skipped (${err})${ANSI.reset}\n`);
    }
  };

  await cleanup('delete test CO and events', async () => {
    if (testCoId) await sb.from('change_order_events').delete().eq('co_id', testCoId);
    if (testCoId) await sb.from('change_orders').delete().eq('id', testCoId);
  });

  await cleanup('delete test audit records', async () => {
    if (createdRecords.length > 0) {
      await sb
        .from('audit_records')
        .delete()
        .in('id', createdRecords.map((r) => r.id));
    }
  });

  await cleanup('delete test COA code', async () => {
    await sb.from('coa_codes').delete().eq('code', COA_TEST_CODE);
  });

  // ─────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  const total = passed + failed;

  console.log(`\n${ANSI.bold}Summary${ANSI.reset}`);
  console.log(`  ${ANSI.green}${passed} passed${ANSI.reset}, ${failed > 0 ? ANSI.red : ANSI.dim}${failed} failed${ANSI.reset}, ${ANSI.yellow}${skipped} skipped${ANSI.reset} (of ${total} run)`);

  if (failed > 0) {
    console.log(`\n${ANSI.red}${ANSI.bold}FAIL${ANSI.reset}`);
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  ${ANSI.red}✗${ANSI.reset} ${r.name}: ${r.err}`);
    }
    process.exit(1);
  }

  console.log(`\n${ANSI.green}${ANSI.bold}PASS${ANSI.reset}`);
}

main().catch((e) => {
  console.error('\nSMOKE FAILED:', e);
  process.exit(1);
});
