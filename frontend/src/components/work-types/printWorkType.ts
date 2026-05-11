import type { WorkTypeRow } from '@/lib/queries';

/**
 * Open a self-contained print window for a single work_type and trigger the
 * OS print dialog. Users pick "Save as PDF" from the dialog to get a
 * shareable handout for superintendents in the field.
 *
 * Variable milestone count (1–8) vs. the old fixed-8 ROC template — empty
 * rows are omitted from the printable table instead of showing dashes.
 */
export function printWorkType(workType: WorkTypeRow): void {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) return;

  const ms = [...workType.milestones].sort((a, b) => a.seq - b.seq);
  const totalWeight = ms.reduce((s, m) => s + m.weight, 0);
  const totalPct = totalWeight * 100;

  let cumulative = 0;
  const rows: string[] = [];
  for (const m of ms) {
    const pct = m.weight * 100;
    cumulative += pct;
    rows.push(`
      <tr>
        <td><strong>M${m.seq}</strong></td>
        <td>${escapeHtml(m.label)}</td>
        <td class="num">${pct.toFixed(2)}%</td>
        <td class="num">${cumulative.toFixed(2)}%</td>
      </tr>`);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Work Type — ${escapeHtml(workType.work_type_code)} — ${escapeHtml(workType.description)}</title>
  <style>
    @page { margin: 0.6in; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 24px;
      font-size: 12pt;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #0369a1;
      padding-bottom: 10px;
      margin-bottom: 18px;
    }
    .doc-title { color: #0369a1; font-size: 9pt; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 700; }
    .doc-code { font-size: 22pt; font-weight: 800; line-height: 1.1; margin-top: 2px; }
    .doc-desc { font-size: 14pt; color: #475569; margin-top: 4px; }
    .doc-meta { text-align: right; font-size: 10pt; color: #64748b; }
    .doc-total { font-size: 24pt; font-weight: 800; color: ${totalPct > 99.5 && totalPct < 100.5 ? '#059669' : '#dc2626'}; line-height: 1; }
    .doc-total-label { font-size: 8pt; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
    }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    th {
      background: #f1f5f9;
      font-size: 9pt;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #475569;
      font-weight: 700;
    }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .footer {
      margin-top: 30px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      font-size: 9pt;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
    .legend {
      background: #f8fafc;
      border-left: 3px solid #0369a1;
      padding: 12px 14px;
      font-size: 10pt;
      color: #475569;
    }
    .legend strong { color: #1e293b; }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <div>
      <div class="doc-title">Work Type / Rules of Credit</div>
      <div class="doc-code">${escapeHtml(workType.work_type_code)}</div>
      <div class="doc-desc">${escapeHtml(workType.description)} · ${escapeHtml(workType.discipline_code)}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-total">${totalPct.toFixed(2)}%</div>
      <div class="doc-total-label">Total weight</div>
      <div style="margin-top: 8px;">v${workType.version}${workType.is_default ? ' · Discipline default' : ''}</div>
      <div>Printed ${new Date().toLocaleDateString()}</div>
    </div>
  </div>

  <div class="legend">
    Each milestone earns its <strong>weight</strong> of the line item's budget hours when reached.
    <strong>Cumulative</strong> shows the percent-to-100 once all prior milestones plus this one are complete.
    Hand this sheet to the foreman so they know exactly what each milestone is worth.
  </div>

  <table style="margin-top: 16px;">
    <thead>
      <tr>
        <th style="width: 50px;">Step</th>
        <th>Milestone</th>
        <th class="num" style="width: 100px;">Weight</th>
        <th class="num" style="width: 110px;">Cumulative</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join('')}
    </tbody>
  </table>

  <div class="footer">
    <div>Invenio ProjectControls</div>
    <div>${escapeHtml(workType.work_type_code)} · ${escapeHtml(workType.description)} · v${workType.version}</div>
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
