/**
 * Take-off rounding rule per Jerry (2026-05-05): round up at the IWP-total
 * level, not per row. Per-row rounding accumulates error; rounding the
 * summed inches per IWP up to the next foot avoids it.
 *
 * Inputs are linear-measure rows tagged by IWP. Output is one row per
 * distinct IWP with its total quantity in feet (ceil of sum÷12).
 *
 * Rows missing iwp_id are skipped — quantity unbucketed by IWP can't be
 * rounded against an IWP boundary, so the caller must decide how to
 * handle them.
 */

export type TakeoffRow = {
  iwp_id: string;
  quantity_inches: number;
};

export type IwpTotal = {
  iwp_id: string;
  quantity_feet: number;
};

export function roundUpAtIwpTotal(rows: TakeoffRow[]): IwpTotal[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    if (!r.iwp_id) continue;
    sums.set(r.iwp_id, (sums.get(r.iwp_id) ?? 0) + r.quantity_inches);
  }
  return Array.from(sums.entries())
    .map(([iwp_id, totalInches]) => ({
      iwp_id,
      quantity_feet: Math.ceil(totalInches / 12),
    }))
    .sort((a, b) => a.iwp_id.localeCompare(b.iwp_id));
}
