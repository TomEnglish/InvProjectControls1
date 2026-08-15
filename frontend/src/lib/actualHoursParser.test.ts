import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  ActualHoursFormatError,
  parseActualHoursWorkbook,
} from './actualHoursParser';

function workbookFromRows(rows: unknown[][], sheetName = 'Actual Hours'): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

describe('parseActualHoursWorkbook', () => {
  it('parses the strict one-sheet actual-hours format', () => {
    const result = parseActualHoursWorkbook(workbookFromRows([
      ['DISCIPLINE', 'DWG', 'TAG_NO', 'SPOOL_FR', 'SPEC', 'ACTUAL_HRS'],
      ['Pipe', '120-DR-590-SHT01', '', '120-DR-590-SHT01-1', '01HDPE', 12.5],
    ]));

    expect(result.rows).toEqual([{
      discipline_label: 'Pipe',
      dwg: '120-DR-590-SHT01',
      tag_no: undefined,
      spool_fr: '120-DR-590-SHT01-1',
      attr_spec: '01HDPE',
      hours: 12.5,
    }]);
  });

  it('blocks missing headers and invalid row values', () => {
    expect(() => parseActualHoursWorkbook(workbookFromRows([
      ['DISCIPLINE', 'DWG', 'SPEC', 'ACTUAL_HRS'],
      ['Pipe', 'D-1', '01HDPE', -2],
    ]))).toThrow(ActualHoursFormatError);
  });

  it('blocks duplicate identity rows', () => {
    expect(() => parseActualHoursWorkbook(workbookFromRows([
      ['DISCIPLINE', 'DWG', 'TAG_NO', 'SPOOL_FR', 'SPEC', 'ACTUAL_HRS'],
      ['Pipe', 'D-1', '', 'S-1', '01HDPE', 2],
      ['Pipe', 'D-1', '', 'S-1', '01HDPE', 3],
    ]))).toThrow(/duplicate/i);
  });

  it('requires exactly one worksheet', () => {
    const wb = workbookFromRows([
      ['DISCIPLINE', 'DWG', 'TAG_NO', 'SPOOL_FR', 'SPEC', 'ACTUAL_HRS'],
      ['Pipe', 'D-1', '', 'S-1', '01HDPE', 2],
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['extra']]), 'Extra');
    expect(() => parseActualHoursWorkbook(wb)).toThrow(/one worksheet/i);
  });

  it('blocks oversized workbooks', () => {
    const rows = [
      ['DISCIPLINE', 'DWG', 'TAG_NO', 'SPOOL_FR', 'SPEC', 'ACTUAL_HRS'],
      ...Array.from({ length: 10_001 }, (_, index) => [
        'Pipe', `D-${index}`, '', `S-${index}`, '01HDPE', 1,
      ]),
    ];
    expect(() => parseActualHoursWorkbook(workbookFromRows(rows))).toThrow(/maximum/i);
  });
});
