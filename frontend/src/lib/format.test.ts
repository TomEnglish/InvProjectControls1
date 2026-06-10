import { describe, it, expect } from 'vitest';
import { fmt } from './format';

describe('fmt.int', () => {
  it('formats whole numbers with commas', () => {
    expect(fmt.int(1234567)).toBe('1,234,567');
  });

  it('renders em-dash for null/undefined', () => {
    expect(fmt.int(null)).toBe('—');
    expect(fmt.int(undefined)).toBe('—');
  });

  it('rounds non-integers', () => {
    expect(fmt.int(123.7)).toBe('124');
  });
});

describe('fmt.pct', () => {
  it('renders fraction as percent with 1dp', () => {
    expect(fmt.pct(0.391)).toBe('39.1%');
  });

  it('renders zero', () => {
    expect(fmt.pct(0)).toBe('0.0%');
  });

  it('renders em-dash for null', () => {
    expect(fmt.pct(null)).toBe('—');
  });
});

describe('fmt.ratio', () => {
  it('renders 3dp', () => {
    expect(fmt.ratio(1.234567)).toBe('1.235');
    expect(fmt.ratio(0.95)).toBe('0.950');
  });

  it('renders em-dash for null (missing CPI/SPI)', () => {
    expect(fmt.ratio(null)).toBe('—');
  });
});

describe('fmt.rate', () => {
  it('renders 4dp for unit rates', () => {
    expect(fmt.rate(8.5)).toBe('8.5000');
    expect(fmt.rate(1.85123)).toBe('1.8512');
  });
});

describe('fmt.date', () => {
  it('parses date-only strings as local dates (no UTC day-shift)', () => {
    // new Date('2026-03-14') is UTC midnight, which renders as Mar 13 in any
    // negative-offset timezone — the regex branch must prevent that.
    expect(fmt.date('2026-03-14')).toBe('Mar 14, 2026');
    expect(fmt.date('2026-01-01')).toBe('Jan 1, 2026');
    expect(fmt.date('2025-12-31')).toBe('Dec 31, 2025');
  });

  it('formats full timestamps', () => {
    expect(fmt.date('2026-03-14T12:30:00')).toBe('Mar 14, 2026');
  });

  it('renders em-dash for null/undefined/empty', () => {
    expect(fmt.date(null)).toBe('—');
    expect(fmt.date(undefined)).toBe('—');
    expect(fmt.date('')).toBe('—');
  });

  it('passes through unparseable strings', () => {
    expect(fmt.date('not-a-date')).toBe('not-a-date');
  });
});
