import { describe, expect, it } from 'vitest';
import valuationJson from '../config/valuation.json';
import type { Listing, Municipality, PriceIndex, Transaction, ValuationConfig } from '../types';
import { buildChartData } from './chartData';
import { evaluateListing } from './valuation';

const config = valuationJson as ValuationConfig;
const municipalities: Municipality[] = [
  { code: '28202', name: '尼崎市', prefectureCode: '28', group: 'hanshin', groupName: '阪神間', contractCount: 0, tradeCount: 0, latestPeriod: '2026Q1' },
  { code: '28204', name: '西宮市', prefectureCode: '28', group: 'hanshin', groupName: '阪神間', contractCount: 0, tradeCount: 0, latestPeriod: '2026Q1' },
];
const priceIndex: PriceIndex = {
  method: 'time_dummy_hedonic', basePeriod: '2025Q2', generatedAt: '2026-09-01T00:00:00.000Z',
  points: [{ period: '2025Q2', value: 1, n: 100, lowN: false }],
};

function makeListing(): Listing {
  return {
    id: 'listing', name: '対象', sourceUrl: '', municipalityCode: '28202', addressText: '', lat: null, lon: null,
    station: '', walkMinutes: null, areaSqm: 70, buildingYear: 2011, buildingMonth: 1, floor: null,
    totalFloors: null, floorPlan: '3LDK', managementFeeYen: null, repairReserveYen: null,
    renovation: { status: 'unknown', year: null, scope: '', evidence: '' },
    priceHistory: [{ date: '2026-09-01', priceYen: 30_000_000, memo: '' }], memo: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function makeTransaction(index: number, overrides: Partial<Transaction> = {}): Transaction {
  const pricePerSqm = 400_000 + index * 10_000;
  return {
    id: `tx-${index}`, priceCategory: 'contract', municipalityCode: '28202', district: null,
    period: '2025Q2', priceYen: pricePerSqm * 70, areaSqm: 70, pricePerSqm,
    buildingYear: 2011, ageAtTrade: 15, seismic: 'new', floorPlan: null, structure: 'RC',
    renovation: 'unknown', nearestStation: null, walkMinutes: null, source: 'csv', ...overrides,
  };
}

function chartFor(transactions: Transaction[]) {
  const listing = makeListing();
  const evaluation = evaluateListing({ listing, transactions, municipalities, priceIndex, latestPeriod: '2026Q1', negotiationRate: 0, config });
  return { evaluation, chart: buildChartData({ listing, evaluation, transactions, latestPeriod: '2026Q1', priceIndex }) };
}

describe('buildChartData', () => {
  it('uses million yen for every series in the area chart', () => {
    const { chart } = chartFor([makeTransaction(5, { pricePerSqm: 455_000 }), ...Array.from({ length: 11 }, (_, i) => makeTransaction(i + 20))]);
    const comparable = chart.areaComparables.find((point) => Math.abs(point.y - 31.85) < 1e-9);
    expect(comparable).toBeDefined();
    expect(chart.areaTarget).toEqual({ x: 70, y: 30 });
  });

  it('includes comparables from another municipality in the group', () => {
    const local = Array.from({ length: 3 }, (_, i) => makeTransaction(i));
    const neighbor = Array.from({ length: 9 }, (_, i) => makeTransaction(i + 10, { id: `n-${i}`, municipalityCode: '28204' }));
    const { evaluation, chart } = chartFor([...local, ...neighbor]);
    expect(evaluation.relaxations).toContain('同じグループの市区町村まで広げた');
    expect(chart.ageComparables).toHaveLength(12);
  });

  it('does not repeat comparables in the background', () => {
    const transactions = Array.from({ length: 12 }, (_, i) => makeTransaction(i));
    const { chart } = chartFor([...transactions, makeTransaction(99, { ageAtTrade: 40 })]);
    expect(chart.ageComparables).toHaveLength(12);
    expect(chart.ageBackground).toEqual([{ x: 40, y: 139 }]);
  });
});
