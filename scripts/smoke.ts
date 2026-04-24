/**
 * Phase 0 smoke test — authenticates as the seeded UAT admin, queries projects,
 * and calls a couple of RPCs. Prints a concise pass/fail summary.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
    }
  } catch {}
}

async function main() {
  loadEnv();
  const url = process.env.SUPABASE_URL!;
  const anon = process.env.VITE_SUPABASE_ANON_KEY!;
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) {
    console.error('Set SMOKE_EMAIL and SMOKE_PASSWORD in .env (gitignored) before running.');
    process.exit(1);
  }

  const sb = createClient(url, anon, {
    auth: { persistSession: false },
    db: { schema: 'projectcontrols' },
  });

  const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
  if (signInErr) {
    console.error(`✗ sign-in failed: ${signInErr.message}`);
    process.exit(1);
  }
  console.log(`✓ signed in as ${email}`);

  const { data: projects, error: projErr } = await sb
    .from('projects')
    .select('id, project_code, name, status');
  if (projErr) {
    console.error(`✗ projects query failed: ${projErr.message}`);
    process.exit(1);
  }
  console.log(`✓ projects: ${projects?.length ?? 0}`);
  projects?.forEach((p) => console.log(`    - ${p.project_code}: ${p.name} (${p.status})`));

  const firstProject = projects?.find((p) => p.project_code === 'KIS-2026-001');
  if (!firstProject) {
    console.error('✗ expected KIS-2026-001 not found');
    process.exit(1);
  }

  const { data: summary, error: rpcErr } = await sb.rpc('project_summary', {
    p_project_id: firstProject.id,
  });
  if (rpcErr) {
    console.error(`✗ project_summary RPC failed: ${rpcErr.message}`);
    process.exit(1);
  }
  console.log('✓ project_summary RPC:');
  console.log(`    total_budget_hrs: ${summary.total_budget_hrs}`);
  console.log(`    total_earned_hrs: ${summary.total_earned_hrs?.toFixed?.(1) ?? summary.total_earned_hrs}`);
  console.log(`    total_actual_hrs: ${summary.total_actual_hrs}`);
  console.log(`    overall_pct:      ${(summary.overall_pct * 100).toFixed(1)}%`);
  console.log(`    cpi:              ${summary.cpi?.toFixed?.(3) ?? summary.cpi}`);
  console.log(`    spi:              ${summary.spi?.toFixed?.(3) ?? summary.spi}`);
  console.log(`    disciplines:      ${summary.disciplines.length}`);

  const { data: budget, error: budgetErr } = await sb.rpc('budget_rollup', {
    p_project_id: firstProject.id,
  });
  if (budgetErr) {
    console.error(`✗ budget_rollup RPC failed: ${budgetErr.message}`);
    process.exit(1);
  }
  console.log('✓ budget_rollup RPC:');
  console.log(`    original_budget: ${budget.original_budget}`);
  console.log(`    current_budget:  ${budget.current_budget}`);
  console.log(`    forecast_budget: ${budget.forecast_budget}`);

  console.log('\n✓ Phase 0 smoke PASS');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
