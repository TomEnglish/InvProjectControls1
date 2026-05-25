import type { WorkTypeRow } from '@/lib/queries';

const LOG_COLUMNS = 5;

/**
 * Jerry's audit-log print layout (ELL-64): one row per work type with
 * M1–M5 milestone definitions across and weight percentages underneath.
 * Opens a print dialog — users pick "Save as PDF" for field handouts.
 */
export function printWorkType(workType: WorkTypeRow): void {
  const w = window.open('', '_blank', 'width=1000,height=900');
  if (!w) return;

  const ms = [...workType.milestones].sort((a, b) => a.seq - b.seq);
  const bySeq = new Map(ms.map((m) => [m.seq, m]));
  const totalWeight = ms.reduce((s, m) => s + m.weight, 0);
  const totalPct = totalWeight * 100;

  const headerCells: string[] = [];
  const labelCells: string[] = [];
  const pctCells: string[] = [];

  for (let seq = 1; seq <= LOG_COLUMNS; seq++) {
    const m = bySeq.get(seq);
    headerCells.push(`<th>M${seq}</th>`);
    labelCells.push(
      `<td class="def">${m ? escapeHtml(m.label) : '—'}</td>`,
    );
    pctCells.push(
      `<td class="pct">${m ? `${(m.weight * 100).toFixed(2)}%` : '—'}</td>`,
    );
  }

  const extra =
    ms.filter((m) => m.seq > LOG_COLUMNS).length > 0
      ? `<p class="extra-note">This work type has ${ms.length} milestones; M6–M8 are omitted from the field log layout.</p>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ROC Log — ${escapeHtml(workType.work_type_code)}</title>
  <style>
    @page { margin: 0.5in; size: landscape; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      color: #111;
      margin: 0;
      padding: 16px 20px;
      font-size: 10pt;
    }
    .doc-title {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 9pt;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #475569;
      margin-bottom: 4px;
    }
    .log-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    .log-table th,
    .log-table td {
      border: 1px solid #334155;
      padding: 6px 8px;
      vertical-align: top;
    }
    .log-table th {
      background: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 8pt;
      text-align: center;
      width: ${100 / (LOG_COLUMNS + 2)}%;
    }
    .code-cell {
      font-weight: 700;
      font-size: 11pt;
      white-space: nowrap;
      width: 72px;
    }
    .desc-cell {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 10pt;
      min-width: 180px;
    }
    .def {
      font-size: 9pt;
      line-height: 1.35;
      min-height: 48px;
    }
    .pct {
      text-align: center;
      font-weight: 700;
      font-size: 10pt;
      background: #f8fafc;
    }
    .pct-row td {
      border-top: 2px solid #334155;
    }
    .meta {
      margin-top: 10px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 8pt;
      color: #64748b;
      display: flex;
      justify-content: space-between;
    }
    .extra-note {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 8pt;
      color: #64748b;
      margin: 8px 0 0;
    }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="doc-title">Rules of Credit — Field Log</div>
  <table class="log-table">
    <thead>
      <tr>
        <th>Code</th>
        <th>Description</th>
        ${headerCells.join('')}
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="code-cell">${escapeHtml(workType.work_type_code)}</td>
        <td class="desc-cell">${escapeHtml(workType.description)}<br><span style="color:#64748b;font-size:8pt">${escapeHtml(workType.discipline_code)} · v${workType.version}</span></td>
        ${labelCells.join('')}
      </tr>
      <tr class="pct-row">
        <td colspan="2" style="text-align:right;font-size:8pt;color:#64748b">Weight %</td>
        ${pctCells.join('')}
      </tr>
    </tbody>
  </table>
  ${extra}
  <div class="meta">
    <span>Invenio ProjectControls</span>
    <span>Total weight: ${totalPct.toFixed(2)}% · Printed ${new Date().toLocaleDateString()}</span>
  </div>
  <script>
    window.addEventListener('load', () => { setTimeout(() => window.print(), 100); });
  </script>
</body>
</html>`;

  w.document.write(html);
  w.document.close();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
