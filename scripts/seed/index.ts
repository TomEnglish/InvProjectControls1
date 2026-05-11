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
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^['"](.*)['"]$/, '$1');
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

  // --- 2. Users: super_admin (always) + legacy UAT admin (if its auth row
  //       exists). super_admin bootstrap creates the auth.users row when
  //       missing — required after `supabase db reset --linked` truncates
  //       auth.users. We do NOT pass `app: 'projectcontrols'` in metadata so
  //       handle_new_user() does not fire; the explicit app_users upsert
  //       below is the sole bridge into projectcontrols.

  type UserRole = 'super_admin' | 'admin' | 'pm' | 'pc_reviewer' | 'editor' | 'viewer';

  async function ensureAuthUser(
    email: string,
    password: string,
    displayName: string,
  ): Promise<string> {
    const { data: list, error: listErr } = await sb.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listErr) throw listErr;
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) throw error;
    if (!data.user) throw new Error(`failed to create auth.users entry for ${email}`);
    console.log(`  created auth.users: ${email}`);
    return data.user.id;
  }

  async function ensureAppUser(
    userId: string,
    email: string,
    role: UserRole,
    displayName: string,
  ) {
    const { error } = await sb.from('app_users').upsert(
      {
        id: userId,
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
  }

  // Super admin — first user in the hierarchy. Drives the bootstrap flow
  // since admin/admin_set_user_role can't mint a super_admin from scratch.
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL ?? process.env.SMOKE_EMAIL;
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD ?? process.env.SMOKE_PASSWORD;
  if (!superAdminEmail || !superAdminPassword) {
    throw new Error(
      'SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD (or SMOKE_EMAIL + SMOKE_PASSWORD) must be set in .env',
    );
  }
  const superAdminId = await ensureAuthUser(superAdminEmail, superAdminPassword, 'Super Admin');
  await ensureAppUser(superAdminId, superAdminEmail, 'super_admin', 'Super Admin');

  // Legacy UAT admin from ProgressTracker's .env.local. Bound only if its
  // auth.users row already exists — the seed does not mint it because its
  // password isn't authoritative here.
  let uatAdminId: string | null = null;
  {
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === 'uat-bot@invenio.com');
    if (existing) {
      await ensureAppUser(existing.id, 'uat-bot@invenio.com', 'admin', 'UAT Admin');
      uatAdminId = existing.id;
    } else {
      console.log('  (skipping uat-bot@invenio.com — not in auth.users)');
    }
  }

  if (mode === 'minimal') {
    console.log('→ Minimal mode complete');
    return;
  }

  // --- 3. COA codes
  // Industry-standard CSI-style codes from Sandra Lee's Craft Unit Rates.xlsx.
  // Mirrors migration 20260508000001_seed_industry_coa_codes.sql so a fresh
  // dev seed and an existing UAT tenant end up with identical libraries.
  const coa = [
    { prime: '01', code: '01',    description: 'Sitework',                                            parent: null, level: 1, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.00 },
    { prime: '01', code: '01000', description: 'Temporary Facilities',                                parent: '01', level: 2, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '01', code: '01410', description: 'Mass Excavation',                                     parent: '01', level: 2, uom: 'CY',   base_rate: 0.0924,   pf_adj: 1.19 },
    { prime: '01', code: '01420', description: 'Mass Backfill',                                       parent: '01', level: 2, uom: 'CY',   base_rate: 0.0840,   pf_adj: 1.19 },
    { prime: '01', code: '01440', description: 'Flowable Backfill',                                   parent: '01', level: 2, uom: 'CY',   base_rate: 1.2605,   pf_adj: 1.19 },
    { prime: '01', code: '01450', description: 'Excavation and Backfill for UG Piping',               parent: '01', level: 2, uom: 'CY',   base_rate: 0.3109,   pf_adj: 1.19 },
    { prime: '01', code: '01510', description: 'Ditches',                                             parent: '01', level: 2, uom: 'CY',   base_rate: 0.0504,   pf_adj: 1.19 },
    { prime: '01', code: '01530', description: 'Crushed Rock',                                        parent: '01', level: 2, uom: 'CY',   base_rate: 0.0672,   pf_adj: 1.19 },
    { prime: '01', code: '01940', description: 'Specialty Pipe (24" and under)',                     parent: '01', level: 2, uom: 'LF',   base_rate: 0.4202,   pf_adj: 1.19 },
    { prime: '01', code: '01950', description: 'U/G Precast Basins (SMALL)',                          parent: '01', level: 2, uom: 'EA',   base_rate: 41.1765,  pf_adj: 1.19 },

    { prime: '04', code: '04',    description: 'Civil / Concrete',                                    parent: null, level: 1, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.00 },
    { prime: '04', code: '04110', description: 'FDN 0-10 CY',                                         parent: '04', level: 2, uom: 'CY',   base_rate: 17.8151,  pf_adj: 1.19 },
    { prime: '04', code: '04120', description: 'FDN 10-20 CY',                                        parent: '04', level: 2, uom: 'CY',   base_rate: 7.3950,   pf_adj: 1.19 },
    { prime: '04', code: '04130', description: 'FDN 30-200 CY',                                       parent: '04', level: 2, uom: 'CY',   base_rate: 5.7143,   pf_adj: 1.19 },
    { prime: '04', code: '04150', description: 'FDN Greater than 200 CY',                             parent: '04', level: 2, uom: 'CY',   base_rate: 5.1261,   pf_adj: 1.19 },
    { prime: '04', code: '04210', description: 'Concrete Area Paving',                                parent: '04', level: 2, uom: 'CY',   base_rate: 5.5966,   pf_adj: 1.19 },
    { prime: '04', code: '04220', description: 'Concrete Roads',                                      parent: '04', level: 2, uom: 'CY',   base_rate: 4.5378,   pf_adj: 1.19 },
    { prime: '04', code: '04500', description: 'Cast in Walled Structures',                           parent: '04', level: 2, uom: 'CY',   base_rate: 18.9076,  pf_adj: 1.19 },
    { prime: '04', code: '04620', description: 'Epoxy',                                               parent: '04', level: 2, uom: 'CF',   base_rate: 6.4706,   pf_adj: 1.19 },
    { prime: '04', code: '04630', description: 'Non-Shrink Grout',                                    parent: '04', level: 2, uom: 'CF',   base_rate: 4.7899,   pf_adj: 1.19 },
    { prime: '04', code: '04700', description: 'Seal Slabs',                                          parent: '04', level: 2, uom: 'CY',   base_rate: 1.2605,   pf_adj: 1.19 },

    { prime: '05', code: '05',    description: 'Iron / Structural Steel',                             parent: null, level: 1, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.00 },
    { prime: '05', code: '05210', description: 'Erection (Major Structural Framing)',                 parent: '05', level: 2, uom: 'TONS', base_rate: 15.1429,  pf_adj: 1.19 },
    { prime: '05', code: '05220', description: 'Erect Piperacks Conduit and/or Cable Tray',           parent: '05', level: 2, uom: 'TONS', base_rate: 15.9227,  pf_adj: 1.19 },
    { prime: '05', code: '05230', description: 'Erection (Miscellaneous Steel — Stair/Grate/Ladder)', parent: '05', level: 2, uom: 'TONS', base_rate: 26.4462,  pf_adj: 1.19 },
    { prime: '05', code: '05240', description: 'Erection (Structural Specialties)',                   parent: '05', level: 2, uom: 'TONS', base_rate: 0.0,      pf_adj: 1.19 },

    { prime: '07', code: '07',    description: 'Mechanical',                                          parent: null, level: 1, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.00 },
    { prime: '07', code: '07110', description: 'Heat Transfer Equipment',                             parent: '07', level: 2, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '07', code: '07120', description: 'Pressure Vessels and Tanks',                          parent: '07', level: 2, uom: 'EA',   base_rate: 10.0,     pf_adj: 1.19 },
    { prime: '07', code: '07130', description: 'Compressors, Expanders',                              parent: '07', level: 2, uom: 'EA',   base_rate: 80.6723,  pf_adj: 1.19 },
    { prime: '07', code: '07140', description: 'Pumps and Drive',                                     parent: '07', level: 2, uom: 'EA',   base_rate: 123.5294, pf_adj: 1.19 },
    { prime: '07', code: '07150', description: 'Misc. Rotating Equipment',                            parent: '07', level: 2, uom: 'EA',   base_rate: 30.0,     pf_adj: 1.19 },
    { prime: '07', code: '07160', description: 'Filters',                                             parent: '07', level: 2, uom: 'EA',   base_rate: 40.3361,  pf_adj: 1.19 },
    { prime: '07', code: '07185', description: 'Cooling Towers',                                      parent: '07', level: 2, uom: 'EA',   base_rate: 120.0,    pf_adj: 1.19 },
    { prime: '07', code: '07410', description: 'Turbine / Generator',                                 parent: '07', level: 2, uom: 'EA',   base_rate: 40.0,     pf_adj: 1.19 },

    { prime: '08', code: '08',    description: 'Pipe',                                                parent: null, level: 1, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.00 },
    { prime: '08', code: '08111', description: 'Carbon Steel Pipe 2.5" and under (Shop)',             parent: '08', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '08', code: '08112', description: 'Carbon Steel Pipe 3" to 10" (Shop)',                  parent: '08', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '08', code: '08113', description: 'Carbon Steel Pipe 12" and over (Shop)',               parent: '08', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '08', code: '08121', description: 'Alloy Pipe 2.5" and under (Shop)',                    parent: '08', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '08', code: '08122', description: 'Alloy Pipe 3" to 10" (Shop)',                         parent: '08', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '08', code: '08123', description: 'Alloy Pipe 12" and over (Shop)',                      parent: '08', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '08', code: '08211', description: 'Carbon Steel Field Run Pipe 2.5" and under',          parent: '08', level: 2, uom: 'LF',   base_rate: 2.4118,   pf_adj: 1.19 },
    { prime: '08', code: '08212', description: 'Carbon Steel Field Run Pipe 3" to 10"',               parent: '08', level: 2, uom: 'LF',   base_rate: 2.1092,   pf_adj: 1.19 },
    { prime: '08', code: '08213', description: 'Carbon Steel Field Run Pipe 12" and over',            parent: '08', level: 2, uom: 'LF',   base_rate: 3.3992,   pf_adj: 1.19 },
    { prime: '08', code: '08221', description: 'Stainless Steel Alloy Field Run Pipe 2.5" and under', parent: '08', level: 2, uom: 'LF',   base_rate: 2.8655,   pf_adj: 1.19 },
    { prime: '08', code: '08222', description: 'Stainless Steel Alloy Field Run Pipe 3" to 10"',      parent: '08', level: 2, uom: 'LF',   base_rate: 2.6218,   pf_adj: 1.19 },
    { prime: '08', code: '08223', description: 'Stainless Steel Alloy Field Run Pipe 12" and over',   parent: '08', level: 2, uom: 'LF',   base_rate: 10.1513,  pf_adj: 1.19 },
    { prime: '08', code: '08311', description: 'Underground CS Pipe 2.5" and Under',                  parent: '08', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '08', code: '08312', description: 'Underground CS Pipe 3" to 10"',                       parent: '08', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '08', code: '08313', description: 'Underground CS Pipe 12" and Over',                    parent: '08', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '08', code: '08331', description: 'UG Specialty Material Pipe 2.5" and under',           parent: '08', level: 2, uom: 'LF',   base_rate: 3.6134,   pf_adj: 1.19 },
    { prime: '08', code: '08332', description: 'U/G Specialty Material Pipe 3"-10"',                  parent: '08', level: 2, uom: 'LF',   base_rate: 8.4034,   pf_adj: 1.19 },
    { prime: '08', code: '08333', description: 'UG Specialty Material Pipe 12" and over (HDPE)',      parent: '08', level: 2, uom: 'LF',   base_rate: 2.8714,   pf_adj: 1.19 },

    { prime: '09', code: '09',    description: 'Electrical',                                          parent: null, level: 1, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.00 },
    { prime: '09', code: '09100', description: 'Grounding',                                           parent: '09', level: 2, uom: 'LF',   base_rate: 0.2269,   pf_adj: 1.19 },
    { prime: '09', code: '09210', description: 'Underground Ductbank',                                parent: '09', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '09', code: '09220', description: 'Underground Conduit',                                 parent: '09', level: 2, uom: 'LF',   base_rate: 0.5294,   pf_adj: 1.19 },
    { prime: '09', code: '09310', description: 'Aboveground Conduit',                                 parent: '09', level: 2, uom: 'LF',   base_rate: 1.2437,   pf_adj: 1.19 },
    { prime: '09', code: '09320', description: 'Cable Tray Systems',                                  parent: '09', level: 2, uom: 'LF',   base_rate: 0.5126,   pf_adj: 1.19 },
    { prime: '09', code: '09340', description: 'Junction Boxes, Pull Boxes, Terminal Boxes',          parent: '09', level: 2, uom: 'EA',   base_rate: 36.9672,  pf_adj: 1.19 },
    { prime: '09', code: '09420', description: 'Wire and Cable Installation (3/C #2 reference rate)', parent: '09', level: 2, uom: 'LF',   base_rate: 0.0462,   pf_adj: 1.19 },
    { prime: '09', code: '09450', description: 'Fiber Optic Cable',                                   parent: '09', level: 2, uom: 'LF',   base_rate: 0.0235,   pf_adj: 1.19 },
    { prime: '09', code: '09520', description: 'Oil Filled Transformers',                             parent: '09', level: 2, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '09', code: '09530', description: 'Breaker Panels',                                      parent: '09', level: 2, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '09', code: '09550', description: 'Motor Control Centers',                               parent: '09', level: 2, uom: 'EA',   base_rate: 80.0,     pf_adj: 1.19 },
    { prime: '09', code: '09610', description: 'Lighting Fixtures',                                   parent: '09', level: 2, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '09', code: '09620', description: 'Power and Control Devices',                           parent: '09', level: 2, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '09', code: '09750', description: 'Poles, Towers',                                       parent: '09', level: 2, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.19 },

    { prime: '10', code: '10',    description: 'Instrumentation',                                     parent: null, level: 1, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.00 },
    { prime: '10', code: '10110', description: 'Field Mounted Instrument Devices',                    parent: '10', level: 2, uom: 'EA',   base_rate: 12.1597,  pf_adj: 1.19 },
    { prime: '10', code: '10210', description: 'Control Valves and Power Operators',                  parent: '10', level: 2, uom: 'EA',   base_rate: 13.9496,  pf_adj: 1.19 },
    { prime: '10', code: '10220', description: 'Level Gauges & Sight Glasses',                        parent: '10', level: 2, uom: 'EA',   base_rate: 12.7731,  pf_adj: 1.19 },
    { prime: '10', code: '10410', description: 'Analytical Systems',                                  parent: '10', level: 2, uom: 'EA',   base_rate: 64.1765,  pf_adj: 1.19 },
    { prime: '10', code: '10420', description: 'Gas Detection Systems',                               parent: '10', level: 2, uom: 'EA',   base_rate: 8.7899,   pf_adj: 1.19 },
    { prime: '10', code: '10520', description: 'Pneumatic Tubing',                                    parent: '10', level: 2, uom: 'LF',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '10', code: '10550', description: 'Inst. Threaded Air Supply Lateral',                   parent: '10', level: 2, uom: 'LF',   base_rate: 0.9748,   pf_adj: 1.19 },
    { prime: '10', code: '10600', description: 'Control Panels and Panel Mounted Inst.',              parent: '10', level: 2, uom: 'EA',   base_rate: 0.0,      pf_adj: 1.19 },
    { prime: '10', code: '10820', description: 'Check-Out and Testing',                               parent: '10', level: 2, uom: 'EA',   base_rate: 2.8143,   pf_adj: 1.19 },
    { prime: '10', code: '10830', description: 'Final Calibration and Loop Check',                    parent: '10', level: 2, uom: 'EA',   base_rate: 2.7059,   pf_adj: 1.19 },
  ].map((c) => ({ ...c, tenant_id: tenantId }));

  const { error: coaErr } = await sb.from('coa_codes').upsert(coa, { onConflict: 'tenant_id,code' });
  if (coaErr) throw coaErr;
  console.log(`  coa_codes: ${coa.length}`);

  // --- 4. Work types (the unified work_types library replaces the old
  // per-discipline ROC templates as of 20260511000001). The migration
  // seeds these per-tenant on apply; no further work needed here. We
  // still look up each discipline's default work type below so the
  // project_disciplines rows can link to them.
  const { data: defaultWorkTypes, error: wtErr } = await sb
    .from('work_types')
    .select('id, discipline_code, work_type_code')
    .eq('tenant_id', tenantId)
    .eq('is_default', true);
  if (wtErr) throw wtErr;
  const defaultWorkTypeByDiscipline: Record<string, string> = {};
  for (const wt of defaultWorkTypes ?? []) {
    defaultWorkTypeByDiscipline[wt.discipline_code] = wt.id;
  }
  console.log(`  work_types: defaults found for ${Object.keys(defaultWorkTypeByDiscipline).length} disciplines`);

  // --- 5. Projects
  const projectSpecs = [
    {
      project_code: 'KIS-2026-001',
      name: 'Turnaround Alpha',
      client: 'ExxonMobil Baytown',
      status: 'draft',
      start_date: '2026-01-15',
      end_date: '2026-12-31',
      qty_rollup_mode: 'custom',
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

  // --- 5b. Project membership — gives the legacy UAT admin scoped access to
  //         KIS-2026-001 so the project-admin gate can be exercised in
  //         tests. super_admin bypasses project_members and isn't seeded
  //         here.
  if (uatAdminId) {
    const { error: pmErr } = await sb.from('project_members').upsert(
      {
        tenant_id: tenantId,
        project_id: projectIds['KIS-2026-001']!,
        user_id: uatAdminId,
        project_role: 'admin',
        added_by: superAdminId,
      },
      { onConflict: 'project_id,user_id' },
    );
    if (pmErr) throw pmErr;
    console.log('  project_members: 1 (uat-bot admin on KIS-2026-001)');
  }

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
          default_work_type_id: defaultWorkTypeByDiscipline[d.code] ?? null,
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

  // --- 6b. Project discipline weights (custom rollup mode)
  const weightRows = [
    { code: 'CIVIL', weight: 0.15 },
    { code: 'PIPE', weight: 0.35 },
    { code: 'STEEL', weight: 0.10 },
    { code: 'ELEC', weight: 0.20 },
    { code: 'MECH', weight: 0.10 },
    { code: 'INST', weight: 0.08 },
    { code: 'SITE', weight: 0.02 },
  ].map((w) => ({
    tenant_id: tenantId,
    project_id: projectIds['KIS-2026-001']!,
    discipline_id: disciplineIds[w.code]!,
    weight: w.weight,
  }));
  const { error: wErr } = await sb
    .from('project_discipline_weights')
    .upsert(weightRows, { onConflict: 'project_id,discipline_id' });
  if (wErr) throw wErr;
  console.log(`  project_discipline_weights: ${weightRows.length}`);

  // --- 7. Sample progress records seeded later in the canonical block (step 13).
  // The legacy audit_records seed was retired by Phase 5
  // (20260504000002_retire_audit_records.sql).

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
        bcws_hrs: 4500,
        bcwp_hrs: null,
        acwp_hrs: null,
      },
    ],
    { onConflict: 'project_id,period_number' },
  );
  console.log('  progress_periods: 2 (one locked, one open)');

  // --- 11. IWPs (canonical work-package grouping)
  const iwpSpec: { name: string; discipline: keyof typeof disciplineIds }[] = [
    { name: 'IWP-CIVIL-001', discipline: 'CIVIL' },
    { name: 'IWP-PIPE-001', discipline: 'PIPE' },
    { name: 'IWP-PIPE-002', discipline: 'PIPE' },
    { name: 'IWP-STEEL-001', discipline: 'STEEL' },
    { name: 'IWP-ELEC-001', discipline: 'ELEC' },
    { name: 'IWP-MECH-001', discipline: 'MECH' },
  ];
  const iwpIds: Record<string, string> = {};
  for (const i of iwpSpec) {
    const { data, error } = await sb
      .from('iwps')
      .upsert(
        {
          tenant_id: tenantId,
          project_id: projectIds['KIS-2026-001']!,
          discipline_id: disciplineIds[i.discipline]!,
          name: i.name,
        },
        { onConflict: 'project_id,name' },
      )
      .select('id')
      .single();
    if (error) throw error;
    iwpIds[i.name] = data.id;
  }
  console.log(`  iwps: ${iwpSpec.length}`);

  // --- 12. Foreman aliases — link two of the three names; leave Carlos Diaz
  // unmatched so the Foreman Aliases card on Project Setup has a row to
  // demonstrate the linking flow.
  const foremanLinkSpec: { name: string; userId: string }[] = [];
  foremanLinkSpec.push({ name: 'Alice Chen', userId: superAdminId });
  if (uatAdminId) foremanLinkSpec.push({ name: 'Bob Carter', userId: uatAdminId });
  for (const f of foremanLinkSpec) {
    await sb
      .from('foreman_aliases')
      .upsert(
        { tenant_id: tenantId, name: f.name, user_id: f.userId, created_by: superAdminId },
        { onConflict: 'tenant_id,name' },
      );
  }
  console.log(`  foreman_aliases: ${foremanLinkSpec.length} linked (Carlos Diaz left unmatched)`);

  // --- 13. Progress records (canonical) — 28 records spanning all 7
  // disciplines, mixed completion levels, three foremen, four line areas.
  type RecSpec = {
    rec: number;
    dwg: string;
    desc: string;
    disc: 'CIVIL' | 'PIPE' | 'STEEL' | 'ELEC' | 'MECH' | 'INST' | 'SITE';
    iwp?: string;
    uom: 'LF' | 'CY' | 'EA' | 'TONS' | 'SF' | 'HR' | 'LS';
    bq: number;
    bh: number;
    ah: number;
    pct: number;
    foreman: string;
    area: string;
    code?: string;
    type?: string;
    size?: string;
    spec?: string;
  };
  // Each row carries a COA code so the QMR report has data the moment the
  // demo tenant is seeded. Codes are picked to match Sandra's industry-
  // standard library (migration 20260508000001) — see the spec below for
  // why each row got its specific code.
  const progressSpec: RecSpec[] = [
    // CIVIL — foundations + backfill against the 04xxx + 01420 codes
    { rec: 1, dwg: 'C-1001', desc: 'Foundation pad A-101', disc: 'CIVIL', iwp: 'IWP-CIVIL-001', uom: 'CY', bq: 45, bh: 380, ah: 360, pct: 95, foreman: 'Alice Chen', area: 'Unit 1', code: '04130', type: 'Pad' },
    { rec: 2, dwg: 'C-1002', desc: 'Pile cap B-201', disc: 'CIVIL', iwp: 'IWP-CIVIL-001', uom: 'CY', bq: 28, bh: 240, ah: 195, pct: 75, foreman: 'Alice Chen', area: 'Unit 1', code: '04130' },
    { rec: 3, dwg: 'C-1003', desc: 'Backfill area Y', disc: 'CIVIL', uom: 'CY', bq: 120, bh: 504, ah: 220, pct: 40, foreman: 'Bob Carter', area: 'Tank Farm', code: '01420' },
    { rec: 4, dwg: 'C-1004', desc: 'Equipment pad C-301', disc: 'CIVIL', iwp: 'IWP-CIVIL-001', uom: 'CY', bq: 62, bh: 525, ah: 510, pct: 100, foreman: 'Alice Chen', area: 'Equipment Yard', code: '04130' },
    // PIPE — field-run carbon and alloy
    { rec: 5, dwg: 'P-2001', desc: '2" CS Line 2001-A', disc: 'PIPE', iwp: 'IWP-PIPE-001', uom: 'LF', bq: 320, bh: 770, ah: 600, pct: 80, foreman: 'Alice Chen', area: 'Unit 1', code: '08211', type: 'Pipe', size: '2"', spec: 'CS150' },
    { rec: 6, dwg: 'P-2002', desc: '6" CS Line 2002-B', disc: 'PIPE', iwp: 'IWP-PIPE-001', uom: 'LF', bq: 180, bh: 432, ah: 280, pct: 60, foreman: 'Bob Carter', area: 'Unit 2', code: '08212', type: 'Pipe', size: '6"', spec: 'CS150' },
    { rec: 7, dwg: 'P-2003', desc: '8" CS Line 2003-C', disc: 'PIPE', iwp: 'IWP-PIPE-002', uom: 'LF', bq: 95, bh: 342, ah: 100, pct: 25, foreman: 'Carlos Diaz', area: 'Pipe Rack', code: '08212', type: 'Pipe', size: '8"', spec: 'CS150' },
    { rec: 8, dwg: 'P-2004', desc: 'Alloy Line 4-X', disc: 'PIPE', iwp: 'IWP-PIPE-002', uom: 'LF', bq: 60, bh: 312, ah: 305, pct: 100, foreman: 'Bob Carter', area: 'Pipe Rack', code: '08222', type: 'Pipe', size: '4"', spec: 'A312' },
    { rec: 9, dwg: 'P-2005', desc: '4" CS Tie-in', disc: 'PIPE', iwp: 'IWP-PIPE-002', uom: 'LF', bq: 50, bh: 120, ah: 0, pct: 0, foreman: 'Carlos Diaz', area: 'Unit 1', code: '08212', type: 'Pipe', size: '4"', spec: 'CS150' },
    { rec: 10, dwg: 'P-2006', desc: '2" CS Drain', disc: 'PIPE', iwp: 'IWP-PIPE-001', uom: 'LF', bq: 40, bh: 96, ah: 50, pct: 50, foreman: 'Alice Chen', area: 'Unit 2', code: '08211', type: 'Pipe', size: '2"', spec: 'CS150' },
    // STEEL — major framing for beams, misc-steel for handrails / platforms
    { rec: 11, dwg: 'S-3001', desc: 'Platform L3 Steel', disc: 'STEEL', iwp: 'IWP-STEEL-001', uom: 'TONS', bq: 12.5, bh: 350, ah: 250, pct: 70, foreman: 'Alice Chen', area: 'Pipe Rack', code: '05230' },
    { rec: 12, dwg: 'S-3002', desc: 'Beam W14x30', disc: 'STEEL', iwp: 'IWP-STEEL-001', uom: 'TONS', bq: 8, bh: 224, ah: 220, pct: 100, foreman: 'Bob Carter', area: 'Tank Farm', code: '05210' },
    { rec: 13, dwg: 'S-3003', desc: 'Handrails Unit 1', disc: 'STEEL', uom: 'LF', bq: 250, bh: 175, ah: 60, pct: 30, foreman: 'Carlos Diaz', area: 'Unit 1', code: '05230' },
    // ELEC — tray, conduit, cable, lighting
    { rec: 14, dwg: 'E-4001', desc: 'Cable Tray Run CT-101', disc: 'ELEC', iwp: 'IWP-ELEC-001', uom: 'LF', bq: 450, bh: 630, ah: 410, pct: 60, foreman: 'Bob Carter', area: 'Unit 1', code: '09320' },
    { rec: 15, dwg: 'E-4002', desc: 'Conduit run 4002', disc: 'ELEC', iwp: 'IWP-ELEC-001', uom: 'LF', bq: 200, bh: 170, ah: 165, pct: 90, foreman: 'Alice Chen', area: 'Unit 2', code: '09310' },
    { rec: 16, dwg: 'E-4003', desc: 'Cable Pull MCC-1', disc: 'ELEC', uom: 'LF', bq: 800, bh: 1120, ah: 420, pct: 35, foreman: 'Carlos Diaz', area: 'Equipment Yard', code: '09420' },
    { rec: 17, dwg: 'E-4004', desc: 'Lighting circuit', disc: 'ELEC', uom: 'EA', bq: 24, bh: 96, ah: 0, pct: 0, foreman: 'Bob Carter', area: 'Unit 1', code: '09610' },
    // MECH — pumps, vessels, compressors
    { rec: 18, dwg: 'M-5001', desc: 'Pump P-101', disc: 'MECH', iwp: 'IWP-MECH-001', uom: 'EA', bq: 1, bh: 50, ah: 42, pct: 80, foreman: 'Alice Chen', area: 'Unit 1', code: '07140', type: 'Pump', spec: 'API610' },
    { rec: 19, dwg: 'M-5002', desc: 'Heat Exchanger E-101', disc: 'MECH', iwp: 'IWP-MECH-001', uom: 'EA', bq: 1, bh: 65, ah: 18, pct: 25, foreman: 'Bob Carter', area: 'Tank Farm', code: '07110', type: 'Heat Exchanger' },
    { rec: 20, dwg: 'M-5003', desc: 'Compressor C-201', disc: 'MECH', uom: 'EA', bq: 1, bh: 140, ah: 0, pct: 0, foreman: 'Carlos Diaz', area: 'Equipment Yard', code: '07130', type: 'Compressor', spec: 'API618' },
    // INST — field instruments
    { rec: 21, dwg: 'I-6001', desc: 'FT-101 Flow Trans.', disc: 'INST', uom: 'EA', bq: 1, bh: 7.5, ah: 7.0, pct: 100, foreman: 'Alice Chen', area: 'Unit 1', code: '10110', type: 'Transmitter' },
    { rec: 22, dwg: 'I-6002', desc: 'PT-102 Pressure Trans.', disc: 'INST', uom: 'EA', bq: 1, bh: 6.5, ah: 6.2, pct: 100, foreman: 'Bob Carter', area: 'Unit 1', code: '10110', type: 'Transmitter' },
    { rec: 23, dwg: 'I-6003', desc: 'LT-103 Level Trans.', disc: 'INST', uom: 'EA', bq: 1, bh: 8, ah: 4.0, pct: 50, foreman: 'Carlos Diaz', area: 'Tank Farm', code: '10220', type: 'Transmitter' },
    { rec: 24, dwg: 'I-6004', desc: 'TT-104 Temp Trans.', disc: 'INST', uom: 'EA', bq: 1, bh: 6, ah: 0, pct: 0, foreman: 'Alice Chen', area: 'Unit 2', code: '10110', type: 'Transmitter' },
    // SITE — temp facilities, paving, drainage. Landscaping has no good
    // industry-standard code so we leave it null and let it surface as an
    // "unrecognised code" in the QMR until the admin assigns one.
    { rec: 25, dwg: 'ST-001', desc: 'Survey Area 1', disc: 'SITE', uom: 'LS', bq: 1, bh: 80, ah: 78, pct: 100, foreman: 'Bob Carter', area: 'Unit 1', code: '01000' },
    { rec: 26, dwg: 'ST-002', desc: 'Pavement Section A', disc: 'SITE', uom: 'SF', bq: 5000, bh: 425, ah: 280, pct: 65, foreman: 'Alice Chen', area: 'Equipment Yard', code: '04210' },
    { rec: 27, dwg: 'ST-003', desc: 'Drainage culvert', disc: 'SITE', uom: 'LF', bq: 120, bh: 120, ah: 30, pct: 20, foreman: 'Carlos Diaz', area: 'Tank Farm', code: '01510' },
    { rec: 28, dwg: 'ST-004', desc: 'Final landscaping', disc: 'SITE', uom: 'LS', bq: 1, bh: 200, ah: 0, pct: 0, foreman: 'Bob Carter', area: 'Unit 1' },
  ];

  // Wipe prior seed-generated rows so re-running is idempotent. Order
  // matters: snapshots cascade to snapshot_items first; then records cascade
  // to milestones (snapshot_items would otherwise restrict the record drop).
  await sb
    .from('progress_snapshots')
    .delete()
    .eq('project_id', projectIds['KIS-2026-001']!)
    .eq('source_filename', 'seed.ts');
  await sb
    .from('progress_records')
    .delete()
    .eq('project_id', projectIds['KIS-2026-001']!)
    .eq('source_type', 'seed');

  // Foreman name → user_id lookup for auto-link during insert.
  const foremanByName = new Map<string, string>();
  for (const f of foremanLinkSpec) foremanByName.set(f.name.toLowerCase(), f.userId);

  // ROC weights + labels per discipline (pulled from rocSpec defined earlier).
  const rocByDiscipline = new Map<string, { weights: number[]; labels: string[] }>();
  for (const r of rocSpec) rocByDiscipline.set(r.discipline_code, { weights: r.weights, labels: r.milestones });

  // Distribute a percent_complete across 8 milestones in declared order:
  // earlier milestones complete first, the next milestone is partial,
  // remaining are 0. Σ(value × weight) = percent_complete (fraction).
  function distributeProgress(percentComplete: number, weights: number[]): number[] {
    const target = Math.max(0, Math.min(100, percentComplete)) / 100;
    const out: number[] = [];
    let cumulative = 0;
    for (const w of weights) {
      if (w <= 0) {
        out.push(0);
        continue;
      }
      const remaining = Math.max(0, target - cumulative);
      const earnedFraction = Math.min(1, remaining / w);
      out.push(Math.round(earnedFraction * 100));
      cumulative += w * earnedFraction;
    }
    return out;
  }

  const recordRows = progressSpec.map((s) => ({
    tenant_id: tenantId,
    project_id: projectIds['KIS-2026-001']!,
    discipline_id: disciplineIds[s.disc]!,
    iwp_id: s.iwp ? iwpIds[s.iwp]! : null,
    record_no: s.rec,
    source_type: 'seed',
    source_filename: 'seed.ts',
    dwg: s.dwg,
    rev: '1',
    code: s.code ?? null,
    description: s.desc,
    uom: s.uom,
    budget_qty: s.bq,
    actual_qty: null,
    budget_hrs: s.bh,
    actual_hrs: s.ah,
    percent_complete: s.pct,
    status: s.pct >= 100 ? 'complete' : 'active',
    foreman_name: s.foreman,
    foreman_user_id: foremanByName.get(s.foreman.toLowerCase()) ?? null,
    attr_type: s.type ?? null,
    attr_size: s.size ?? null,
    attr_spec: s.spec ?? null,
    line_area: s.area,
  }));

  const { data: insertedRecords, error: recErr } = await sb
    .from('progress_records')
    .insert(recordRows)
    .select('id');
  if (recErr) throw recErr;
  console.log(`  progress_records: ${recordRows.length}`);

  // Milestone rows — 8 per record, distributed by ROC template weights.
  const fallbackWeights = [0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125];
  const milestoneRows: Record<string, unknown>[] = [];
  progressSpec.forEach((s, i) => {
    const recId = insertedRecords![i]!.id;
    const roc = rocByDiscipline.get(s.disc) ?? { weights: fallbackWeights, labels: [] };
    const values = distributeProgress(s.pct, roc.weights);
    for (let seq = 1; seq <= 8; seq++) {
      milestoneRows.push({
        tenant_id: tenantId,
        progress_record_id: recId,
        seq,
        label: roc.labels[seq - 1] ?? null,
        value: values[seq - 1] ?? 0,
      });
    }
  });
  const { error: msErr } = await sb
    .from('progress_record_milestones')
    .upsert(milestoneRows, { onConflict: 'progress_record_id,seq' });
  if (msErr) throw msErr;
  console.log(`  progress_record_milestones: ${milestoneRows.length}`);

  // --- 14. Progress snapshots — first-audit baseline + 3 weekly captures
  // with diminishing percent offsets so the comparison view has meaningful
  // drift to render.
  type SnapshotSpec = {
    kind: 'weekly' | 'baseline_first_audit';
    weekEnding: string | null;
    label: string;
    pctOffset: number;
  };
  const snapshotSpec: SnapshotSpec[] = [
    { kind: 'baseline_first_audit', weekEnding: '2026-01-15', label: 'First-audit baseline', pctOffset: 100 },
    { kind: 'weekly', weekEnding: '2026-04-12', label: 'Week ending 12 Apr', pctOffset: 30 },
    { kind: 'weekly', weekEnding: '2026-04-19', label: 'Week ending 19 Apr', pctOffset: 15 },
    { kind: 'weekly', weekEnding: '2026-04-26', label: 'Week ending 26 Apr', pctOffset: 5 },
  ];

  for (const sn of snapshotSpec) {
    const itemPcts = progressSpec.map((s) => Math.max(0, s.pct - sn.pctOffset));
    const totalBudgetHrs = progressSpec.reduce((acc, s) => acc + s.bh, 0);
    const totalEarnedHrs = progressSpec.reduce(
      (acc, s, i) => acc + s.bh * (itemPcts[i]! / 100),
      0,
    );
    const actualScale = Math.max(0, 1 - sn.pctOffset / 100);
    const totalActualHrs = progressSpec.reduce((acc, s) => acc + s.ah * actualScale, 0);

    const { data: snap, error: snErr } = await sb
      .from('progress_snapshots')
      .insert({
        tenant_id: tenantId,
        project_id: projectIds['KIS-2026-001']!,
        kind: sn.kind,
        week_ending: sn.weekEnding,
        label: sn.label,
        total_budget_hrs: totalBudgetHrs,
        total_earned_hrs: totalEarnedHrs,
        total_actual_hrs: totalActualHrs,
        cpi: totalActualHrs > 0 ? totalEarnedHrs / totalActualHrs : null,
        spi: totalBudgetHrs > 0 ? totalEarnedHrs / totalBudgetHrs : null,
        source_filename: 'seed.ts',
        uploaded_by: superAdminId,
      })
      .select('id')
      .single();
    if (snErr) throw snErr;

    const itemRows = progressSpec.map((s, i) => {
      const pct = itemPcts[i]!;
      const earnedFrac = pct / 100;
      return {
        snapshot_id: snap.id,
        progress_record_id: insertedRecords![i]!.id,
        tenant_id: tenantId,
        project_id: projectIds['KIS-2026-001']!,
        percent_complete: pct,
        earned_hrs: s.bh * earnedFrac,
        earned_qty: s.bq * earnedFrac,
        actual_hrs: s.ah * actualScale,
        actual_qty: null,
      };
    });
    const { error: itemErr } = await sb.from('progress_snapshot_items').insert(itemRows);
    if (itemErr) throw itemErr;
  }
  console.log(
    `  progress_snapshots: ${snapshotSpec.length} (with ${progressSpec.length * snapshotSpec.length} items)`,
  );

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
