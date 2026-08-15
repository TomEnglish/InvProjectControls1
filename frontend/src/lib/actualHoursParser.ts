import * as XLSX from 'xlsx';

export type ActualHoursRow = {
  discipline_label: string;
  dwg: string;
  tag_no?: string;
  spool_fr?: string;
  attr_spec: string;
  hours: number;
};

export type ActualHoursIssue = {
  row?: number;
  column?: string;
  message: string;
};

export class ActualHoursFormatError extends Error {
  constructor(public readonly issues: ActualHoursIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'ActualHoursFormatError';
  }
}

const REQUIRED_HEADERS = ['DISCIPLINE', 'DWG', 'TAG_NO', 'SPOOL_FR', 'SPEC', 'ACTUAL_HRS'] as const;
const MAX_ROWS = 10_000;

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(text(value).replace(/,/g, ''));
  return text(value) && Number.isFinite(parsed) ? parsed : null;
}

function identityKey(row: ActualHoursRow): string {
  const itemType = row.spool_fr ? 'spool' : 'tag';
  const item = row.spool_fr || row.tag_no || '';
  return [row.discipline_label, row.dwg, row.attr_spec, itemType, item]
    .map((value) => value.trim().toLowerCase())
    .join('|');
}

export function parseActualHoursWorkbook(workbook: XLSX.WorkBook): { rows: ActualHoursRow[] } {
  const issues: ActualHoursIssue[] = [];
  if (workbook.SheetNames.length !== 1) {
    throw new ActualHoursFormatError([{ message: 'Actual-hours upload must contain exactly one worksheet.' }]);
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) {
    throw new ActualHoursFormatError([{ message: 'Actual-hours worksheet could not be read.' }]);
  }
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
  const headerRow = raw.findIndex((row) => row.some((cell) => text(cell)));
  if (headerRow < 0) {
    throw new ActualHoursFormatError([{ message: 'Actual-hours worksheet is empty.' }]);
  }

  const headers = (raw[headerRow] ?? []).map(normalizeHeader);
  const headerPositions = new Map<string, number>();
  headers.forEach((header, index) => {
    if (!header) return;
    if (headerPositions.has(header)) {
      issues.push({ row: headerRow + 1, column: header, message: `Duplicate header ${header}.` });
    } else {
      headerPositions.set(header, index);
    }
  });

  for (const required of REQUIRED_HEADERS) {
    if (!headerPositions.has(required)) {
      issues.push({ message: `Missing required actual-hours column ${required}.` });
    }
  }
  const allowed = new Set(REQUIRED_HEADERS);
  headers.forEach((header, index) => {
    if (header && !allowed.has(header as typeof REQUIRED_HEADERS[number])) {
      issues.push({ row: headerRow + 1, column: header, message: `Unexpected actual-hours column ${header} at position ${index + 1}.` });
    }
  });
  if (issues.length > 0) throw new ActualHoursFormatError(issues);

  const at = (row: unknown[], header: typeof REQUIRED_HEADERS[number]) =>
    row[headerPositions.get(header)!];
  const rows: ActualHoursRow[] = [];
  const keys = new Set<string>();
  const dataRows = raw.slice(headerRow + 1);
  const nonEmptyRows = dataRows.filter((row) => row.some((cell) => text(cell)));
  if (nonEmptyRows.length > MAX_ROWS) {
    throw new ActualHoursFormatError([{
      message: `Actual-hours upload contains ${nonEmptyRows.length} data rows; the maximum is ${MAX_ROWS.toLocaleString()}.`,
    }]);
  }
  dataRows.forEach((rawRow, index) => {
    const rowNumber = headerRow + index + 2;
    const row = rawRow ?? [];
    if (!row.some((cell) => text(cell))) return;

    const parsed: ActualHoursRow = {
      discipline_label: text(at(row, 'DISCIPLINE')),
      dwg: text(at(row, 'DWG')),
      tag_no: text(at(row, 'TAG_NO')) || undefined,
      spool_fr: text(at(row, 'SPOOL_FR')) || undefined,
      attr_spec: text(at(row, 'SPEC')),
      hours: numberValue(at(row, 'ACTUAL_HRS')) ?? Number.NaN,
    };
    if (!parsed.discipline_label) issues.push({ row: rowNumber, column: 'DISCIPLINE', message: `Row ${rowNumber}: DISCIPLINE is required.` });
    if (!parsed.dwg) issues.push({ row: rowNumber, column: 'DWG', message: `Row ${rowNumber}: DWG is required.` });
    if (!parsed.attr_spec) issues.push({ row: rowNumber, column: 'SPEC', message: `Row ${rowNumber}: SPEC is required.` });
    if (!parsed.tag_no && !parsed.spool_fr) {
      issues.push({ row: rowNumber, column: 'TAG_NO/SPOOL_FR', message: `Row ${rowNumber}: TAG_NO or SPOOL_FR is required.` });
    }
    if (!Number.isFinite(parsed.hours) || parsed.hours < 0) {
      issues.push({ row: rowNumber, column: 'ACTUAL_HRS', message: `Row ${rowNumber}: ACTUAL_HRS must be a non-negative number.` });
    }
    if (parsed.discipline_label && parsed.dwg && parsed.attr_spec && (parsed.tag_no || parsed.spool_fr)) {
      const key = identityKey(parsed);
      if (keys.has(key)) issues.push({ row: rowNumber, message: `Row ${rowNumber}: duplicate baseline identity in the actual-hours file.` });
      keys.add(key);
    }
    rows.push(parsed);
  });

  if (issues.length > 0) throw new ActualHoursFormatError(issues);
  return { rows };
}

export async function parseActualHoursFile(file: File): Promise<{ rows: ActualHoursRow[] }> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'xlsx' && ext !== 'xls') {
    throw new ActualHoursFormatError([{ message: 'Only .xlsx or .xls actual-hours workbooks can be uploaded.' }]);
  }
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return parseActualHoursWorkbook(workbook);
}
