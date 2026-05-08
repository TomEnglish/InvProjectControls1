import { useMemo } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import {
  useCoaCodes,
  useProgressRows,
  useProjectCoaCodes,
  type CoaCodeRow,
  type ProgressRow,
} from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { fmt } from '@/lib/format';
import { downloadCsv } from '@/lib/export';

// Per-craft, per-code rollup mirroring the format of Sandra's
// QMR Report.xlsx (ProgressDocs/NewPage/). Auto-calculated from the
// project's progress_records — as new milestones tick the rows refresh.

type QmrLeaf = {
  code: string;
  description: string;
  uom: string;
  pf_rate: number;
  budget_qty: number;
  jtd_installed_qty: number;
  budget_hrs: number;
  jtd_earned_hrs: number;
  percent_complete: number;
  record_count: number;
};

type QmrCraft = {
  prime: string;
  display_name: string;
  leaves: QmrLeaf[];
  totals: {
    budget_qty: number;
    jtd_installed_qty: number;
    budget_hrs: number;
    jtd_earned_hrs: number;
    percent_complete: number;
    record_count: number;
  };
};

const PRIME_DISPLAY: Record<string, string> = {
  '01': 'Sitework',
  '04': 'Civil',
  '05': 'Iron / Structural Steel',
  '07': 'Mechanical',
  '08': 'Pipe',
  '09': 'Electrical',
  '10': 'Instrumentation',
};

function rollUp(
  rows: ProgressRow[],
  codes: CoaCodeRow[],
  inScope: Set<string> | null,
): QmrCraft[] {
  // Index COA codes by code string so we can pick up description + pf_rate
  // for the leaf rows. Skip level-1 prime rows; they're craft headers.
  const codeMap = new Map<string, CoaCodeRow>();
  for (const c of codes) {
    if (c.level === 2) codeMap.set(c.code, c);
  }

  const leafByCode = new Map<string, QmrLeaf>();
  for (const r of rows) {
    if (r.status !== 'active') continue;
    const code = (r.code ?? '').trim();
    if (!code) continue;
    const coa = codeMap.get(code);
    if (!coa) continue; // orphan / unknown — drop until admin reconciles
    if (inScope && !inScope.has(coa.id)) continue;

    let leaf = leafByCode.get(code);
    if (!leaf) {
      leaf = {
        code: coa.code,
        description: coa.description,
        uom: coa.uom,
        pf_rate: coa.pf_rate,
        budget_qty: 0,
        jtd_installed_qty: 0,
        budget_hrs: 0,
        jtd_earned_hrs: 0,
        percent_complete: 0,
        record_count: 0,
      };
      leafByCode.set(code, leaf);
    }
    leaf.budget_qty += r.budget_qty ?? 0;
    leaf.jtd_installed_qty += r.actual_qty ?? 0;
    leaf.budget_hrs += r.budget_hrs;
    leaf.jtd_earned_hrs += r.earned_hrs;
    leaf.record_count += 1;
  }

  for (const leaf of leafByCode.values()) {
    leaf.percent_complete =
      leaf.budget_hrs > 0 ? (leaf.jtd_earned_hrs / leaf.budget_hrs) * 100 : 0;
  }

  // Group leaves by prime (first 2 characters of the code).
  const byPrime = new Map<string, QmrLeaf[]>();
  for (const leaf of leafByCode.values()) {
    const prime = leaf.code.slice(0, 2);
    const arr = byPrime.get(prime) ?? [];
    arr.push(leaf);
    byPrime.set(prime, arr);
  }

  const crafts: QmrCraft[] = [];
  for (const [prime, leaves] of byPrime) {
    leaves.sort((a, b) => a.code.localeCompare(b.code));
    const totals = leaves.reduce(
      (acc, l) => ({
        budget_qty: acc.budget_qty + l.budget_qty,
        jtd_installed_qty: acc.jtd_installed_qty + l.jtd_installed_qty,
        budget_hrs: acc.budget_hrs + l.budget_hrs,
        jtd_earned_hrs: acc.jtd_earned_hrs + l.jtd_earned_hrs,
        record_count: acc.record_count + l.record_count,
        percent_complete: 0,
      }),
      {
        budget_qty: 0,
        jtd_installed_qty: 0,
        budget_hrs: 0,
        jtd_earned_hrs: 0,
        percent_complete: 0,
        record_count: 0,
      },
    );
    totals.percent_complete =
      totals.budget_hrs > 0 ? (totals.jtd_earned_hrs / totals.budget_hrs) * 100 : 0;
    crafts.push({
      prime,
      display_name: PRIME_DISPLAY[prime] ?? `Prime ${prime}`,
      leaves,
      totals,
    });
  }
  crafts.sort((a, b) => a.prime.localeCompare(b.prime));
  return crafts;
}

function NoProject() {
  return (
    <div className="is-surface is-empty">
      <div className="is-empty-icon">
        <FileBarChart size={28} />
      </div>
      <div className="is-empty-title">No project selected</div>
      <p className="is-empty-caption">
        Pick a project in the top bar to view the QMR report.
      </p>
    </div>
  );
}

export function QmrPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const codes = useCoaCodes();
  const rows = useProgressRows(projectId);
  const projectCoa = useProjectCoaCodes(projectId);

  const isLoading = codes.isLoading || rows.isLoading || projectCoa.isLoading;
  const error = codes.error || rows.error || projectCoa.error;

  const crafts = useMemo(() => {
    if (!codes.data || !rows.data) return [];
    // If the project has explicitly picked a code subset, honour it; otherwise
    // (no picks made yet) show every code that has progress against it.
    const inScope = projectCoa.data && projectCoa.data.size > 0 ? projectCoa.data : null;
    return rollUp(rows.data, codes.data, inScope);
  }, [codes.data, rows.data, projectCoa.data]);

  if (!projectId) return <NoProject />;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <div className="is-skeleton mb-3" style={{ width: 220 }} />
          <div className="is-skeleton" style={{ height: 360, width: '100%' }} />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="is-toast is-toast-danger">
        Failed to load QMR data: {(error as Error).message}
      </div>
    );
  }

  const grandTotals = crafts.reduce(
    (acc, c) => ({
      budget_qty: acc.budget_qty + c.totals.budget_qty,
      jtd_installed_qty: acc.jtd_installed_qty + c.totals.jtd_installed_qty,
      budget_hrs: acc.budget_hrs + c.totals.budget_hrs,
      jtd_earned_hrs: acc.jtd_earned_hrs + c.totals.jtd_earned_hrs,
      record_count: acc.record_count + c.totals.record_count,
    }),
    { budget_qty: 0, jtd_installed_qty: 0, budget_hrs: 0, jtd_earned_hrs: 0, record_count: 0 },
  );
  const grandPct =
    grandTotals.budget_hrs > 0
      ? (grandTotals.jtd_earned_hrs / grandTotals.budget_hrs) * 100
      : 0;

  const exportCsv = () => {
    const date = new Date().toISOString().slice(0, 10);
    const headers = [
      'Craft',
      'Code',
      'Description',
      'UOM',
      '% Complete',
      'U/R (PF)',
      'Budget Qty',
      'JTD Installed Qty',
      'Budget Hrs',
      'JTD Earned Hrs',
      'Records',
    ];
    const data: string[][] = [];
    for (const craft of crafts) {
      for (const leaf of craft.leaves) {
        data.push([
          craft.display_name,
          leaf.code,
          leaf.description,
          leaf.uom,
          leaf.percent_complete.toFixed(2),
          leaf.pf_rate.toFixed(4),
          leaf.budget_qty.toFixed(2),
          leaf.jtd_installed_qty.toFixed(2),
          leaf.budget_hrs.toFixed(0),
          leaf.jtd_earned_hrs.toFixed(0),
          String(leaf.record_count),
        ]);
      }
      data.push([
        `${craft.display_name} TOTAL`,
        '',
        '',
        '',
        craft.totals.percent_complete.toFixed(2),
        '',
        craft.totals.budget_qty.toFixed(2),
        craft.totals.jtd_installed_qty.toFixed(2),
        craft.totals.budget_hrs.toFixed(0),
        craft.totals.jtd_earned_hrs.toFixed(0),
        String(craft.totals.record_count),
      ]);
    }
    data.push([
      'PROJECT TOTAL',
      '',
      '',
      '',
      grandPct.toFixed(2),
      '',
      grandTotals.budget_qty.toFixed(2),
      grandTotals.jtd_installed_qty.toFixed(2),
      grandTotals.budget_hrs.toFixed(0),
      grandTotals.jtd_earned_hrs.toFixed(0),
      String(grandTotals.record_count),
    ]);
    downloadCsv(`qmr-report-${date}.csv`, headers, data);
  };

  if (crafts.length === 0) {
    return (
      <div className="is-surface is-empty">
        <div className="is-empty-icon">
          <FileBarChart size={28} />
        </div>
        <div className="is-empty-title">No QMR data yet</div>
        <p className="is-empty-caption">
          Once progress records are tagged with COA codes (via upload or the
          New Record modal) they'll roll up here automatically. Records with
          unrecognised codes are dropped — fix the code or add it on the
          COA page to include them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="is-eyebrow mb-1">Quarterly Management Review</div>
            <h2 className="text-base font-semibold">Per-craft progress rollup</h2>
            <p className="text-xs text-[color:var(--color-text-muted)] mt-1 max-w-2xl">
              Auto-calculated from active progress records grouped by COA code. % Complete
              is hours-weighted (Σearned hrs ÷ Σbudget hrs); U/R is the productivity-factor-adjusted
              rate from the COA library. Period-over-period deltas come from snapshots
              once they're available.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </Button>
        </div>
      </Card>

      <div className="is-surface overflow-hidden">
        <div style={{ overflow: 'visible' }}>
          <table className="is-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 80 }}>Code</th>
                <th>Description</th>
                <th>UOM</th>
                <th style={{ textAlign: 'right' }}>% Complete</th>
                <th style={{ textAlign: 'right' }}>U/R</th>
                <th style={{ textAlign: 'right' }}>Budget Qty</th>
                <th style={{ textAlign: 'right' }}>JTD Installed</th>
                <th style={{ textAlign: 'right' }}>Budget Hrs</th>
                <th style={{ textAlign: 'right' }}>JTD Earned Hrs</th>
                <th style={{ textAlign: 'right' }}>Records</th>
              </tr>
            </thead>
            <tbody>
              {crafts.map((craft) => (
                <CraftBlock key={craft.prime} craft={craft} />
              ))}
              <tr style={{ background: 'var(--color-primary-soft)' }}>
                <td className="font-bold" colSpan={3}>
                  PROJECT TOTAL
                </td>
                <td className="text-right font-mono font-bold">{grandPct.toFixed(2)}%</td>
                <td></td>
                <td className="text-right font-mono font-bold">{fmt.int(grandTotals.budget_qty)}</td>
                <td className="text-right font-mono font-bold">{fmt.int(grandTotals.jtd_installed_qty)}</td>
                <td className="text-right font-mono font-bold">{fmt.int(grandTotals.budget_hrs)}</td>
                <td className="text-right font-mono font-bold">{fmt.int(grandTotals.jtd_earned_hrs)}</td>
                <td className="text-right font-mono font-bold">{grandTotals.record_count}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CraftBlock({ craft }: { craft: QmrCraft }) {
  return (
    <>
      <tr style={{ background: 'var(--color-raised)' }}>
        <td className="font-bold uppercase tracking-wide text-[11px]" colSpan={10}>
          {craft.display_name} ({craft.prime})
        </td>
      </tr>
      {craft.leaves.map((leaf) => (
        <tr key={leaf.code}>
          <td className="font-mono">{leaf.code}</td>
          <td>{leaf.description}</td>
          <td>{leaf.uom}</td>
          <td className="text-right font-mono">{leaf.percent_complete.toFixed(1)}%</td>
          <td className="text-right font-mono">{leaf.pf_rate.toFixed(4)}</td>
          <td className="text-right font-mono">{fmt.int(leaf.budget_qty)}</td>
          <td className="text-right font-mono">{fmt.int(leaf.jtd_installed_qty)}</td>
          <td className="text-right font-mono">{fmt.int(leaf.budget_hrs)}</td>
          <td className="text-right font-mono">{fmt.int(leaf.jtd_earned_hrs)}</td>
          <td className="text-right font-mono">{leaf.record_count}</td>
        </tr>
      ))}
      <tr style={{ background: 'var(--color-surface)' }}>
        <td className="font-semibold" colSpan={3}>
          {craft.display_name} subtotal
        </td>
        <td className="text-right font-mono font-semibold">
          {craft.totals.percent_complete.toFixed(1)}%
        </td>
        <td></td>
        <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.budget_qty)}</td>
        <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.jtd_installed_qty)}</td>
        <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.budget_hrs)}</td>
        <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.jtd_earned_hrs)}</td>
        <td className="text-right font-mono font-semibold">{craft.totals.record_count}</td>
      </tr>
    </>
  );
}
