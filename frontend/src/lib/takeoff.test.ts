import { describe, it, expect } from 'vitest';
import { roundUpAtIwpTotal } from './takeoff';

describe('roundUpAtIwpTotal', () => {
  it('sums inches per IWP then rounds up to feet', () => {
    // Three rows in IWP A summing to 13 inches → ceil(13/12) = 2 ft.
    // Per-row rounding would give ceil(5/12)+ceil(5/12)+ceil(3/12) = 1+1+1 = 3 ft.
    const result = roundUpAtIwpTotal([
      { iwp_id: 'IWP-A', quantity_inches: 5 },
      { iwp_id: 'IWP-A', quantity_inches: 5 },
      { iwp_id: 'IWP-A', quantity_inches: 3 },
    ]);
    expect(result).toEqual([{ iwp_id: 'IWP-A', quantity_feet: 2 }]);
  });

  it('rounds an exact-foot sum without bumping up', () => {
    const result = roundUpAtIwpTotal([
      { iwp_id: 'IWP-A', quantity_inches: 12 },
      { iwp_id: 'IWP-A', quantity_inches: 24 },
    ]);
    expect(result).toEqual([{ iwp_id: 'IWP-A', quantity_feet: 3 }]);
  });

  it('keeps IWP totals separate', () => {
    const result = roundUpAtIwpTotal([
      { iwp_id: 'IWP-A', quantity_inches: 13 },
      { iwp_id: 'IWP-B', quantity_inches: 11 },
      { iwp_id: 'IWP-A', quantity_inches: 25 },
    ]);
    expect(result).toEqual([
      { iwp_id: 'IWP-A', quantity_feet: 4 }, // 13+25=38 → ceil(38/12)=4
      { iwp_id: 'IWP-B', quantity_feet: 1 }, // 11 → ceil(11/12)=1
    ]);
  });

  it('skips rows without iwp_id', () => {
    const result = roundUpAtIwpTotal([
      { iwp_id: 'IWP-A', quantity_inches: 10 },
      { iwp_id: '', quantity_inches: 100 },
      { iwp_id: 'IWP-A', quantity_inches: 5 },
    ]);
    expect(result).toEqual([{ iwp_id: 'IWP-A', quantity_feet: 2 }]); // 15/12=1.25 → 2
  });

  it('returns an empty list when there are no IWP-tagged rows', () => {
    expect(roundUpAtIwpTotal([])).toEqual([]);
    expect(roundUpAtIwpTotal([{ iwp_id: '', quantity_inches: 50 }])).toEqual([]);
  });

  it('handles fractional inches', () => {
    // 11.4 + 0.7 = 12.1 inches → ceil(12.1/12) = 2 ft (not 1).
    const result = roundUpAtIwpTotal([
      { iwp_id: 'IWP-A', quantity_inches: 11.4 },
      { iwp_id: 'IWP-A', quantity_inches: 0.7 },
    ]);
    expect(result).toEqual([{ iwp_id: 'IWP-A', quantity_feet: 2 }]);
  });
});
