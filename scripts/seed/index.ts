/**
 * Seed script — npm run seed:{minimal,demo,stress}
 *
 * Targets the local Supabase project by default (reads SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY from environment). Idempotent: upserts on
 * natural keys so it can be re-run.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Mode = 'minimal' | 'demo' | 'stress';

// ----- env loading (tiny, so we don't add a dotenv dependency) ---------------
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
    }
  } catch {
    // no .env file — ok, fall back to process env
  }
}

// ----- main ------------------------------------------------------------------
async function main() {
  loadEnv();
  const mode = (process.argv[2] ?? 'minimal') as Mode;
  if (!['minimal', 'demo', 'stress'].includes(mode)) {
    throw new Error(`Unknown mode: ${mode}`);
  }

  const url = process.env.SUPABASE_URL ?? 'http://localhost:54321';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY not set. Find it in `supabase status` output (service_role key).',
    );
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: 'projectcontrols' },
  });

  console.log(`→ Seeding (mode: ${mode}) against ${url}`);

  // --- 1. Tenant
  const tenantName = 'Kindred Industrial Services';
  const { data: existingTenant } = await sb
    .from('tenants')
    .select('id')
    .eq('name', tenantName)
    .maybeSingle();

  const tenantId: string =
    existingTenant?.id ??
    (await (async () => {
      const { data, error } = await sb
        .from('tenants')
        .insert({ name: tenantName })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    })());
  console.log(`  tenant: ${tenantId}`);

  // --- 2. Reuse existing auth users (don't create new ones — the sister app's
  //       on_auth_user_created trigger would auto-promote any new signup to a
  //       ProgressTracker admin, which we don't want). Bind any existing users
  //       to this tenant in projectcontrols.app_users.
  async function bindExistingUser(email: string, role: string, displayName: string) {
    const { data: list } = await sb.auth.admin.listUsers();
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!existing) {
      console.log(`  (skipping ${email} — not in auth.users; create manually in Supabase Auth first)`);
      return null;
    }
    const { error } = await sb.from('app_users').upsert(
      {
        id: existing.id,
        tenant_id: tenantId,
        email,
        display_name: displayName,
        role,
        status: 'active',
      },
      { onConflict: 'id' },
    );
    if (error) throw error;
    console.log(`  bound ${email} as ${role}`);
    return existing.id;
  }

  // UAT admin from ProgressTracker's .env.local — reused for Phase 0 logins.
  await bindExistingUser('uat-bot@invenio.com', 'admin', 'UAT Admin');

  if (mode === 'minimal') {
    console.log('→ Minimal mode complete');
    return;
  }

  // --- 3. COA codes
  const coa = [
    { prime: '100', code: '101', description: 'Concrete Foundations', parent: '100', level: 2, uom: 'CY', base_rate: 8.5, pf_adj: 1.12 },
    { prime: '100', code: '102', description: 'Concrete Piles', parent: '100', level: 2, uom: 'EA', base_rate: 12.0, pf_adj: 1.08 },
    { prime: '100', code: '103', description: 'Structural Backfill', parent: '100', level: 2, uom: 'CY', base_rate: 4.2, pf_adj: 1.15 },
    { prime: '200', code: '201', description: 'Carbon Steel Pipe <2"', parent: '200', level: 2, uom: 'LF', base_rate: 1.85, pf_adj: 1.10 },
    { prime: '200', code: '202', description: 'Carbon Steel Pipe 2"-6"', parent: '200', level: 2, uom: 'LF', base_rate: 2.40, pf_adj: 1.10 },
    { prime: '200', code: '203', description: 'Carbon Steel Pipe 8"-12"', parent: '200', level: 2, uom: 'LF', base_rate: 3.60, pf_adj: 1.10 },
    { prime: '200', code: '210', description: 'Alloy Pipe', parent: '200', level: 2, uom: 'LF', base_rate: 5.20, pf_adj: 1.25 },
    { prime: '300', code: '301', description: 'Structural Steel Erection', parent: '300', level: 2, uom: 'TONS', base_rate: 28.0, pf_adj: 1.05 },
    { prime: '400', code: '401', description: 'Cable Tray', parent: '400', level: 2, uom: 'LF', base_rate: 1.40, pf_adj: 1.12 },
    { prime: '400', code: '402', description: 'Conduit', parent: '400', level: 2, uom: 'LF', base_rate: 0.85, pf_adj: 1.12 },
    { prime: '500', code: '501', description: 'Equipment Setting', parent: '500', level: 2, uom: 'EA', base_rate: 45.0, pf_adj: 1.08 },
    { prime: '600', code: '601', description: 'Instrument Installation', parent: '600', level: 2, uom: 'EA', base_rate: 6.5, pf_adj: 1.10 },
  ].map((c) => ({ ...c, tenant_id: tenantId }));

  const { error: coaErr } = await sb.from('coa_codes').upsert(coa, { onConflict: 'tenant_id,code' });
  if (coaErr) throw coaErr;
  console.log(`  coa_codes: ${coa.length}`);

  // --- 4. ROC templates + milestones
  const rocSpec = [
    { discipline_code: 'CIVIL', milestones: ['Excavation', 'Formwork', 'Rebar', 'Concrete', 'Strip Forms', 'Backfill', 'Grade/Finish', 'Punch List'], weights: [0.10, 0.15, 0.20, 0.25, 0.10, 0.10, 0.05, 0.05] },
    { discipline_code: 'PIPE', milestones: ['Receive Material', 'Fit-Up/Stage', 'Tack Weld', 'Final Weld', 'NDE/Test', 'Insulate', 'Paint', 'Punch List'], weights: [0.05, 0.15, 0.15, 0.25, 0.15, 0.10, 0.10, 0.05] },
    { discipline_code: 'STEEL', milestones: ['Receive Material', 'Fit-Up', 'Bolt-Up', 'Torque/Weld', 'Deck Install', 'Handrail', 'Touch-Up Paint', 'Punch List'], weights: [0.05, 0.10, 0.20, 0.25, 0.15, 0.10, 0.10, 0.05] },
    { discipline_code: 'ELEC', milestones: ['Lay Cable Tray', 'Pull Cable', 'Terminate', 'Megger Test', 'Energize', 'Label/Tag', 'Commission', 'Punch List'], weights: [0.10, 0.20, 0.15, 0.15, 0.15, 0.05, 0.10, 0.10] },
    { discipline_code: 'MECH', milestones: ['Set Equipment', 'Align', 'Grout', 'Connect Pipe', 'Connect Elec', 'Lube/Fill', 'Run Test', 'Punch List'], weights: [0.20, 0.15, 0.10, 0.10, 0.10, 0.10, 0.15, 0.10] },
    { discipline_code: 'INST', milestones: ['Mount Device', 'Run Tubing', 'Connect', 'Calibrate', 'Loop Check', 'Commission', 'Document', 'Punch List'], weights: [0.10, 0.15, 0.15, 0.15, 0.15, 0.15, 0.10, 0.05] },
    { discipline_code: 'SITE', milestones: ['Survey', 'Clear/Grub', 'Rough Grade', 'Compact', 'Pave/Surface', 'Drainage', 'Landscape', 'Punch List'], weights: [0.05, 0.10, 0.20, 0.20, 0.20, 0.10, 0.10, 0.05] },
  ];

  const rocTemplateIds: Record<string, string> = {};
  for (const spec of rocSpec) {
    const { data: tmpl, error: tErr } = await sb
      .from('roc_templates')
      .upsert(
        {
          tenant_id: tenantId,
          discipline_code: spec.discipline_code,
          name: `${spec.discipline_code} Standard`,
          version: 1,
          is_default: true,
        },
        { onConflict: 'tenant_id,discipline_code,version' },
      )
      .select('id')
      .single();
    if (tErr) throw tErr;
    rocTemplateIds[spec.discipline_code] = tmpl.id;

    // Replace all milestones for this template
    await sb.from('roc_milestones').delete().eq('template_id', tmpl.id);
    const rows = spec.milestones.map((label, i) => ({
      tenant_id: tenantId,
      template_id: tmpl.id,
      seq: i + 1,
      label,
      weight: spec.weights[i],
    }));
    const { error: mErr } = await sb.from('roc_milestones').insert(rows);
    if (mErr) throw mErr;
  }
  console.log(`  roc_templates: ${rocSpec.length} (8 milestones each)`);

  // --- 5. Projects
  const projectSpecs = [
    {
      project_code: 'KIS-2026-001',
      name: 'Turnaround Alpha',
      client: 'ExxonMobil Baytown',
      status: 'draft',
      start_date: '2026-01-15',
      end_date: '2026-12-31',
    },
    {
      project_code: 'KIS-2026-002',
      name: 'Unit 12 Expansion',
      client: 'Chevron Phillips',
      status: 'draft',
      start_date: '2026-06-01',
      end_date: '2027-06-30',
    },
  ];

  const projectIds: Record<string, string> = {};
  for (const p of projectSpecs) {
    const { data, error } = await sb
      .from('projects')
      .upsert({ ...p, tenant_id: tenantId }, { onConflict: 'tenant_id,project_code' })
      .select('id')
      .single();
    if (error) throw error;
    projectIds[p.project_code] = data.id;
  }
  console.log(`  projects: ${projectSpecs.length}`);

  // --- 6. Project disciplines (budget) — for KIS-2026-001
  const discSpec = [
    { code: 'CIVIL', display: 'Civil', budget: 28500 },
    { code: 'PIPE', display: 'Pipe', budget: 62000 },
    { code: 'STEEL', display: 'Steel', budget: 24000 },
    { code: 'ELEC', display: 'Electrical', budget: 38500 },
    { code: 'MECH', display: 'Mechanical', budget: 12000 },
    { code: 'INST', display: 'Instrumentation', budget: 15000 },
    { code: 'SITE', display: 'Site Work', budget: 5000 },
  ];

  const disciplineIds: Record<string, string> = {};
  for (const d of discSpec) {
    const { data, error } = await sb
      .from('project_disciplines')
      .upsert(
        {
          tenant_id: tenantId,
          project_id: projectIds['KIS-2026-001']!,
          discipline_code: d.code,
          display_name: d.display,
          roc_template_id: rocTemplateIds[d.code],
          budget_hrs: d.budget,
          is_active: true,
        },
        { onConflict: 'project_id,discipline_code' },
      )
      .select('id')
      .single();
    if (error) throw error;
    disciplineIds[d.code] = data.id;
  }
  console.log(`  project_disciplines: ${discSpec.length}`);

  // --- 7. Sample audit records (10)
  const { data: coaRows } = await sb.from('coa_codes').select('id, code').eq('tenant_id', tenantId);
  const coaByCode = Object.fromEntries((coaRows ?? []).map((r) => [r.code, r.id]));

  const recordSpec = [
    { rec: 1, dwg: 'C-1001', rev: '2', disc: 'CIVIL', desc: 'Foundation Pad A-101', qty: 45.0, uom: 'CY', whrs: 382.5, ms: [1, 1, 1, 0.5, 0, 0, 0, 0], code: '101' },
    { rec: 2, dwg: 'C-1002', rev: '1', disc: 'CIVIL', desc: 'Pile Cap B-201', qty: 28.0, uom: 'CY', whrs: 238.0, ms: [1, 1, 0.8, 0, 0, 0, 0, 0], code: '101' },
    { rec: 3, dwg: 'P-2001', rev: '3', disc: 'PIPE', desc: '2" CS — Line 2001-A', qty: 320.0, uom: 'LF', whrs: 768.0, ms: [1, 1, 1, 1, 0.5, 0, 0, 0], code: '202' },
    { rec: 4, dwg: 'P-2002', rev: '2', disc: 'PIPE', desc: '6" CS — Line 2002-B', qty: 180.0, uom: 'LF', whrs: 648.0, ms: [1, 1, 0.6, 0, 0, 0, 0, 0], code: '202' },
    { rec: 5, dwg: 'S-3001', rev: '1', disc: 'STEEL', desc: 'Platform Level 3 Steel', qty: 12.5, uom: 'TONS', whrs: 367.5, ms: [1, 1, 1, 0.8, 0, 0, 0, 0], code: '301' },
    { rec: 6, dwg: 'E-4001', rev: '2', disc: 'ELEC', desc: 'Cable Tray Run CT-101', qty: 450.0, uom: 'LF', whrs: 630.0, ms: [1, 0.7, 0, 0, 0, 0, 0, 0], code: '401' },
    { rec: 7, dwg: 'M-5001', rev: '1', disc: 'MECH', desc: 'Pump P-101 Setting', qty: 1.0, uom: 'EA', whrs: 48.6, ms: [1, 1, 0.5, 0, 0, 0, 0, 0], code: '501' },
    { rec: 8, dwg: 'I-6001', rev: '1', disc: 'INST', desc: 'FT-101 Flow Transmitter', qty: 1.0, uom: 'EA', whrs: 7.15, ms: [1, 1, 1, 1, 0, 0, 0, 0], code: '601' },
    { rec: 9, dwg: 'P-2003', rev: '1', disc: 'PIPE', desc: '8" CS — Line 2003-C', qty: 95.0, uom: 'LF', whrs: 376.2, ms: [1, 0.5, 0, 0, 0, 0, 0, 0], code: '203' },
    { rec: 10, dwg: 'C-1003', rev: '1', disc: 'CIVIL', desc: 'Equipment Pad C-301', qty: 62.0, uom: 'CY', whrs: 527.0, ms: [1, 1, 1, 1, 0.8, 0.5, 0, 0], code: '101' },
  ];

  for (const r of recordSpec) {
    const { data: existing } = await sb
      .from('audit_records')
      .select('id')
      .eq('project_id', projectIds['KIS-2026-001']!)
      .eq('rec_no', r.rec)
      .maybeSingle();

    let recordId: string;
    if (existing) {
      recordId = existing.id;
    } else {
      const { data, error } = await sb
        .from('audit_records')
        .insert({
          tenant_id: tenantId,
          project_id: projectIds['KIS-2026-001']!,
          discipline_id: disciplineIds[r.disc]!,
          coa_code_id: coaByCode[r.code]!,
          rec_no: r.rec,
          dwg: r.dwg,
          rev: r.rev,
          description: r.desc,
          uom: r.uom,
          fld_qty: r.qty,
          fld_whrs: r.whrs,
          status: 'active',
        })
        .select('id')
        .single();
      if (error) throw error;
      recordId = data.id;
    }

    // Update milestones (trigger seeded them at 0)
    for (let i = 0; i < 8; i++) {
      await sb
        .from('audit_record_milestones')
        .update({ value: r.ms[i] ?? 0 })
        .eq('record_id', recordId)
        .eq('seq', i + 1);
    }
  }
  console.log(`  audit_records: ${recordSpec.length} (with milestones)`);

  // --- 8. Actual hours — rough per-discipline totals
  const actualSpec = [
    { code: 'CIVIL', hrs: 11200 },
    { code: 'PIPE', hrs: 22900 },
    { code: 'STEEL', hrs: 9800 },
    { code: 'ELEC', hrs: 12400 },
    { code: 'MECH', hrs: 3500 },
    { code: 'INST', hrs: 4900 },
    { code: 'SITE', hrs: 3450 },
  ];

  for (const a of actualSpec) {
    // Idempotent: delete prior summary row if any, re-insert
    await sb
      .from('actual_hours')
      .delete()
      .eq('project_id', projectIds['KIS-2026-001']!)
      .eq('discipline_id', disciplineIds[a.code]!)
      .eq('source', 'seed-summary');
    await sb.from('actual_hours').insert({
      tenant_id: tenantId,
      project_id: projectIds['KIS-2026-001']!,
      discipline_id: disciplineIds[a.code]!,
      hours: a.hrs,
      source: 'seed-summary',
    });
  }
  console.log(`  actual_hours: ${actualSpec.length} summary rows`);

  // --- 9. Change orders
  const coSpec = [
    { co: 'CO-001', date: '2026-03-10', disc: 'PIPE', type: 'scope_add', desc: 'Additional 2" CS pipe runs for new tie-ins, DWG P-1045 Rev 3', qty: 85, uom: 'LF', hrs: 204, status: 'approved', by: 'Field Engineering' },
    { co: 'CO-002', date: '2026-03-22', disc: 'ELEC', type: 'ifc_update', desc: 'Revised cable tray routing per E-2010 Rev 2 — qty reduced', qty: -42, uom: 'LF', hrs: -59, status: 'approved', by: 'Engineering' },
    { co: 'CO-003', date: '2026-04-01', disc: 'CIVIL', type: 'scope_add', desc: 'New foundation pad for emergency generator, DWG C-3020', qty: 180, uom: 'CY', hrs: 1530, status: 'pending', by: 'Client' },
  ];

  for (const co of coSpec) {
    await sb
      .from('change_orders')
      .upsert(
        {
          tenant_id: tenantId,
          project_id: projectIds['KIS-2026-001']!,
          co_number: co.co,
          date: co.date,
          discipline_id: disciplineIds[co.disc]!,
          type: co.type,
          description: co.desc,
          qty_change: co.qty,
          uom: co.uom,
          hrs_impact: co.hrs,
          status: co.status,
          requested_by: co.by,
        },
        { onConflict: 'project_id,co_number' },
      );
  }
  console.log(`  change_orders: ${coSpec.length}`);

  // --- 10. Progress periods — one closed, one open
  await sb.from('progress_periods').upsert(
    [
      {
        tenant_id: tenantId,
        project_id: projectIds['KIS-2026-001']!,
        period_number: 1,
        start_date: '2026-01-15',
        end_date: '2026-02-28',
        locked_at: '2026-03-01T00:00:00Z',
        bcws_hrs: 8000,
        bcwp_hrs: 7500,
        acwp_hrs: 7100,
      },
      {
        tenant_id: tenantId,
        project_id: projectIds['KIS-2026-001']!,
        period_number: 2,
        start_date: '2026-03-01',
        end_date: '2026-03-31',
        bcws_hrs: null,
        bcwp_hrs: null,
        acwp_hrs: null,
      },
    ],
    { onConflict: 'project_id,period_number' },
  );
  console.log('  progress_periods: 2 (one locked, one open)');

  if (mode === 'stress') {
    console.log('→ Stress mode — synthesizing extra audit records…');
    // Implementation left as a TODO — Phase 0 ships minimal + demo.
    console.log('  (stress generation deferred to Phase 1)');
  }

  console.log('→ Seed complete.');
}

main().catch((e) => {
  console.error('SEED FAILED:', e);
  process.exit(1);
});
