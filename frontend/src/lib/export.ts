/** Escape a cell for RFC 4180 CSV. Quotes any cell containing comma,
 * quote, CR, or LF; doubles internal quotes. */
function esc(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const lines = [headers.map(esc).join(',')];
  for (const row of rows) lines.push(row.map(esc).join(','));
  // RFC 4180 specifies CRLF line terminators. Excel + most parsers accept
  // LF too, but CRLF is the safer default. UTF-8 BOM keeps Excel from
  // mis-detecting the encoding on Windows.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
