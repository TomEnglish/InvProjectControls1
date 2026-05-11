import * as XLSX from 'xlsx';

export interface MilestoneEntry {
  name: string;
  pct: number;
}

export interface ParsedRow {
  dwg?: string;
  rev?: string;
  code?: string;
  /** DESC_ — generic description of the work item (Civil/Mech/Foundations) */
  name?: string;
  /** TAG_NO — equipment tag, Electrical / Mechanical */
  tag_no?: string;
  /** SPOOL_FR — spool front, Pipe / Steel / Instrumentation */
  spool_fr?: string;
  budget_hrs?: number;
  actual_hrs?: number;
  percent_complete?: number;
  unit?: string;
  budget_qty?: number;
  actual_qty?: number;
  // Earned values imported from the source file. Preserved for
  // reconciliation only — live EV math always recomputes from milestones ×
  // budget. See Sandra-audit-template-decisions.docx, decisions 2 + 3.
  earned_qty_imported?: number;
  earn_whrs_imported?: number;
  foreman_name?: string;
  gen_foreman_name?: string;
  iwp_name?: string;
  attr_type?: string;
  attr_size?: string;
  attr_spec?: string;
  // Area / system dimensions. The audit files use four overlapping columns
  // (SYSTEM, CAREA, LINE_AREA, VAR_AREA) — we keep all four distinct per
  // decision #1. Reports can roll up by whichever axis applies.
  line_area?: string;
  system?: string;
  carea?: string;
  var_area?: string;
  // Schedule / package linkage
  sched_id?: string;
  test_pkg?: string;
  cwp?: string;
  spl_cnt?: number;
  source_row?: number;
  // Discipline-specific spec triplet
  paint_spec?: string;
  insu_spec?: string;
  heat_trace_spec?: string;
  /** SERVICE — Mechanical service identifier (e.g. "Glycol Water Recovery") */
  service?: string;
  // Turnaround location (TA / shutdown projects only)
  ta_bank?: string;
  ta_bay?: string;
  ta_level?: string;
  pslip?: string;
  /** WORK_TYPE — code into the work_types library (e.g. 'PIPE-STD', 'CIV-FDN') */
  work_type?: string;
  /** DISCIPLINE — explicit per-row discipline name from the unified workbook */
  discipline_label?: string;
  milestones?: MilestoneEntry[];
}

export interface ParseResult {
  rows: ParsedRow[];
  unmappedHeaders: string[];
  /**
   * Bare M1..M8 columns in the audit files carry the project's ROC milestone
   * weights repeated on every row. We surface the first row's weights so the
   * Upload page can compare against the project's ROC template and warn on
   * mismatch (decision #5). Empty array when no M1..M8 columns were present.
   */
  inferredRocWeights: number[];
  /**
   * Milestone labels picked off the first row's M1_DESC..M8_DESC columns.
   * Paired with `inferredRocWeights` to drive the "Update template from file"
   * one-click action on the Upload page.
   */
  inferredRocLabels: string[];
}

// Aliases cover the union of the seven per-discipline audit templates
// in ProgressDocs/InputExamples/ (civil/electrical/instrumentation/mechanical/
// pipe/site work/steel) plus the original snake_case progress-template.csv.
// Per Sandra's UAT, the upload form needs to accept any of these out of the
// box so users don't have to rename columns before importing.
const HEADER_MAP: Record<string, keyof ParsedRow> = {
  // Drawing number
  dwg: 'dwg', drawing: 'dwg', drawing_no: 'dwg', drawing_number: 'dwg', iso: 'dwg',

  // Drawing revision (audit files use REV_NO)
  rev: 'rev', rev_no: 'rev', revision: 'rev', revision_no: 'rev',

  // COA cost code (audit files use CODE)
  code: 'code', coa_code: 'code', cost_code: 'code',

  // Item identification — per the senior SME's Unified Audit Workbook,
  // DESC_, TAG_NO, and SPOOL_FR are three distinct columns (not aliases
  // for one another). The discipline determines which of the three a row
  // populates; we keep all three as separate fields so round-tripping a
  // record preserves the original column.
  name: 'name', description: 'name', desc: 'name', desc_: 'name',
  item_description: 'name',
  tag_no: 'tag_no', tag: 'tag_no', equipment_tag: 'tag_no',
  spool_fr: 'spool_fr', spool: 'spool_fr', spool_front: 'spool_fr',

  // Budget hours — FLD_WHRS is universal; mechanical's IFC_WHRS is a
  // distinct "issued for construction hours" alias the unified workbook
  // maps onto whrs_unit (not budget). Per the unified Header Crosswalk
  // we don't fold IFC_WHRS into budget_hrs anymore.
  budget_hrs: 'budget_hrs', budget_hours: 'budget_hrs', budget: 'budget_hrs',
  budgeted_hrs: 'budget_hrs', plan_hrs: 'budget_hrs', hours: 'budget_hrs',
  fld_whrs: 'budget_hrs', field_whrs: 'budget_hrs', field_hrs: 'budget_hrs',

  // Actual hours (timesheet hours booked — audit files don't carry this).
  actual_hrs: 'actual_hrs', actual_hours: 'actual_hrs', actual: 'actual_hrs',
  spent_hrs: 'actual_hrs',

  // Percent complete
  percent_complete: 'percent_complete', percent: 'percent_complete', pct: 'percent_complete',
  pct_complete: 'percent_complete', complete: 'percent_complete',
  completion: 'percent_complete', percent_hrs: 'percent_complete',
  percenthrs: 'percent_complete',

  // Unit of measure
  unit: 'unit', uom: 'unit', units: 'unit', unit_of_measure: 'unit',

  // Budget / planned quantity (audit files use FLD_QTY)
  budget_qty: 'budget_qty', budget_quantity: 'budget_qty', qty_budget: 'budget_qty',
  plan_qty: 'budget_qty', planned_qty: 'budget_qty', qty: 'budget_qty', quantity: 'budget_qty',
  fld_qty: 'budget_qty', field_qty: 'budget_qty',

  // Actual / booked quantity — reserved for true installed/booked figures.
  // The audit files' ERN_QTY (earned quantity) goes to earned_qty_imported
  // below, not here (decision #2).
  actual_qty: 'actual_qty', actual_quantity: 'actual_qty', qty_actual: 'actual_qty',

  // Earned values from the source file — preserved separately for reconciliation
  // (decisions #2 + #3). Never used in live EV math.
  ern_qty: 'earned_qty_imported', earn_qty: 'earned_qty_imported',
  earned_qty: 'earned_qty_imported',
  earn_whrs: 'earn_whrs_imported', earn_whr: 'earn_whrs_imported',
  earned_whrs: 'earn_whrs_imported', earned_hrs: 'earn_whrs_imported',

  // Foreman: IWP-level
  foreman: 'foreman_name', foreman_name: 'foreman_name', supervisor: 'foreman_name',
  lead: 'foreman_name', iwp_foreman: 'foreman_name',

  // Foreman: General Foreman (oversees multiple IWP foremen)
  gen_foreman: 'gen_foreman_name', iwp_gen_foreman: 'gen_foreman_name',
  general_foreman: 'gen_foreman_name', gen_foreman_name: 'gen_foreman_name',

  // IWP / work package (audit files use IWP_PLAN_NO)
  iwp: 'iwp_name', iwp_name: 'iwp_name', iwp_plan_no: 'iwp_name',
  iwp_plan: 'iwp_name', work_package: 'iwp_name', wp: 'iwp_name',

  // Type / size / spec — pipe-spec / generic spec land on attr_spec; the
  // paint / insulation / heat-trace spec triplet has its own columns.
  type: 'attr_type', attr_type: 'attr_type',
  size: 'attr_size', sze: 'attr_size', attr_size: 'attr_size',
  spec: 'attr_spec', attr_spec: 'attr_spec', specification: 'attr_spec',
  pipe_spec: 'attr_spec',
  paint_spec: 'paint_spec',
  insu_spec: 'insu_spec', insulation_spec: 'insu_spec',
  heat_trace_spec: 'heat_trace_spec', heat_trace: 'heat_trace_spec',

  // Area / system dimensions — kept as four distinct fields (decision #1).
  line_area: 'line_area', area: 'line_area', line: 'line_area', module: 'line_area',
  zone: 'line_area', circuit: 'line_area',
  carea: 'carea', construction_area: 'carea', system_description: 'carea',
  var_area: 'var_area', variant_area: 'var_area',
  system: 'system', sys: 'system', system_code: 'system',

  // Schedule / package linkage
  sched_id: 'sched_id', schedule_id: 'sched_id', activity_id: 'sched_id',
  test_pkg: 'test_pkg', test_pkg1: 'test_pkg', test_package: 'test_pkg',
  cwp: 'cwp', construction_work_package: 'cwp',
  spl_cnt: 'spl_cnt', spool_count: 'spl_cnt', spools: 'spl_cnt',

  // WORK_TYPE — key into the work_types library; drives milestone lookup.
  work_type: 'work_type', worktype: 'work_type', work_type_code: 'work_type',

  // DISCIPLINE — explicit per-row discipline name (the unified workbook
  // adds this so a single multi-discipline file is self-identifying).
  discipline: 'discipline_label', discipline_label: 'discipline_label',

  // SERVICE — mechanical service identifier.
  service: 'service', service_type: 'service',

  // Record number from the source file → source_row.
  rec_no: 'source_row', source_row: 'source_row',

  // Turnaround location
  ta_bank: 'ta_bank',
  ta_bay: 'ta_bay',
  ta_level: 'ta_level',

  // Parts slip
  pslip: 'pslip', parts_slip: 'pslip',

  // WHRS_UNIT / IFC_WHRS are intentionally NOT in this table. WHRS_UNIT
  // is a generated column on progress_records (budget_hrs / budget_qty);
  // IFC_WHRS is mechanical's "issued for construction hours" figure that
  // shadows FLD_WHRS — leaving it unmapped means FLD_WHRS wins and IFC_WHRS
  // appears as an ignored column on import, which is the desired behaviour.
};

// Strings that mean "no value" in Sandra's audit files (decisions #6 + #8,
// plus the post-decision PSLIP clarification from SME on 2026-05-11).
// Applied only to columns where they're known placeholders — generic strings
// like "0" or "0.0" stay as-is everywhere else.
const PLACEHOLDER_STRINGS = new Set(['', 'n/a', 'na', '—', '-', '*c', '*s', '*n']);
const PLACEHOLDER_FIELDS: ReadonlySet<keyof ParsedRow> = new Set([
  'sched_id',
  'ta_bank',
  'ta_bay',
  'ta_level',
  'pslip',
]);

function normalizeHeader(h: string): string {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[%]/g, 'percent')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = v.toString().trim();
  return s.length > 0 ? s : undefined;
}

function stringForField(v: unknown, target: keyof ParsedRow): string | undefined {
  const s = toString(v);
  if (s === undefined) return undefined;
  if (PLACEHOLDER_FIELDS.has(target) && PLACEHOLDER_STRINGS.has(s.toLowerCase())) {
    return undefined;
  }
  return s;
}

interface MilestonePair {
  itemHeader: string;
  pctHeader: string;
}

// Milestone column conventions across the seven audit templates plus the
// in-house progress template:
//   Description side: item_N        (in-house template)
//                     mN_desc       (civil/inst/mech/pipe/steel audits)
//                     milestone_N   (defensive fallback)
//   Percent side:     pct_N / percent_N   (in-house)
//                     mN_pct              (civil/inst/mech/pipe/steel)
//                     mi_q_N              (electrical audit's variant)
// We deliberately do NOT match a bare `mN` header — the audit files' M1..M8
// columns near the end of the sheet contain ROC weights, not milestone
// values. Those are surfaced separately via inferredRocWeights below.
function findMilestonePairs(headers: string[]): MilestonePair[] {
  const pairs: MilestonePair[] = [];
  for (let n = 1; n <= 12; n++) {
    const descHeader = headers.find((h) => {
      const norm = normalizeHeader(h);
      return norm === `item_${n}` || norm === `m${n}_desc` || norm === `milestone_${n}`;
    });
    const pctHeader = headers.find((h) => {
      const norm = normalizeHeader(h);
      return (
        norm === `pct_${n}` ||
        norm === `percent_${n}` ||
        norm === `m${n}_pct` ||
        norm === `mi_q_${n}`
      );
    });
    if (descHeader && pctHeader) {
      pairs.push({ itemHeader: descHeader, pctHeader });
    }
  }
  return pairs;
}

// Detect bare m1..m8 columns (ROC weights). Sandra's audit files repeat the
// project's ROC weights on every row in columns M1..M8 (as decimals like
// 0.05, 0.30, …). We read them off the first row only — the Upload page
// uses them to warn if they don't match the project's ROC template.
function extractInferredRocWeights(
  headers: string[],
  firstRow: Record<string, unknown> | undefined,
): number[] {
  if (!firstRow) return [];
  const weights: number[] = [];
  for (let n = 1; n <= 8; n++) {
    const header = headers.find((h) => normalizeHeader(h) === `m${n}`);
    if (!header) return [];
    const v = toNumber(firstRow[header]);
    if (v === undefined) return [];
    weights.push(v);
  }
  return weights;
}

// Companion to extractInferredRocWeights: the first row's M1_DESC..M8_DESC
// values give us per-milestone labels (e.g. "Excavation", "Formwork"). Paired
// with the weights, they're enough to drive work_type_milestones_set in
// one call (e.g. the "Update template from this file" Upload action).
function extractInferredRocLabels(
  headers: string[],
  firstRow: Record<string, unknown> | undefined,
): string[] {
  if (!firstRow) return [];
  const labels: string[] = [];
  for (let n = 1; n <= 8; n++) {
    const header = headers.find((h) => normalizeHeader(h) === `m${n}_desc`);
    if (!header) return [];
    const v = toString(firstRow[header]);
    if (v === undefined) return [];
    labels.push(v);
  }
  return labels;
}

export function parseProgressWorkbook(workbook: XLSX.WorkBook): ParseResult {
  const empty: ParseResult = {
    rows: [],
    unmappedHeaders: [],
    inferredRocWeights: [],
    inferredRocLabels: [],
  };
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return empty;
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return empty;

  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (raw.length === 0 || !raw[0]) return empty;

  const rawHeaders = Object.keys(raw[0]);
  // Drop unnamed trailing columns (xlsx.js names them `__EMPTY`, `__EMPTY_1`,
  // …). Sandra's steel / iron audit files have 2-3 unnamed columns at the
  // end that hold internal formulas she uses to compute per-piece weights
  // — per SME confirmation 2026-05-11 these aren't part of the canonical
  // record schema. Stripping silently rather than showing them in the
  // "Ignored columns" warning keeps the post-parse UI quiet.
  const inputHeaders = rawHeaders.filter((h) => {
    const norm = normalizeHeader(h);
    return norm !== '' && !norm.startsWith('empty');
  });
  const milestonePairs = findMilestonePairs(inputHeaders);
  const milestoneHeaderSet = new Set(milestonePairs.flatMap((p) => [p.itemHeader, p.pctHeader]));

  // Bare M1..M8 headers carry the ROC weights — pick those up separately and
  // suppress them from the unmapped-headers list (they're handled, not ignored).
  const rocWeightHeaders = new Set<string>();
  for (let n = 1; n <= 8; n++) {
    const h = inputHeaders.find((h) => normalizeHeader(h) === `m${n}`);
    if (h) rocWeightHeaders.add(h);
  }

  // Headers we deliberately don't persist but also don't want to surface as
  // "ignored" — they're either generated server-side (whrs_unit, ern_qty,
  // earn_whrs, pct_earned, roc) or they're cross-reference helpers
  // (rec_no maps to source_row separately).
  const SUPPRESS_FROM_IGNORED: ReadonlySet<string> = new Set([
    'whrs_unit',        // generated column = budget_hrs / budget_qty
    'ifc_whrs',         // mechanical alias of whrs_unit per the unified workbook
    'pct_earned',       // generated from milestones × weights server-side
    'roc',              // generated = earn_whrs / fld_whrs server-side
    'ern_qty',          // → earned_qty_imported, but also computed server-side
    'earn_whrs',        // → earn_whrs_imported, but also computed server-side
    'earn_whr',         // mechanical's mis-spelling, same as above
  ]);

  const headerMapping: Record<string, keyof ParsedRow | null> = {};
  const unmapped: string[] = [];
  for (const h of inputHeaders) {
    if (milestoneHeaderSet.has(h) || rocWeightHeaders.has(h)) {
      headerMapping[h] = null;
      continue;
    }
    const norm = normalizeHeader(h);
    const mapped = HEADER_MAP[norm] ?? null;
    headerMapping[h] = mapped;
    if (!mapped && !SUPPRESS_FROM_IGNORED.has(norm)) unmapped.push(h);
  }

  const numericFields: ReadonlySet<keyof ParsedRow> = new Set([
    'budget_hrs',
    'actual_hrs',
    'percent_complete',
    'budget_qty',
    'actual_qty',
    'earned_qty_imported',
    'earn_whrs_imported',
    'spl_cnt',
    'source_row',
  ]);

  const rows: ParsedRow[] = raw
    .map((r) => {
      const out: ParsedRow = {};
      for (const [origHeader, target] of Object.entries(headerMapping)) {
        if (!target) continue;
        const v = r[origHeader];
        if (numericFields.has(target)) {
          const n = toNumber(v);
          if (n !== undefined) (out as Record<string, unknown>)[target] = n;
        } else {
          const s = stringForField(v, target);
          if (s !== undefined) (out as Record<string, unknown>)[target] = s;
        }
      }

      if (milestonePairs.length > 0) {
        const milestones: MilestoneEntry[] = [];
        for (const { itemHeader, pctHeader } of milestonePairs) {
          const name = toString(r[itemHeader]);
          const rawPct = r[pctHeader];
          if (!name) continue;
          let pct = toNumber(rawPct) ?? 0;
          // Some sources report 0.85 instead of 85; bump if it's clearly a fraction.
          if (pct > 0 && pct <= 1.001) pct = pct * 100;
          milestones.push({ name, pct: Math.max(0, Math.min(100, pct)) });
        }
        if (milestones.length > 0) out.milestones = milestones;
      }

      return out;
    })
    .filter(
      (r) =>
        r.dwg || r.name || r.tag_no || r.spool_fr || (r.milestones && r.milestones.length > 0),
    );

  const inferredRocWeights = extractInferredRocWeights(inputHeaders, raw[0]);
  const inferredRocLabels = extractInferredRocLabels(inputHeaders, raw[0]);

  return { rows, unmappedHeaders: unmapped, inferredRocWeights, inferredRocLabels };
}

export async function parseProgressFile(file: File): Promise<ParseResult> {
  const ext = file.name.toLowerCase().split('.').pop();
  let workbook: XLSX.WorkBook;
  if (ext === 'csv') {
    const text = await file.text();
    workbook = XLSX.read(text, { type: 'string' });
  } else {
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(buf, { type: 'array' });
  }
  return parseProgressWorkbook(workbook);
}

export function detectProgressDiscipline(
  filename: string,
  disciplines: { id: string; name: string }[],
): string | undefined {
  const lower = filename.toLowerCase();
  for (const d of disciplines) {
    if (lower.includes(d.name.toLowerCase())) return d.id;
  }
  return undefined;
}

export function recentSundayISO(): string {
  const now = new Date();
  const day = now.getDay();
  const offset = day === 0 ? 0 : day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - offset);
  return sunday.toISOString().slice(0, 10);
}
