import { describe, expect, it } from 'vitest';
import { summarizePriceHistory } from './priceHistory';

describe('summarizePriceHistory', () => {
  it('summarizes listing duration and price changes', () => {
    const summary = summarizePriceHistory([
      { date: '2026-06-15', priceYen: 64_800_000, memo: '' },
      { date: '2026-07-20', priceYen: 62_800_000, memo: '' },
      { date: '2026-09-01', priceYen: 59_800_000, memo: '' },
    ], '2026-09-25');
    expect(summary).toMatchObject({ changeCount: 2, totalChange: -5_000_000, totalChangePct: -7.7, daysListed: 102, lastChangeDate: '2026-09-01' });
  });

  it('does not count an unchanged price as a price change', () => {
    const summary = summarizePriceHistory([
      { date: '2026-06-15', priceYen: 30_000_000, memo: '' },
      { date: '2026-07-20', priceYen: 30_000_000, memo: '' },
    ], '2026-09-25');
    expect(summary?.changeCount).toBe(0);
    expect(summary?.totalChangePct).toBe(0);
    expect(summary?.lastChangeDate).toBeNull();
  });
});
