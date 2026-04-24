const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const threeDp = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const pct = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
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
};
