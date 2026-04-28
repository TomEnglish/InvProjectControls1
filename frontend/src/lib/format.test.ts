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
