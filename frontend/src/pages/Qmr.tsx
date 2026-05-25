import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileBarChart, Maximize2 } from 'lucide-react';
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
import { downloadCsv } from '@/lib/export';
import type { QmrCraft, QmrLeaf, QmrTotals } from '@/lib/qmrTypes';
import { QmrFilterPanel } from '@/components/qmr/QmrFilterPanel';
import { QmrTable } from '@/components/qmr/QmrTable';
import { Modal } from '@/components/ui/Modal';

// Per-craft, per-code rollup matching the column layout of Sandra's
// 9999.pdf QMR (Quantity Work-Hour Summary Report). Auto-calculated
// from the project's progress_records — as milestones tick, rows
// refresh.
//
// Wave E replaces the previous "JTD + period delta" layout with the
// industry-standard QMR columns: Curr Est Qty / Earned Qty / Installed
// Qty / Rem Qty, and Curr Est Hrs / Spent Hrs / Earned Hrs / Rem Hrs,
// plus two productivity ratios (Cur U/R and Act/Ern U/R). The period
// delta machinery is removed; it can come back as a separate report
// if needed.

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
        earned_qty: 0,
        installed_qty: 0,
        budget_hrs: 0,
        spent_hrs: 0,
        earned_hrs: 0,
        percent_complete: 0,
        record_count: 0,
      };
      leafByCode.set(code, leaf);
    }
    return leaf;
  }

  const leafByCode = new Map<string, QmrLeaf>();

  // Single-pass JTD aggregation. Only active records contribute; inactive
  // (deleted / retired) shouldn't inflate the totals.
  for (const r of rows) {
    if (r.status !== 'active') continue;
    const leaf = getLeaf(r);
    if (!leaf) continue;
    leaf.budget_qty += r.budget_qty ?? 0;
    leaf.earned_qty += r.earned_qty ?? 0;
    leaf.installed_qty += r.actual_qty ?? 0;
    leaf.budget_hrs += r.budget_hrs;
    leaf.spent_hrs += r.actual_hrs;
    leaf.earned_hrs += r.earned_hrs;
    leaf.record_count += 1;
  }

  for (const leaf of leafByCode.values()) {
    leaf.percent_complete =
      leaf.budget_hrs > 0 ? (leaf.earned_hrs / leaf.budget_hrs) * 100 : 0;
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
    const totals = leaves.reduce<QmrTotals>(
      (acc, l) => ({
        budget_qty: acc.budget_qty + l.budget_qty,
        earned_qty: acc.earned_qty + l.earned_qty,
        installed_qty: acc.installed_qty + l.installed_qty,
        budget_hrs: acc.budget_hrs + l.budget_hrs,
        spent_hrs: acc.spent_hrs + l.spent_hrs,
        earned_hrs: acc.earned_hrs + l.earned_hrs,
        record_count: acc.record_count + l.record_count,
        percent_complete: 0,
      }),
      {
        budget_qty: 0,
        earned_qty: 0,
        installed_qty: 0,
        budget_hrs: 0,
        spent_hrs: 0,
        earned_hrs: 0,
        percent_complete: 0,
        record_count: 0,
      },
    );
    totals.percent_complete =
      totals.budget_hrs > 0 ? (totals.earned_hrs / totals.budget_hrs) * 100 : 0;
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

  // A8 — craft + description checkbox filters per Sandra's UAT. An empty
  // selection means "show all" so the default view is unfiltered; the
  // moment the user ticks anything the table narrows to that set. Both
  // axes compose: unchecking Civil hides the whole craft group; unchecking
  // a specific code row hides it across every craft.
  //
  // descriptionFilter keys on the COA *code* (which the schema enforces
  // unique per tenant) rather than the description string. COA does NOT
  // enforce unique descriptions, so two codes that share a description
  // (e.g. "General" appearing under multiple primes) would otherwise
  // collapse in the dropdown and silently affect both rows. The dropdown
  // labels still surface the description so the user can scan by name.
  const [craftFilter, setCraftFilter] = useState<Set<string>>(() => new Set());
  const [descriptionFilter, setDescriptionFilter] = useState<Set<string>>(() => new Set());
  const [tableExpanded, setTableExpanded] = useState(false);

  // Reset filters when the user switches projects — the previous project's
  // craft codes don't match the new one's, so leaving filters set would
  // either zero the table out or surface a "no rows match" dead-end the
  // user can't recover from if the filter UI is hidden (which happens
  // when the new project has no data yet).
  useEffect(() => {
    setCraftFilter(new Set());
    setDescriptionFilter(new Set());
  }, [projectId]);

  // Wave E — project meta drives the print-only header that anchors the
  // PDF. Without this the export reads as a styled-but-anonymous dump
  // and a client receiving it doesn't know which job it represents.
  const project = useQuery({
    queryKey: ['project-meta', projectId] as const,
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('project_code, name, client')
        .eq('id', projectId!)
        .maybeSingle();
      if (error) throw error;
      return data as { project_code: string; name: string; client: string | null } | null;
    },
  });

  const isLoading =
    codes.isLoading ||
    rows.isLoading ||
    projectCoa.isLoading ||
    snapshots.isLoading;
  const error = codes.error || rows.error || projectCoa.error || snapshots.error;

  // Latest snapshot drives the W/E date stamped on the printed header.
  // Falls back to today's date if there are no snapshots yet.
  const latestSnapshot = useMemo(() => {
    const list = (snapshots.data ?? []).slice();
    list.sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
    return list[0] ?? null;
  }, [snapshots.data]);

  const allCrafts = useMemo(() => {
    if (!codes.data || !rows.data) return [];
    const inScope = projectCoa.data && projectCoa.data.size > 0 ? projectCoa.data : null;
    return rollUp(rows.data, codes.data, inScope);
  }, [codes.data, rows.data, projectCoa.data]);

  // Filter options come from the unfiltered rollup so the dropdowns
  // always list every craft + description, even when a filter is active.
  // (Otherwise the filter would erase its own options once applied.)
  const craftOptions = useMemo(
    () => allCrafts.map((c) => ({ value: c.prime, label: c.display_name })),
    [allCrafts],
  );
  const descriptionOptions = useMemo(() => {
    // Key on code (unique per tenant) so two codes that happen to share
    // a description don't collapse into a single filter entry. Label
    // keeps the description so the user can scan by name.
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const craft of allCrafts) {
      for (const leaf of craft.leaves) {
        if (seen.has(leaf.code)) continue;
        seen.add(leaf.code);
        out.push({ value: leaf.code, label: `${leaf.code} — ${leaf.description}` });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [allCrafts]);

  // Apply the two filter axes + recompute craft totals from the surviving
  // leaves. Crafts with zero leaves after filtering disappear entirely so
  // the rendered table stays readable.
  const crafts = useMemo(() => {
    if (craftFilter.size === 0 && descriptionFilter.size === 0) return allCrafts;
    const filtered: QmrCraft[] = [];
    for (const craft of allCrafts) {
      if (craftFilter.size > 0 && !craftFilter.has(craft.prime)) continue;
      const leaves =
        descriptionFilter.size === 0
          ? craft.leaves
          : craft.leaves.filter((l) => descriptionFilter.has(l.code));
      if (leaves.length === 0) continue;
      const totals = leaves.reduce<QmrTotals>(
        (acc, l) => ({
          budget_qty: acc.budget_qty + l.budget_qty,
          earned_qty: acc.earned_qty + l.earned_qty,
          installed_qty: acc.installed_qty + l.installed_qty,
          budget_hrs: acc.budget_hrs + l.budget_hrs,
          spent_hrs: acc.spent_hrs + l.spent_hrs,
          earned_hrs: acc.earned_hrs + l.earned_hrs,
          // Recompute % complete from the filtered hours so the subtotal
          // reflects only the rows the user kept; a fresh roll-up rather
          // than re-using craft.totals.percent_complete from the unfiltered set.
          percent_complete: 0,
          record_count: acc.record_count + l.record_count,
        }),
        {
          budget_qty: 0,
          earned_qty: 0,
          installed_qty: 0,
          budget_hrs: 0,
          spent_hrs: 0,
          earned_hrs: 0,
          percent_complete: 0,
          record_count: 0,
        },
      );
      totals.percent_complete =
        totals.budget_hrs > 0 ? (totals.earned_hrs / totals.budget_hrs) * 100 : 0;
      filtered.push({
        prime: craft.prime,
        display_name: craft.display_name,
        leaves,
        totals,
      });
    }
    return filtered;
  }, [allCrafts, craftFilter, descriptionFilter]);

  const filtersActive = craftFilter.size > 0 || descriptionFilter.size > 0;
  const clearFilters = () => {
    setCraftFilter(new Set());
    setDescriptionFilter(new Set());
  };

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

  const grandTotals = crafts.reduce<QmrTotals>(
    (acc, c) => ({
      budget_qty: acc.budget_qty + c.totals.budget_qty,
      earned_qty: acc.earned_qty + c.totals.earned_qty,
      installed_qty: acc.installed_qty + c.totals.installed_qty,
      budget_hrs: acc.budget_hrs + c.totals.budget_hrs,
      spent_hrs: acc.spent_hrs + c.totals.spent_hrs,
      earned_hrs: acc.earned_hrs + c.totals.earned_hrs,
      percent_complete: 0,
      record_count: acc.record_count + c.totals.record_count,
    }),
    {
      budget_qty: 0,
      earned_qty: 0,
      installed_qty: 0,
      budget_hrs: 0,
      spent_hrs: 0,
      earned_hrs: 0,
      percent_complete: 0,
      record_count: 0,
    },
  );
  const grandPct =
    grandTotals.budget_hrs > 0
      ? (grandTotals.earned_hrs / grandTotals.budget_hrs) * 100
      : 0;

  const exportCsv = () => {
    const date = new Date().toISOString().slice(0, 10);
    // A21 — the QMR CSV is the client-facing export. Per Sandra's UAT
    // ("anything that says U/R needs to be deleted… all they're going
    // to do is beat us up over it"), the productivity-factor unit rate
    // column is stripped here. The on-screen QMR table keeps U/R for
    // internal review; only the export drops it. If we ever add an
    // internal-only QMR export, branch the header list on that.
    const headers = [
      'Craft',
      'Code',
      'Description',
      'UM',
      '% Complete',
      'Budget Qty',
      'Earned Qty',
      'Installed Qty',
      'Remaining Qty',
      'Budget Hrs',
      'Spent Hrs',
      'Earned Hrs',
      'Remaining Hrs',
      'Records',
    ];
    const remQty = (budget: number, earned: number) => Math.max(0, budget - earned);
    const remHrs = (budget: number, earned: number) => Math.max(0, budget - earned);
    const data: string[][] = [];
    for (const craft of crafts) {
      for (const leaf of craft.leaves) {
        data.push([
          craft.display_name,
          leaf.code,
          leaf.description,
          leaf.uom,
          leaf.percent_complete.toFixed(2),
          leaf.budget_qty.toFixed(2),
          leaf.earned_qty.toFixed(2),
          leaf.installed_qty.toFixed(2),
          remQty(leaf.budget_qty, leaf.earned_qty).toFixed(2),
          leaf.budget_hrs.toFixed(0),
          leaf.spent_hrs.toFixed(0),
          leaf.earned_hrs.toFixed(0),
          remHrs(leaf.budget_hrs, leaf.earned_hrs).toFixed(0),
          String(leaf.record_count),
        ]);
      }
      data.push([
        `${craft.display_name} TOTAL`,
        '',
        '',
        '',
        craft.totals.percent_complete.toFixed(2),
        craft.totals.budget_qty.toFixed(2),
        craft.totals.earned_qty.toFixed(2),
        craft.totals.installed_qty.toFixed(2),
        remQty(craft.totals.budget_qty, craft.totals.earned_qty).toFixed(2),
        craft.totals.budget_hrs.toFixed(0),
        craft.totals.spent_hrs.toFixed(0),
        craft.totals.earned_hrs.toFixed(0),
        remHrs(craft.totals.budget_hrs, craft.totals.earned_hrs).toFixed(0),
        String(craft.totals.record_count),
      ]);
    }
    data.push([
      'PROJECT TOTAL',
      '',
      '',
      '',
      grandPct.toFixed(2),
      grandTotals.budget_qty.toFixed(2),
      grandTotals.earned_qty.toFixed(2),
      grandTotals.installed_qty.toFixed(2),
      remQty(grandTotals.budget_qty, grandTotals.earned_qty).toFixed(2),
      grandTotals.budget_hrs.toFixed(0),
      grandTotals.spent_hrs.toFixed(0),
      grandTotals.earned_hrs.toFixed(0),
      remHrs(grandTotals.budget_hrs, grandTotals.earned_hrs).toFixed(0),
      String(grandTotals.record_count),
    ]);
    downloadCsv(`qmr-report-${date}.csv`, headers, data);
  };

  const weekEndingLabel = latestSnapshot?.week_ending
    ? new Date(latestSnapshot.week_ending).toLocaleDateString()
    : latestSnapshot?.snapshot_date
      ? new Date(latestSnapshot.snapshot_date).toLocaleDateString()
      : new Date().toLocaleDateString();

  return (
    <div className="is-qmr-page space-y-4">
      {/* Wave E — print-only header so the PDF carries its own context
          (Sandra's 9999.pdf style). Hidden on screen. */}
      <div className="is-print-only is-print-header">
        <div className="is-print-title">QUANTITY WORK-HOUR SUMMARY REPORT</div>
        <div className="is-print-subtitle">
          Project: <strong>{project.data?.name ?? '—'}</strong>
          {project.data?.project_code ? ` · ${project.data.project_code}` : ''}
          {project.data?.client ? ` · Client: ${project.data.client}` : ''}
          {' · W/E '}
          {weekEndingLabel}
          {' · Generated '}
          {new Date().toLocaleString()}
        </div>
        <div className="is-print-subtitle mt-1">
          Subcontract spent hours are not included. Numbers reflect approved
          change orders only — pending COs not included.
        </div>
      </div>

      <Card className="is-no-print">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="is-eyebrow mb-1">Quantity Work-Hour Summary Report</div>
            <h2 className="text-base font-semibold">Per-craft progress rollup</h2>
            <p className="text-xs text-[color:var(--color-text-muted)] mt-1 max-w-2xl">
              Auto-calculated from active progress records grouped by COA code.
              % Complete is hours-weighted (Σ Earned ÷ Σ Budget). Use the side
              panel to toggle crafts and account codes. Scroll horizontally or
              open the full table view for all columns. PDF includes every column
              in the table; CSV export omits Cur U/R and Act/Ern U/R.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              disabled={crafts.length === 0}
              onClick={() => setTableExpanded(true)}
              title="Open the QMR table in a wide scrollable window with all columns visible."
            >
              <Maximize2 size={14} /> Full table
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={project.isLoading || crafts.length === 0}
              onClick={() => window.print()}
              title="Landscape PDF with all table columns, including Cur U/R and Act/Ern U/R."
            >
              <Download size={14} /> Export PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download size={14} /> Export CSV
            </Button>
          </div>
        </div>
      </Card>

      {allCrafts.length === 0 ? (
        <div className="is-surface is-empty">
          <div className="is-empty-icon">
            <FileBarChart size={28} />
          </div>
          <div className="is-empty-title">No QMR data yet</div>
          <p className="is-empty-caption">
            Once progress records are tagged with COA codes (via upload or the New Record modal)
            they&apos;ll roll up here automatically. Records with unrecognised codes are dropped —
            fix the code or add it on the COA page to include them.
          </p>
        </div>
      ) : (
        <div className="flex gap-4 items-start">
          {crafts.length === 0 ? (
            <div className="is-surface is-empty flex-1 min-w-0">
              <div className="is-empty-icon">
                <FileBarChart size={28} />
              </div>
              <div className="is-empty-title">No rows match the current filters</div>
              <p className="is-empty-caption">
                Loosen the craft or description checkboxes on the right, or clear them entirely.
              </p>
            </div>
          ) : (
            <div className="is-surface overflow-hidden flex-1 min-w-0 is-qmr-table-panel">
              <QmrTable crafts={crafts} grandTotals={grandTotals} grandPct={grandPct} />
            </div>
          )}

          <QmrFilterPanel
            craftOptions={craftOptions}
            descriptionOptions={descriptionOptions}
            craftFilter={craftFilter}
            descriptionFilter={descriptionFilter}
            onCraftChange={setCraftFilter}
            onDescriptionChange={setDescriptionFilter}
            onClear={clearFilters}
            filtersActive={filtersActive}
            visibleCraftCount={crafts.length}
            totalCraftCount={allCrafts.length}
          />
        </div>
      )}

      <Modal
        open={tableExpanded}
        onClose={() => setTableExpanded(false)}
        title="QMR table — full view"
        caption="All columns with horizontal scroll. Export PDF from the main page to include every column."
        width={1600}
      >
        <div className="is-qmr-expanded">
          <QmrTable
            crafts={crafts}
            grandTotals={grandTotals}
            grandPct={grandPct}
            scrollClassName="is-qmr-scroll-expanded"
          />
        </div>
      </Modal>

      {/* Print-only footer note — mirrors Sandra's 9999.pdf "Notes" block. */}
      <div className="is-print-only is-print-footer">
        <strong>Notes:</strong> 1) All quantities are job-to-date (JTD).
        2) Quantities do not reflect forecast or pending change orders.
        3) Subcontract spent hours are not included on this report.
      </div>
    </div>
  );
}
