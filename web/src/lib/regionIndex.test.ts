import { describe, expect, it } from 'vitest';
import type { Listing, Municipality, RegionIndex, RegionSeries, Transaction } from '../types';
import { latestPosition, listingRegionChange, makeTimeAdjuster, rebased, regionChange, stationSeriesFor } from './regionIndex';

const PERIODS = ['2023Q1', '2023Q2', '2024Q1', '2026Q1'];
function series(id: string, smooth: (number | null)[], n4 = [100, 100, 100, 100], extra: Partial<RegionSeries> = {}): RegionSeries {
  return { id, name: id, rows: 400, log: smooth, smooth, n: n4, n4, ...extra };
}
const index: RegionIndex = {
  generatedAt: '', method: 'time_dummy_hedonic_fe', periods: PERIODS, defaultBase: '2023Q1', smoothQuarters: 4, minWindowN: 40,
  average: series('kansai', [0, 0.05, 0.1, Math.log(1.2)]),
  municipalities: [series('28202', [0, 0.02, 0.05, Math.log(1.1)]), series('26303', [0, 0.1, 0.2, Math.log(1.3)], [10, 10, 10, 10], { group: 'otokuni' })],
  groups: [series('hanshin', [0, 0.03, 0.06, Math.log(1.15)]), series('otokuni', [0, 0.02, 0.04, Math.log(1.08)])],
  stations: [series('尼崎(JR)', [0, 0.1, 0.2, Math.log(1.3)]), series('尼崎(阪神)', [0, 0, 0, Math.log(1.05)]), series('立花', [0, 0, 0, Math.log(1.25)])],
};
const municipalities = [
  { code: '28202', name: '尼崎市', group: 'hanshin' }, { code: '26303', name: '大山崎町', group: 'otokuni' },
] as Municipality[];

describe('regional change', () => {
  it('rebases to 100 and measures the gap from the Kansai average', () => {
    expect(latestPosition(index)).toBe(3);
    expect(rebased(index.municipalities[0], 0, true)[3]).toBeCloseTo(110, 6);
    const result = regionChange(index, index.municipalities[0], 'municipality', 0)!;
    expect(result.changePct).toBeCloseTo(10, 6);
    expect(result.vsAveragePt).toBeCloseTo(-10, 6);
    expect(result.lowN).toBe(false);
  });

  it('matches stations by operator qualifier from the line name', () => {
    expect(stationSeriesFor(index, '尼崎', '阪神本線')?.id).toBe('尼崎(阪神)');
    expect(stationSeriesFor(index, '尼崎', 'JR東海道本線')?.id).toBe('尼崎(JR)');
    expect(stationSeriesFor(index, '尼崎', '阪急神戸線')).toBeNull();
    expect(stationSeriesFor(index, '立花駅', 'JR東海道本線')?.id).toBe('立花');
  });

  it('prefers station, then municipality, then group', () => {
    const listing = { station: '立花', municipalityCode: '28202', line: 'JR東海道本線' } as Listing & { line: string };
    expect(listingRegionChange(index, listing, municipalities, 0)?.level).toBe('station');
    const noStation = { station: '', municipalityCode: '28202' } as Listing;
    expect(listingRegionChange(index, noStation, municipalities, 0)?.level).toBe('municipality');
    const small = { station: '', municipalityCode: '26303' } as Listing;
    expect(listingRegionChange(index, small, municipalities, 0)?.level).toBe('group');
  });
});

describe('makeTimeAdjuster', () => {
  it('uses the municipality series, then group, then the Kansai average', () => {
    const adjust = makeTimeAdjuster(index, municipalities, '2026Q1');
    const tx = (code: string, period: string) => ({ municipalityCode: code, period }) as Transaction;
    expect(adjust(tx('28202', '2023Q1'))).toBeCloseTo(1.1, 6);
    expect(adjust(tx('26303', '2023Q1'))).toBeCloseTo(1.08, 6); // 件数が少ないのでグループ
    expect(adjust(tx('99999', '2023Q1'))).toBeCloseTo(1.2, 6); // 関西平均
    expect(adjust(tx('28202', '2020Q1'))).toBeNull();
  });
});
