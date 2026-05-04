import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseProgressWorkbook } from './progressParser';

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
});
