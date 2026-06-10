const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const threeDp = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const fourDp = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const pct = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export const fmt = {
  int(n: number | null | undefined) {
    if (n == null) return '—';
    return intFmt.format(n);
  },
  oneDp(n: number | null | undefined) {
    if (n == null) return '—';
    return oneDp.format(n);
  },
  ratio(n: number | null | undefined) {
    if (n == null) return '—';
    return threeDp.format(n);
  },
  /** Accepts a fraction (0.391) and renders as "39.1%". */
  pct(n: number | null | undefined) {
    if (n == null) return '—';
    return pct.format(n);
  },
  /** 4dp number — for unit-rate columns where precision matters. */
  rate(n: number | null | undefined) {
    if (n == null) return '—';
    return fourDp.format(n);
  },
  /**
   * "Mar 14, 2026" from an ISO date or timestamp string. Date-only strings
   * are parsed as local dates — `new Date('2026-03-14')` is UTC midnight,
   * which renders as the previous day in any negative-offset timezone.
   */
  date(iso: string | null | undefined) {
    if (!iso) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return dateFmt.format(d);
  },
};
