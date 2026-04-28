/**
 * Generates two .xlsx workbooks under samples/ that match the import-records
 * and import-coa Edge Function expectations:
 *
 *   samples/audit-records-sample.xlsx   — 6 rows for KIS-2026-001
 *   samples/coa-codes-sample.xlsx       — 4 cost codes (one of which overlaps
 *                                         a seeded code so the upsert path
 *                                         exercises the update branch)
 *
 * Run with: npx tsx scripts/sample/generate-import-workbooks.ts
 *
 * Both workbooks reference the seeded discipline codes and (existing) COA
 * codes from `npm run seed:demo`, so they import cleanly against a freshly
 * seeded tenant. rec_no values start at 1001 to avoid colliding with the
 * 10 records the seed creates.
 */
import * as XLSX from 'xlsx';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.cwd(), 'samples');
mkdirSync(outDir, { recursive: true });

const auditRecords = [
  { rec_no: 1001, dwg: 'C-1010', rev: '1', description: 'Foundation Pad D-401',  discipline_code: 'CIVIL', coa_code: '101', uom: 'CY',  fld_qty:  52.0 },
  { rec_no: 1002, dwg: 'P-2050', rev: '2', description: '4" CS — Line 2050-A',    discipline_code: 'PIPE',  coa_code: '202', uom: 'LF',  fld_qty: 240.0 },
  { rec_no: 1003, dwg: 'P-2051', rev: '1', description: '8" Alloy — Line 2051-B', discipline_code: 'PIPE',  coa_code: '210', uom: 'LF',  fld_qty: 120.0 },
  { rec_no: 1004, dwg: 'S-3010', rev: '1', description: 'Pipe Rack T-2 Steel',    discipline_code: 'STEEL', coa_code: '301', uom: 'TONS', fld_qty:  18.5 },
  { rec_no: 1005, dwg: 'E-4010', rev: '1', description: 'Cable Tray CT-301',      discipline_code: 'ELEC',  coa_code: '401', uom: 'LF',  fld_qty: 380.0 },
  { rec_no: 1006, dwg: 'I-6010', rev: '1', description: 'PT-201 Pressure Tx',     discipline_code: 'INST',  coa_code: '601', uom: 'EA',  fld_qty:   1.0 },
];

const coaCodes = [
  // New codes
  { prime: '200', code: '220', description: 'Stainless Pipe',  parent: '200', level: 2, uom: 'LF',   base_rate: 4.10, pf_adj: 1.20 },
  { prime: '300', code: '302', description: 'Misc Steel Trim', parent: '300', level: 2, uom: 'TONS', base_rate: 22.0, pf_adj: 1.05 },
  { prime: '400', code: '410', description: 'Lighting',        parent: '400', level: 2, uom: 'EA',   base_rate: 2.50, pf_adj: 1.10 },
  // Overlaps the seeded 101 (Concrete Foundations) — exercises the update path.
  { prime: '100', code: '101', description: 'Concrete Foundations (updated description)', parent: '100', level: 2, uom: 'CY', base_rate: 8.5, pf_adj: 1.12 },
];

function writeWorkbook(rows: Record<string, unknown>[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const path = resolve(outDir, filename);
  XLSX.writeFile(wb, path);
  console.log(`✓ ${path} (${rows.length} rows)`);
}

writeWorkbook(auditRecords, 'audit-records-sample.xlsx');
writeWorkbook(coaCodes, 'coa-codes-sample.xlsx');
