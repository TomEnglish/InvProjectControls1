import * as XLSX from 'xlsx';

export interface MilestoneEntry {
  name: string;
  pct: number;
}

export interface ParsedRow {
  dwg?: string;
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

const HEADER_MAP: Record<string, keyof ParsedRow> = {
  dwg: 'dwg', drawing: 'dwg', iso: 'dwg', drawing_no: 'dwg', drawing_number: 'dwg',
  name: 'name', description: 'name', desc: 'name', item_description: 'name',
  budget_hrs: 'budget_hrs', budget_hours: 'budget_hrs', budget: 'budget_hrs', budgeted_hrs: 'budget_hrs', plan_hrs: 'budget_hrs', hours: 'budget_hrs',
  actual_hrs: 'actual_hrs', actual_hours: 'actual_hrs', actual: 'actual_hrs', spent_hrs: 'actual_hrs',
  percent_complete: 'percent_complete', percent: 'percent_complete', pct: 'percent_complete', pct_complete: 'percent_complete', complete: 'percent_complete', completion: 'percent_complete', percent_hrs: 'percent_complete', percenthrs: 'percent_complete',
  unit: 'unit', uom: 'unit', units: 'unit', unit_of_measure: 'unit',
  budget_qty: 'budget_qty', budget_quantity: 'budget_qty', qty_budget: 'budget_qty', plan_qty: 'budget_qty', qty: 'budget_qty', quantity: 'budget_qty',
  actual_qty: 'actual_qty', actual_quantity: 'actual_qty', qty_actual: 'actual_qty', earned_qty: 'actual_qty',
  foreman: 'foreman_name', foreman_name: 'foreman_name', supervisor: 'foreman_name', lead: 'foreman_name', iwp_foreman: 'foreman_name',
  iwp: 'iwp_name', iwp_name: 'iwp_name', work_package: 'iwp_name', wp: 'iwp_name',
  type: 'attr_type', attr_type: 'attr_type',
  size: 'attr_size', attr_size: 'attr_size',
  spec: 'attr_spec', attr_spec: 'attr_spec', specification: 'attr_spec',
  line_area: 'line_area', area: 'line_area', line: 'line_area', module: 'line_area', system: 'line_area', zone: 'line_area',
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

function findMilestonePairs(headers: string[]): MilestonePair[] {
  const pairs: MilestonePair[] = [];
  for (let n = 1; n <= 12; n++) {
    const itemHeader = headers.find((h) => normalizeHeader(h) === `item_${n}`);
    const pctHeader = headers.find(
      (h) => normalizeHeader(h) === `pct_${n}` || normalizeHeader(h) === `percent_${n}`,
    );
    if (itemHeader && pctHeader) {
      pairs.push({ itemHeader, pctHeader });
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
