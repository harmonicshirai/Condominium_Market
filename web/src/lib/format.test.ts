import { describe, expect, it } from 'vitest';
import { formatManYen, formatPct, formatPeriod, formatPpsqm } from './format';

describe('display formatting', () => {
  it('formats yen, unit price and percentage', () => {
    expect(formatManYen(59_800_000)).toBe('5,980万円');
    expect(formatPpsqm(852_000)).toBe('85.2万円/㎡');
    expect(formatPct(9.72)).toBe('+9.7%');
    expect(formatPct(-5.81)).toBe('-5.8%');
    expect(formatPct(0)).toBe('0.0%');
  });

  it('formats quarter labels', () => {
    expect(formatPeriod('2024Q3')).toBe('2024年7〜9月');
    expect(formatPeriod('bad')).toBe('期間不明');
  });
});
