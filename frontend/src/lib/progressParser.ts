import * as XLSX from 'xlsx';

export interface MilestoneEntry {
  name: string;
  pct: number;
}

export interface ParsedRow {
  dwg?: string;
  rev?: string;
  code?: string;
  name?: string;
  budget_hrs?: number;
  actual_hrs?: number;
  percent_complete?: number;
  unit?: string;
  budget_qty?: number;
  actual_qty?: number;
  foreman_name?: string;
  iwp_name?: string;
  attr_type?: string;
  attr_size?: string;
  attr_spec?: string;
  line_area?: string;
  milestones?: MilestoneEntry[];
}

export interface ParseResult {
  rows: ParsedRow[];
  unmappedHeaders: string[];
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

  // Description / item name (audit files use DESC_, SPOOL_FR, or TAG_NO depending
  // on discipline; instrumentation also uses TAG_NO ).
  name: 'name', description: 'name', desc: 'name', desc_: 'name',
  item_description: 'name', tag_no: 'name', tag: 'name', spool_fr: 'name',

  // Budget hours (audit files use FLD_WHRS = field work hours; mechanical also
  // exposes IFC_WHRS which is the issued-for-construction hour estimate).
  budget_hrs: 'budget_hrs', budget_hours: 'budget_hrs', budget: 'budget_hrs',
  budgeted_hrs: 'budget_hrs', plan_hrs: 'budget_hrs', hours: 'budget_hrs',
  fld_whrs: 'budget_hrs', field_whrs: 'budget_hrs', field_hrs: 'budget_hrs',
  ifc_whrs: 'budget_hrs',

  // Actual hours (timesheet hours booked — audit files don't carry this; the
  // EARN_WHRS column is computed from milestones and intentionally not mapped
  // here so we don't conflate earned with actual).
  actual_hrs: 'actual_hrs', actual_hours: 'actual_hrs', actual: 'actual_hrs',
  spent_hrs: 'actual_hrs',

  // Percent complete
  percent_complete: 'percent_complete', percent: 'percent_complete', pct: 'percent_complete',
  pct_complete: 'percent_complete', complete: 'percent_complete',
  completion: 'percent_complete', percent_hrs: 'percent_complete',
  percenthrs: 'percent_complete',

  // Unit of measure
  unit: 'unit', uom: 'unit', units: 'unit', unit_of_measure: 'unit',

  // Budget / planned quantity (audit files use FLD_QTY = field quantity)
  budget_qty: 'budget_qty', budget_quantity: 'budget_qty', qty_budget: 'budget_qty',
  plan_qty: 'budget_qty', planned_qty: 'budget_qty', qty: 'budget_qty', quantity: 'budget_qty',
  fld_qty: 'budget_qty', field_qty: 'budget_qty',

  // Actual / earned quantity (audit files use ERN_QTY)
  actual_qty: 'actual_qty', actual_quantity: 'actual_qty', qty_actual: 'actual_qty',
  earned_qty: 'actual_qty', ern_qty: 'actual_qty', earn_qty: 'actual_qty',

  // Foreman (audit files use IWP_FOREMAN; some sheets also expose IWP_GEN_FOREMAN
  // for the general foreman — collapsed onto the same target since the schema
  // tracks one foreman per record).
  foreman: 'foreman_name', foreman_name: 'foreman_name', supervisor: 'foreman_name',
  lead: 'foreman_name', iwp_foreman: 'foreman_name', iwp_gen_foreman: 'foreman_name',

  // IWP / work package (audit files use IWP_PLAN_NO)
  iwp: 'iwp_name', iwp_name: 'iwp_name', iwp_plan_no: 'iwp_name',
  iwp_plan: 'iwp_name', work_package: 'iwp_name', wp: 'iwp_name',

  // Type / size / spec (audit files use SZE for size and PIPE_SPEC/SPEC for spec)
  type: 'attr_type', attr_type: 'attr_type',
  size: 'attr_size', sze: 'attr_size', attr_size: 'attr_size',
  spec: 'attr_spec', attr_spec: 'attr_spec', specification: 'attr_spec',
  pipe_spec: 'attr_spec',

  // Line / area / system / circuit (all collapse to the records' line_area
  // column — discipline-specific naming, same downstream filter target)
  line_area: 'line_area', area: 'line_area', line: 'line_area', module: 'line_area',
  system: 'line_area', zone: 'line_area', carea: 'line_area', circuit: 'line_area',
  var_area: 'line_area',
};

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
// We deliberately do NOT match a bare `m_N` header — the audit files' M1..M8
// columns near the end of the sheet contain ROC weights, not milestone values.
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

export function parseProgressWorkbook(workbook: XLSX.WorkBook): ParseResult {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], unmappedHeaders: [] };
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { rows: [], unmappedHeaders: [] };

  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (raw.length === 0 || !raw[0]) return { rows: [], unmappedHeaders: [] };

  const inputHeaders = Object.keys(raw[0]);
  const milestonePairs = findMilestonePairs(inputHeaders);
  const milestoneHeaderSet = new Set(milestonePairs.flatMap((p) => [p.itemHeader, p.pctHeader]));

  const headerMapping: Record<string, keyof ParsedRow | null> = {};
  const unmapped: string[] = [];
  for (const h of inputHeaders) {
    if (milestoneHeaderSet.has(h)) {
      headerMapping[h] = null;
      continue;
    }
    const norm = normalizeHeader(h);
    const mapped = HEADER_MAP[norm] ?? null;
    headerMapping[h] = mapped;
    if (!mapped) unmapped.push(h);
  }

  const numericFields: (keyof ParsedRow)[] = [
    'budget_hrs',
    'actual_hrs',
    'percent_complete',
    'budget_qty',
    'actual_qty',
  ];

  const rows: ParsedRow[] = raw
    .map((r) => {
      const out: ParsedRow = {};
      for (const [origHeader, target] of Object.entries(headerMapping)) {
        if (!target) continue;
        const v = r[origHeader];
        if (numericFields.includes(target)) {
          const n = toNumber(v);
          if (n !== undefined) (out as Record<string, unknown>)[target] = n;
        } else {
          const s = toString(v);
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
    .filter((r) => r.dwg || r.name || (r.milestones && r.milestones.length > 0));

  return { rows, unmappedHeaders: unmapped };
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
