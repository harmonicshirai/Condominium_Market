import { describe, expect, it } from 'vitest';
import valuationJson from '../config/valuation.json';
import type { Listing, Municipality, PriceIndex, Transaction, ValuationConfig } from '../types';
import { evaluateListing, listingSeismic } from './valuation';

const config = valuationJson as ValuationConfig;
const municipalities: Municipality[] = [
  { code: '27207', name: '高槻市', prefectureCode: '27', group: 'hokusetsu', groupName: '北摂東部', contractCount: 12, tradeCount: 0, latestPeriod: '2025Q2' },
  { code: '28202', name: '尼崎市', prefectureCode: '28', group: 'hanshin', groupName: '阪神間', contractCount: 0, tradeCount: 0, latestPeriod: null },
];

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing', name: '対象', sourceUrl: '', municipalityCode: '27207', addressText: '', lat: null, lon: null,
    station: '', walkMinutes: null, areaSqm: 70, buildingYear: 2011, buildingMonth: 1, floor: null,
    totalFloors: null, floorPlan: '3LDK', managementFeeYen: null, repairReserveYen: null,
    renovation: { status: 'unknown', year: null, scope: '', evidence: '' },
    priceHistory: [{ date: '2026-09-01', priceYen: 30_000_000, memo: '' }], memo: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTransaction(index: number, overrides: Partial<Transaction> = {}): Transaction {
  const pricePerSqm = 400_000 + index * 10_000;
  return {
    id: `tx-${index}`, priceCategory: 'contract', municipalityCode: '27207', district: null,
    period: '2025Q2', priceYen: pricePerSqm * 70, areaSqm: 70, pricePerSqm,
    buildingYear: 2011, ageAtTrade: 15, seismic: 'new', floorPlan: null, structure: 'RC',
    renovation: 'unknown', nearestStation: null, walkMinutes: null, source: 'csv', ...overrides,
  };
}

function makeIndex(value = 1): PriceIndex {
  return { method: 'time_dummy_hedonic', basePeriod: '2025Q2', generatedAt: '2026-09-01T00:00:00.000Z', points: [{ period: '2025Q2', value, n: 100, lowN: false }] };
}

function evaluate(transactions: Transaction[], listing = makeListing(), priceIndex = makeIndex()) {
  return evaluateListing({ listing, transactions, municipalities, priceIndex, latestPeriod: '2026Q1', negotiationRate: 0, config });
}

describe('evaluateListing', () => {
  it('calculates comparable ranges and the below label', () => {
    const result = evaluate(Array.from({ length: 12 }, (_, index) => makeTransaction(index)));
    expect(result.stats).toMatchObject({ n: 12, median: 455_000, p25: 427_500, p75: 482_500 });
    expect(result.estimatedPrice).toBe(31_850_000);
    expect(result.gapPct).toBe(-5.8);
    expect(result.label).toBe('below');
    expect(result.confidence).toBe('C');
    expect(result.relaxations).toEqual([]);
  });

  it('uses negotiation rate for effective price but keeps asking price gap', () => {
    const result = evaluate(Array.from({ length: 12 }, (_, index) => makeTransaction(index)), makeListing({
      priceHistory: [{ date: '2026-09-01', priceYen: 33_000_000, memo: '' }],
    }));
    const withNegotiation = evaluateListing({
      listing: makeListing({ priceHistory: [{ date: '2026-09-01', priceYen: 33_000_000, memo: '' }] }),
      transactions: Array.from({ length: 12 }, (_, index) => makeTransaction(index)),
      municipalities, priceIndex: makeIndex(), latestPeriod: '2026Q1', negotiationRate: 0.03, config,
    });
    expect(withNegotiation.effectivePrice).toBe(32_010_000);
    expect(withNegotiation.gapPct).toBe(0.5);
    expect(withNegotiation.gapPctAsking).toBe(3.6);
    expect(withNegotiation.label).toBe('near');
    expect(result.askingPrice).toBe(33_000_000);
  });

  it('widens the time window when the minimum sample count is not met', () => {
    const transactions = Array.from({ length: 12 }, (_, index) => makeTransaction(index, { period: index < 6 ? '2023Q2' : '2025Q2' }));
    const result = evaluate(transactions);
    expect(result.relaxations).toEqual(['取引時期を直近12四半期に広げた']);
    expect(result.stats?.n).toBe(12);
  });

  it('holds when fewer than five examples remain', () => {
    const result = evaluate(Array.from({ length: 3 }, (_, index) => makeTransaction(index)));
    expect(result.status).toBe('hold');
    expect(result.label).toBe('hold');
    expect(result.stats).toBeNull();
    expect(result.relaxations).toHaveLength(5);
  });

  it('does not compare old seismic buildings to new seismic examples', () => {
    const result = evaluate(
      Array.from({ length: 12 }, (_, index) => makeTransaction(index, { ageAtTrade: 47 })),
      makeListing({ buildingYear: 1979 }),
    );
    expect(result.status).toBe('hold');
    expect(result.comparables).toHaveLength(0);
  });

  it('adjusts comparable prices by the period index', () => {
    const result = evaluate(Array.from({ length: 12 }, (_, index) => makeTransaction(index)), makeListing(), makeIndex(0.9));
    expect(result.stats?.median).toBeCloseTo(455_000 / 0.9, 0);
  });

  it('relaxes the walking-distance condition first', () => {
    const transactions = Array.from({ length: 12 }, (_, index) => makeTransaction(index, { walkMinutes: index < 6 ? 5 : 15 }));
    const result = evaluate(transactions, makeListing({ walkMinutes: 5 }));
    expect(result.relaxations[0]).toBe('駅徒歩の条件を外した');
    expect(result.stats?.n).toBe(12);
  });
});

describe('renovation limitations', () => {
  const comps = () => Array.from({ length: 12 }, (_, index) => makeTransaction(index));
  it('explains the upward bias for renovated listings', () => {
    const result = evaluate(comps(), makeListing({ renovation: { status: 'renovated', year: 2024, scope: '全面', evidence: '' } }));
    expect(result.limitations).toContain('比較事例の多くはリフォーム状況が不明（未改装を含む）のため、リフォーム済みのこの物件は相場より高く出やすい');
  });
  it('explains that contract data has no not-renovated category', () => {
    const result = evaluate(comps(), makeListing({ renovation: { status: 'not_renovated', year: null, scope: '', evidence: '' } }));
    expect(result.limitations).toContain('成約事例には『未改装』の区分がないため、リフォームの有無はそろえていない');
  });
});

describe('outside the estimated range', () => {
  const comps = () => Array.from({ length: 12 }, (_, index) => makeTransaction(index));
  const priced = (priceYen: number) => makeListing({ priceHistory: [{ date: '2026-09-01', priceYen, memo: '' }] });
  it('warns when far below the lower bound', () => {
    expect(evaluate(comps(), priced(20_000_000)).limitations.some((text) => text.includes('下限を大きく下回って'))).toBe(true);
  });
  it('warns when far above the upper bound', () => {
    expect(evaluate(comps(), priced(45_000_000)).limitations.some((text) => text.includes('上限を大きく上回って'))).toBe(true);
  });
  it('does not warn inside the range', () => {
    expect(evaluate(comps(), priced(30_000_000)).limitations.some((text) => text.includes('大きく'))).toBe(false);
  });
});

describe('regional time adjustment', () => {
  it('uses the regional factor when given and falls back to the price index', () => {
    const transactions = Array.from({ length: 12 }, (_, index) => makeTransaction(index));
    const regional = evaluateListing({
      listing: makeListing(), transactions, municipalities, priceIndex: makeIndex(0.9), latestPeriod: '2026Q1',
      negotiationRate: 0, config, timeAdjust: () => 1.2,
    });
    expect(regional.stats?.median).toBeCloseTo(455_000 * 1.2, 0);
    const fallback = evaluateListing({
      listing: makeListing(), transactions, municipalities, priceIndex: makeIndex(0.9), latestPeriod: '2026Q1',
      negotiationRate: 0, config, timeAdjust: () => null,
    });
    expect(fallback.stats?.median).toBeCloseTo(455_000 / 0.9, 0);
  });
});

describe('listingSeismic', () => {
  it('uses the same year rules as the data pipeline', () => {
    expect(listingSeismic(1980)).toBe('old');
    expect(listingSeismic(1981)).toBe('unknown');
    expect(listingSeismic(1983)).toBe('new');
    expect(listingSeismic(null)).toBe('unknown');
  });
});
