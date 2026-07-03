// UOM normalization for audit-file imports.
//
// The client's audit workbooks are hand-maintained per discipline, so the
// same unit shows up as 'LF' and 'LF.' (trailing period) or 'TN' vs 'TONS'.
// The progress_records.uom column is the projectcontrols.uom_code enum, so
// anything that doesn't normalize to a known value fails the insert —
// normalize here, and pre-validate before inserting so the caller gets a
// row-level error message instead of a raw Postgres enum rejection.

// Aliases seen in the field → canonical enum value.
const UOM_ALIASES: Record<string, string> = {
  TN: 'TONS',
  TON: 'TONS',
};

// Must track the projectcontrols.uom_code enum (0001_init + add-value
// migrations 20260508000000 CF, 20260703000001 EMU).
export const KNOWN_UOMS: ReadonlySet<string> = new Set([
  'LF',
  'CY',
  'EA',
  'TONS',
  'SF',
  'HR',
  'LS',
  'CF',
  'EMU',
]);

/** Uppercase, strip trailing punctuation, resolve aliases. 'EA' when blank. */
export function normalizeUom(raw: string | undefined | null): string {
  const cleaned = (raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[.\s]+$/, '');
  if (!cleaned) return 'EA';
  return UOM_ALIASES[cleaned] ?? cleaned;
}
