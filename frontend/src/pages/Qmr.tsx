import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileBarChart, Calendar } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useProjectStore } from '@/stores/project';
import {
  useCoaCodes,
  useProgressRows,
  useProjectCoaCodes,
  useSnapshots,
  type CoaCodeRow,
  type ProgressRow,
} from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { selectClass } from '@/components/ui/FormField';
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
  period_installed_qty: number;
  budget_hrs: number;
  jtd_earned_hrs: number;
  period_earned_hrs: number;
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
    period_installed_qty: number;
    budget_hrs: number;
    jtd_earned_hrs: number;
    period_earned_hrs: number;
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

type BaselineMap = Map<string, { earned_hrs: number; earned_qty: number; actual_qty: number }>;

function rollUp(
  rows: ProgressRow[],
  codes: CoaCodeRow[],
  inScope: Set<string> | null,
  baseline: BaselineMap | null,
): QmrCraft[] {
  // Index COA codes by code string so we can pick up description + pf_rate
  // for the leaf rows. Skip level-1 prime rows; they're craft headers.
  const codeMap = new Map<string, CoaCodeRow>();
  for (const c of codes) {
    if (c.level === 2) codeMap.set(c.code, c);
  }

  // Lookup-or-create helper so the JTD pass and the baseline subtraction
  // pass share the same leaf shape. Returns null if the row's code is
  // missing / unknown / out of the project's COA scope.
  function getLeaf(r: ProgressRow): QmrLeaf | null {
    const code = (r.code ?? '').trim();
    if (!code) return null;
    const coa = codeMap.get(code);
    if (!coa) return null;
    if (inScope && !inScope.has(coa.id)) return null;
    let leaf = leafByCode.get(code);
    if (!leaf) {
      leaf = {
        code: coa.code,
        description: coa.description,
        uom: coa.uom,
        pf_rate: coa.pf_rate,
        budget_qty: 0,
        jtd_installed_qty: 0,
        period_installed_qty: 0,
        budget_hrs: 0,
        jtd_earned_hrs: 0,
        period_earned_hrs: 0,
        percent_complete: 0,
        record_count: 0,
      };
      leafByCode.set(code, leaf);
    }
    return leaf;
  }

  const leafByCode = new Map<string, QmrLeaf>();

  // Pass 1: JTD totals. Only active records contribute — inactive ones
  // (deleted / retired) shouldn't inflate Σ jtd_earned_hrs.
  for (const r of rows) {
    if (r.status !== 'active') continue;
    const leaf = getLeaf(r);
    if (!leaf) continue;
    leaf.budget_qty += r.budget_qty ?? 0;
    leaf.jtd_installed_qty += r.actual_qty ?? 0;
    leaf.budget_hrs += r.budget_hrs;
    leaf.jtd_earned_hrs += r.earned_hrs;
    leaf.record_count += 1;
    leaf.period_earned_hrs += r.earned_hrs;
    leaf.period_installed_qty += r.actual_qty ?? 0;
  }

  // Pass 2: subtract baseline. Iterate every record that has a baseline
  // entry — active OR inactive. This is the fix for the previous version's
  // bug: records that were active at baseline but are now inactive used to
  // be skipped entirely, leaving their baseline contribution un-subtracted
  // and overstating the period delta. With this pass, an inactive record
  // with 80 baseline hrs contributes -80 to the leaf's period_earned_hrs.
  //
  // Caveat: this attributes baseline values to the record's CURRENT code.
  // If a record was reassigned between codes since baseline, the math nets
  // against the wrong leaf. Tracking historical code per snapshot would
  // require schema changes; for now we accept this limitation since
  // post-baseline code changes are rare in normal operation.
  if (baseline) {
    for (const r of rows) {
      const base = baseline.get(r.id);
      if (!base) continue;
      const leaf = getLeaf(r);
      if (!leaf) continue;
      leaf.period_earned_hrs -= base.earned_hrs;
      leaf.period_installed_qty -= base.actual_qty;
    }
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
        period_installed_qty: acc.period_installed_qty + l.period_installed_qty,
        budget_hrs: acc.budget_hrs + l.budget_hrs,
        jtd_earned_hrs: acc.jtd_earned_hrs + l.jtd_earned_hrs,
        period_earned_hrs: acc.period_earned_hrs + l.period_earned_hrs,
        record_count: acc.record_count + l.record_count,
        percent_complete: 0,
      }),
      {
        budget_qty: 0,
        jtd_installed_qty: 0,
        period_installed_qty: 0,
        budget_hrs: 0,
        jtd_earned_hrs: 0,
        period_earned_hrs: 0,
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
  const snapshots = useSnapshots(projectId);

  // Baseline snapshot for period-over-period math (Sandra's QMR has "Period
  // Installed" / "Period Earned" columns = current - baseline). When null,
  // the period columns hide.
  const [baselineSnapshotId, setBaselineSnapshotId] = useState<string | null>(null);

  const baselineItems = useQuery({
    queryKey: ['qmr-baseline-items', baselineSnapshotId] as const,
    enabled: !!baselineSnapshotId,
    queryFn: async (): Promise<BaselineMap> => {
      const { data, error } = await supabase
        .from('progress_snapshot_items')
        .select('progress_record_id, earned_hrs, earned_qty, actual_qty')
        .eq('snapshot_id', baselineSnapshotId!);
      if (error) throw error;
      const map: BaselineMap = new Map();
      for (const row of (data ?? []) as {
        progress_record_id: string;
        earned_hrs: number | string | null;
        earned_qty: number | string | null;
        actual_qty: number | string | null;
      }[]) {
        map.set(row.progress_record_id, {
          earned_hrs: row.earned_hrs != null ? Number(row.earned_hrs) : 0,
          earned_qty: row.earned_qty != null ? Number(row.earned_qty) : 0,
          actual_qty: row.actual_qty != null ? Number(row.actual_qty) : 0,
        });
      }
      return map;
    },
  });

  const showPeriod = baselineSnapshotId !== null;
  const isLoading =
    codes.isLoading ||
    rows.isLoading ||
    projectCoa.isLoading ||
    snapshots.isLoading ||
    (showPeriod && baselineItems.isLoading);
  const error =
    codes.error ||
    rows.error ||
    projectCoa.error ||
    snapshots.error ||
    baselineItems.error;

  const sortedSnapshots = useMemo(() => {
    return (snapshots.data ?? [])
      .slice()
      .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
  }, [snapshots.data]);

  const crafts = useMemo(() => {
    if (!codes.data || !rows.data) return [];
    const inScope = projectCoa.data && projectCoa.data.size > 0 ? projectCoa.data : null;
    const baseline = showPeriod ? (baselineItems.data ?? null) : null;
    return rollUp(rows.data, codes.data, inScope, baseline);
  }, [codes.data, rows.data, projectCoa.data, baselineItems.data, showPeriod]);

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
      period_installed_qty: acc.period_installed_qty + c.totals.period_installed_qty,
      budget_hrs: acc.budget_hrs + c.totals.budget_hrs,
      jtd_earned_hrs: acc.jtd_earned_hrs + c.totals.jtd_earned_hrs,
      period_earned_hrs: acc.period_earned_hrs + c.totals.period_earned_hrs,
      record_count: acc.record_count + c.totals.record_count,
    }),
    {
      budget_qty: 0,
      jtd_installed_qty: 0,
      period_installed_qty: 0,
      budget_hrs: 0,
      jtd_earned_hrs: 0,
      period_earned_hrs: 0,
      record_count: 0,
    },
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
      ...(showPeriod ? ['Period Installed Qty'] : []),
      'Budget Hrs',
      'JTD Earned Hrs',
      ...(showPeriod ? ['Period Earned Hrs'] : []),
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
          ...(showPeriod ? [leaf.period_installed_qty.toFixed(2)] : []),
          leaf.budget_hrs.toFixed(0),
          leaf.jtd_earned_hrs.toFixed(0),
          ...(showPeriod ? [leaf.period_earned_hrs.toFixed(0)] : []),
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
        ...(showPeriod ? [craft.totals.period_installed_qty.toFixed(2)] : []),
        craft.totals.budget_hrs.toFixed(0),
        craft.totals.jtd_earned_hrs.toFixed(0),
        ...(showPeriod ? [craft.totals.period_earned_hrs.toFixed(0)] : []),
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
      ...(showPeriod ? [grandTotals.period_installed_qty.toFixed(2)] : []),
      grandTotals.budget_hrs.toFixed(0),
      grandTotals.jtd_earned_hrs.toFixed(0),
      ...(showPeriod ? [grandTotals.period_earned_hrs.toFixed(0)] : []),
      String(grandTotals.record_count),
    ]);
    downloadCsv(`qmr-report-${date}.csv`, headers, data);
  };

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
              rate from the COA library. Pick a baseline snapshot to fill in the
              Period columns (current − snapshot).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </Button>
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Calendar size={14} className="text-[color:var(--color-text-muted)]" />
          <span className="is-eyebrow">Baseline snapshot</span>
          <select
            aria-label="Baseline snapshot for period delta"
            className={selectClass}
            value={baselineSnapshotId ?? ''}
            onChange={(e) => setBaselineSnapshotId(e.target.value || null)}
          >
            <option value="">— none (JTD only) —</option>
            {sortedSnapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.snapshot_date} — {s.label}
              </option>
            ))}
          </select>
          {baselineSnapshotId && (
            <Button variant="ghost" size="sm" onClick={() => setBaselineSnapshotId(null)}>
              Clear baseline
            </Button>
          )}
          {sortedSnapshots.length === 0 && (
            <span className="text-xs text-[color:var(--color-text-muted)]">
              No snapshots yet — upload progress data to create one.
            </span>
          )}
        </div>
      </Card>

      {crafts.length === 0 ? (
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
      ) : (
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
                  {showPeriod && (
                    <th style={{ textAlign: 'right' }}>Period Installed</th>
                  )}
                  <th style={{ textAlign: 'right' }}>Budget Hrs</th>
                  <th style={{ textAlign: 'right' }}>JTD Earned Hrs</th>
                  {showPeriod && (
                    <th style={{ textAlign: 'right' }}>Period Earned Hrs</th>
                  )}
                  <th style={{ textAlign: 'right' }}>Records</th>
                </tr>
              </thead>
              <tbody>
                {crafts.map((craft) => (
                  <CraftBlock key={craft.prime} craft={craft} showPeriod={showPeriod} />
                ))}
                <tr style={{ background: 'var(--color-primary-soft)' }}>
                  <td className="font-bold" colSpan={3}>
                    PROJECT TOTAL
                  </td>
                  <td className="text-right font-mono font-bold">{grandPct.toFixed(2)}%</td>
                  <td></td>
                  <td className="text-right font-mono font-bold">
                    {fmt.int(grandTotals.budget_qty)}
                  </td>
                  <td className="text-right font-mono font-bold">
                    {fmt.int(grandTotals.jtd_installed_qty)}
                  </td>
                  {showPeriod && (
                    <td className="text-right font-mono font-bold">
                      {fmt.int(grandTotals.period_installed_qty)}
                    </td>
                  )}
                  <td className="text-right font-mono font-bold">
                    {fmt.int(grandTotals.budget_hrs)}
                  </td>
                  <td className="text-right font-mono font-bold">
                    {fmt.int(grandTotals.jtd_earned_hrs)}
                  </td>
                  {showPeriod && (
                    <td className="text-right font-mono font-bold">
                      {fmt.int(grandTotals.period_earned_hrs)}
                    </td>
                  )}
                  <td className="text-right font-mono font-bold">{grandTotals.record_count}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CraftBlock({ craft, showPeriod }: { craft: QmrCraft; showPeriod: boolean }) {
  const headerColspan = showPeriod ? 12 : 10;
  return (
    <>
      <tr style={{ background: 'var(--color-raised)' }}>
        <td className="font-bold uppercase tracking-wide text-[11px]" colSpan={headerColspan}>
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
          {showPeriod && (
            <td className="text-right font-mono">
              {leaf.period_installed_qty > 0 ? '+' : ''}
              {fmt.int(leaf.period_installed_qty)}
            </td>
          )}
          <td className="text-right font-mono">{fmt.int(leaf.budget_hrs)}</td>
          <td className="text-right font-mono">{fmt.int(leaf.jtd_earned_hrs)}</td>
          {showPeriod && (
            <td className="text-right font-mono">
              {leaf.period_earned_hrs > 0 ? '+' : ''}
              {fmt.int(leaf.period_earned_hrs)}
            </td>
          )}
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
        <td className="text-right font-mono font-semibold">
          {fmt.int(craft.totals.jtd_installed_qty)}
        </td>
        {showPeriod && (
          <td className="text-right font-mono font-semibold">
            {craft.totals.period_installed_qty > 0 ? '+' : ''}
            {fmt.int(craft.totals.period_installed_qty)}
          </td>
        )}
        <td className="text-right font-mono font-semibold">{fmt.int(craft.totals.budget_hrs)}</td>
        <td className="text-right font-mono font-semibold">
          {fmt.int(craft.totals.jtd_earned_hrs)}
        </td>
        {showPeriod && (
          <td className="text-right font-mono font-semibold">
            {craft.totals.period_earned_hrs > 0 ? '+' : ''}
            {fmt.int(craft.totals.period_earned_hrs)}
          </td>
        )}
        <td className="text-right font-mono font-semibold">{craft.totals.record_count}</td>
      </tr>
    </>
  );
}
