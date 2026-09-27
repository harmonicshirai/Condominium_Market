import { describe, expect, it } from 'vitest';
import { quantile } from './stats';

describe('quantile', () => {
  it('uses linear interpolation', () => {
    expect(quantile([10, 20, 30, 40], 0.25)).toBe(17.5);
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(quantile([10, 20, 30, 40], 0.75)).toBe(32.5);
  });

  it('does not mutate the values array', () => {
    const values = [40, 10, 30, 20];
    quantile(values, 0.5);
    expect(values).toEqual([40, 10, 30, 20]);
  });
});
