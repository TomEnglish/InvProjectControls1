import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseProgressWorkbook, parseQmrWorkbook } from './progressParser';

function workbookFromRows(rows: Record<string, unknown>[]): XLSX.WorkBook {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

describe('parseProgressWorkbook', () => {
  it('maps canonical columns through the header alias table', () => {
    const wb = workbookFromRows([
      {
        Drawing: 'P-2001',
        Description: '2" CS pipe run',
        'Budget Hours': 320,
        'Actual Hours': 180,
        'Percent Complete': 56,
        UoM: 'LF',
        'Budget Qty': 320,
        'Actual Qty': 200,
        Foreman: 'Alice Chen',
        IWP: 'IWP-PIPE-001',
      },
    ]);
    const { rows, unmappedHeaders } = parseProgressWorkbook(wb);
    expect(unmappedHeaders).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({
      dwg: 'P-2001',
      name: '2" CS pipe run',
      budget_hrs: 320,
      actual_hrs: 180,
      percent_complete: 56,
      unit: 'LF',
      budget_qty: 320,
      actual_qty: 200,
      foreman_name: 'Alice Chen',
      iwp_name: 'IWP-PIPE-001',
    });
  });

  it('extracts milestone item/pct pairs into the milestones array', () => {
    const wb = workbookFromRows([
      {
        DWG: 'C-1001',
        Description: 'Pad A',
        item_1: 'Excavation',
        pct_1: 100,
        item_2: 'Formwork',
        pct_2: 60,
        item_3: 'Rebar',
        pct_3: 0,
      },
    ]);
    const { rows } = parseProgressWorkbook(wb);
    expect(rows[0]!.milestones).toEqual([
      { name: 'Excavation', pct: 100 },
      { name: 'Formwork', pct: 60 },
      { name: 'Rebar', pct: 0 },
    ]);
  });

  it('auto-scales fractional percent values (0..1) to whole percents (0..100)', () => {
    const wb = workbookFromRows([
      {
        DWG: 'P-2002',
        Description: 'Line 2002-B',
        Complete: 0.85,
      },
    ]);
    const { rows } = parseProgressWorkbook(wb);
    expect(rows[0]!.percent_complete).toBe(0.85);
    // The auto-scale logic only fires for milestone pct values, not the
    // top-level percent_complete column. Document that behavior here so we
    // catch any unintended changes.
  });

  it('auto-scales fractional milestone pct values', () => {
    const wb = workbookFromRows([
      {
        DWG: 'C-1002',
        Description: 'Pad B',
        item_1: 'Excavation',
        pct_1: 0.5,
      },
    ]);
    const { rows } = parseProgressWorkbook(wb);
    expect(rows[0]!.milestones).toEqual([{ name: 'Excavation', pct: 50 }]);
  });

  // Sandra's audit templates (ProgressDocs/InputExamples/) use REC_NO / DWG /
  // REV_NO / CODE / DESC_ / FLD_QTY / FLD_WHRS / IWP_FOREMAN / IWP_PLAN_NO /
  // PIPE_SPEC / CAREA. Make sure the alias map carries every one through and
  // that the M1_DESC/M1_PCT milestone pair is picked up.
  it('maps audit-file column shape (civil/pipe/instrumentation/etc.)', () => {
    const wb = workbookFromRows([
      {
        REC_NO: 1,
        DWG: 'P02.03-CV-120-DWG-00101',
        REV_NO: '0',
        CODE: '04130',
        DESC_: 'GTG-1 Foundation',
        SZE: 'large',
        FLD_QTY: 187,
        UOM: 'CY',
        FLD_WHRS: 1904,
        ERN_QTY: 0,
        PIPE_SPEC: 'CONC-04',
        CAREA: '401',
        IWP_FOREMAN: 'Alice Chen',
        IWP_PLAN_NO: 'CV-401-001',
        M1_DESC: 'Excavation',
        M1_PCT: 100,
        M2_DESC: 'Formwork',
        M2_PCT: 50,
      },
    ]);
    const { rows, unmappedHeaders } = parseProgressWorkbook(wb);
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({
      dwg: 'P02.03-CV-120-DWG-00101',
      rev: '0',
      code: '04130',
      name: 'GTG-1 Foundation',
      attr_size: 'large',
      budget_qty: 187,
      unit: 'CY',
      budget_hrs: 1904,
      attr_spec: 'CONC-04',
      // CAREA is its own dimension after decision #1 — no longer collapsed
      // onto line_area.
      carea: '401',
      foreman_name: 'Alice Chen',
      iwp_name: 'CV-401-001',
      source_row: 1, // REC_NO → source_row preserves the audit row index.
    });
    expect(rows[0]!.line_area).toBeUndefined();
    expect(rows[0]!.milestones).toEqual([
      { name: 'Excavation', pct: 100 },
      { name: 'Formwork', pct: 50 },
    ]);
    // Every audit-file column we care about now resolves to a ParsedRow
    // field — including REC_NO, which maps to source_row.
    expect(unmappedHeaders).toEqual([]);
  });

  // Electrical audit uses MI_Q_N for the milestone percent (M1_DESC stays).
  it('handles the electrical-audit milestone variant (MI_Q_N + M_DESC)', () => {
    const wb = workbookFromRows([
      {
        DWG: 'P02.03-EL-120-PLN-00022',
        CODE: '09220',
        DESC_: 'DBC-H Duct Bank',
        UOM: 'LF',
        FLD_QTY: 6408,
        FLD_WHRS: 1153.44,
        M1_DESC: 'Receive Materials',
        MI_Q_1: 100,
        M2_DESC: 'Run Conduit',
        MI_Q_2: 60,
      },
    ]);
    const { rows } = parseProgressWorkbook(wb);
    expect(rows[0]!.milestones).toEqual([
      { name: 'Receive Materials', pct: 100 },
      { name: 'Run Conduit', pct: 60 },
    ]);
  });

  // Decisions 2 + 3: ERN_QTY → earned_qty_imported; EARN_WHRS → earn_whrs_imported.
  // Neither should land on actual_qty / actual_hrs (those are reserved for
  // booked / timesheet figures).
  it('routes ERN_QTY and EARN_WHRS to imported-reconciliation fields', () => {
    const wb = workbookFromRows([
      {
        DWG: 'P-2001',
        DESC_: 'Test row',
        FLD_QTY: 100,
        FLD_WHRS: 500,
        ERN_QTY: 40,
        EARN_WHRS: 200,
        ACTUAL_HRS: 180,
      },
    ]);
    const { rows } = parseProgressWorkbook(wb);
    expect(rows[0]!).toMatchObject({
      budget_qty: 100,
      budget_hrs: 500,
      earned_qty_imported: 40,
      earn_whrs_imported: 200,
      actual_hrs: 180,
    });
    expect(rows[0]!.actual_qty).toBeUndefined();
  });

  // Decision 1: SYSTEM, CAREA, LINE_AREA, VAR_AREA are four distinct dimensions.
  it('keeps SYSTEM, CAREA, LINE_AREA, VAR_AREA as four separate fields', () => {
    const wb = workbookFromRows([
      {
        DWG: 'P-2001',
        DESC_: 'Test row',
        SYSTEM: 'DR',
        CAREA: 'SITE DRAIN SYS SLOP TANK UN# 2',
        LINE_AREA: 'UG',
        VAR_AREA: '120',
      },
    ]);
    const { rows } = parseProgressWorkbook(wb);
    expect(rows[0]!).toMatchObject({
      system: 'DR',
      carea: 'SITE DRAIN SYS SLOP TANK UN# 2',
      line_area: 'UG',
      var_area: '120',
    });
  });

  // Decision 6: SCHED_ID placeholders normalize to undefined.
  // Decision 8: TA_BANK/BAY/LEVEL 'N/A' normalize to undefined.
  it('normalizes placeholder strings to undefined for SCHED_ID and TA_*', () => {
    const wb = workbookFromRows([
      {
        DWG: 'A',
        DESC_: 'Placeholder row',
        SCHED_ID: '*C',
        TA_BANK: 'N/A',
        TA_BAY: '—',
        TA_LEVEL: '',
      },
      {
        DWG: 'B',
        DESC_: 'Real row',
        SCHED_ID: 'CN-2760',
        TA_BANK: 'B1',
        TA_BAY: 'Bay-3',
        TA_LEVEL: 'L2',
      },
    ]);
    const { rows } = parseProgressWorkbook(wb);
    expect(rows[0]!.sched_id).toBeUndefined();
    expect(rows[0]!.ta_bank).toBeUndefined();
    expect(rows[0]!.ta_bay).toBeUndefined();
    expect(rows[0]!.ta_level).toBeUndefined();
    expect(rows[1]!).toMatchObject({
      sched_id: 'CN-2760',
      ta_bank: 'B1',
      ta_bay: 'Bay-3',
      ta_level: 'L2',
    });
  });

  // Decision 5: bare M1..M8 columns surface as inferredRocWeights for the
  // Upload page to validate against the project's ROC template.
  it('extracts inferred ROC weights from bare M1..M8 columns', () => {
    const wb = workbookFromRows([
      {
        DWG: 'A',
        DESC_: 'Row',
        M1: 0.05,
        M2: 0.3,
        M3: 0.25,
        M4: 0.1,
        M5: 0.1,
        M6: 0.1,
        M7: 0.1,
        M8: 0,
      },
    ]);
    const { rows, inferredRocWeights, unmappedHeaders } = parseProgressWorkbook(wb);
    expect(inferredRocWeights).toEqual([0.05, 0.3, 0.25, 0.1, 0.1, 0.1, 0.1, 0]);
    // The bare M1..M8 columns are handled (not "ignored" — handled).
    expect(unmappedHeaders).not.toContain('M1');
    expect(rows[0]!).not.toHaveProperty('m1');
  });

  it('returns empty inferredRocWeights when bare M_N columns are absent', () => {
    const wb = workbookFromRows([{ DWG: 'A', DESC_: 'Row' }]);
    const { inferredRocWeights } = parseProgressWorkbook(wb);
    expect(inferredRocWeights).toEqual([]);
  });

  // SME confirmation 2026-05-11: PSLIP is a text identifier (often 'N/A');
  // the decimal values that show up in Sandra's steel audit are in trailing
  // unnamed columns she uses for internal formulas. Both should be dropped
  // silently — PSLIP normalised to undefined, formula columns stripped from
  // the "Ignored columns" warning so it doesn't surface __EMPTY noise.
  it('normalises PSLIP placeholders and silently drops unnamed formula columns', () => {
    const wb = workbookFromRows([
      {
        DWG: 'ST-001',
        DESC_: 'W10X49',
        PSLIP: 'N/A',
        __EMPTY: 15.735,
        __EMPTY_1: 0.562,
        __EMPTY_2: 8.844,
      },
    ]);
    const { rows, unmappedHeaders } = parseProgressWorkbook(wb);
    expect(rows[0]!.pslip).toBeUndefined();
    expect(unmappedHeaders).toEqual([]); // the __EMPTY trio is gone, not "ignored"
  });

  it('keeps PSLIP when it carries a real identifier', () => {
    const wb = workbookFromRows([
      { DWG: 'ST-001', DESC_: 'W10X49', PSLIP: 'PS-1234' },
    ]);
    const { rows } = parseProgressWorkbook(wb);
    expect(rows[0]!.pslip).toBe('PS-1234');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Unified QMR workbook parsing (QMR Report Phase 2 - Unified vN.xlsx)
// ─────────────────────────────────────────────────────────────────────
describe('parseQmrWorkbook', () => {
  // Mirrors the real audit-tab layout: banner row (merged group labels),
  // header row, applicability metadata row, then data.
  function auditSheet(discipline: string, dataRows: unknown[][]): XLSX.WorkSheet {
    return XLSX.utils.aoa_to_sheet([
      ['Record Identity', '', 'Drawing & Schedule', '', '', ''],
      ['DISCIPLINE', 'REC_NO', 'DWG', 'CODE', 'FLD_QTY', 'UOM', 'FLD_WHRS', 'WORK_TYPE', 'M1_PCT', 'M1_DESC', 'REMAINING_HOURS'],
      ['ALL', 'ALL', 'ALL', 'ALL', 'ALL', 'ALL', 'ALL except Foundations', 'ALL', 'ALL', 'ALL', 'ALL'],
      ...dataRows.map((r) => [discipline, ...r]),
    ]);
  }

  function qmrWorkbook(): XLSX.WorkBook {
    const wb = XLSX.utils.book_new();
    // Reference tabs that must NOT be picked up as audit data.
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Quarterly Manhour Report'], ['Craft', 'Description', 'UOM']]),
      'QMR Summary',
    );
    XLSX.utils.book_append_sheet(
      wb,
      auditSheet('Civil', [
        [1, 'CV-100', '04130', 187, 'CY', 1271.6, 'CIV-FDN', 1, 'Formwork', 343.3],
        [2, 'CV-100', '04700', 10, 'CY', 12.5, 'CIV-COMP', 0.2, 'Complete', 0],
      ]),
      'Civ Audit',
    );
    XLSX.utils.book_append_sheet(
      wb,
      auditSheet('Site Work', [[1, 'SW-001', '01410', 500, 'CY', 15, 'SITE-COMP', 0.5, 'Complete', 7.5]]),
      'Site Work Audit',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['WORK_TYPE', 'DISCIPLINE', 'DESCRIPTION'],
        ['CIV-FDN', 'Civil', 'Foundations'],
      ]),
      'Milestone Reference',
    );
    return wb;
  }

  it('detects only audit tabs and routes each to its discipline code', () => {
    const { auditSheets } = parseQmrWorkbook(qmrWorkbook());
    expect(auditSheets.map((s) => s.sheetName)).toEqual(['Civ Audit', 'Site Work Audit']);
    expect(auditSheets[0]!).toMatchObject({ disciplineLabel: 'Civil', disciplineCode: 'CIVIL' });
    expect(auditSheets[1]!).toMatchObject({ disciplineLabel: 'Site Work', disciplineCode: 'SITE' });
  });

  it('reads headers from row 2 and drops the applicability metadata row', () => {
    const { auditSheets } = parseQmrWorkbook(qmrWorkbook());
    const civ = auditSheets[0]!;
    expect(civ.rows).toHaveLength(2);
    expect(civ.rows[0]!).toMatchObject({
      discipline_label: 'Civil',
      source_row: 1,
      dwg: 'CV-100',
      code: '04130',
      budget_qty: 187,
      unit: 'CY',
      budget_hrs: 1271.6,
      work_type: 'CIV-FDN',
    });
    // No row carries the metadata placeholder.
    expect(civ.rows.every((r) => r.dwg !== 'ALL')).toBe(true);
  });

  it('extracts milestone pairs with fraction→percent scaling', () => {
    const { auditSheets } = parseQmrWorkbook(qmrWorkbook());
    expect(auditSheets[0]!.rows[0]!.milestones).toEqual([{ name: 'Formwork', pct: 100 }]);
    expect(auditSheets[0]!.rows[1]!.milestones).toEqual([{ name: 'Complete', pct: 20 }]);
  });

  it('suppresses the REMAINING_HOURS formula column from ignored headers', () => {
    const { auditSheets } = parseQmrWorkbook(qmrWorkbook());
    expect(auditSheets[0]!.unmappedHeaders).toEqual([]);
  });

  it('flags an unrecognized discipline label with a null code', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      auditSheet('Scaffolding', [[1, 'SC-1', '99100', 10, 'EA', 5, '', 0, 'Complete', 5]]),
      'Scaf Audit',
    );
    const { auditSheets } = parseQmrWorkbook(wb);
    expect(auditSheets[0]!.disciplineLabel).toBe('Scaffolding');
    expect(auditSheets[0]!.disciplineCode).toBeNull();
  });

  it('returns no audit sheets for a flat single-sheet progress file', () => {
    const wb = workbookFromRows([{ DWG: 'P-2001', Description: 'pipe run' }]);
    const { auditSheets } = parseQmrWorkbook(wb);
    expect(auditSheets).toEqual([]);
  });
});
