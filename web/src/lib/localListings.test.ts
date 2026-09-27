import { describe, expect, it } from 'vitest';
import valuationJson from '../config/valuation.json';
import type { LocalListing, MyConditions, ValuationConfig } from '../types';
import { buildChecklist } from './checklist';
import { detailCommand, loadLocalData, matchesConditions, toMyListing } from './localListings';
import { DEFAULT_CONDITIONS } from './storage';

const config = valuationJson as ValuationConfig;

function makeLocal(overrides: Partial<LocalListing> = {}): LocalListing {
  return {
    id: 'local-123', name: 'サンプルマンション', sourceUrl: 'https://example.com/listings/123', municipalityCode: '28202',
    addressText: '兵庫県尼崎市', lat: 34.72, lon: 135.41, station: '尼崎', walkMinutes: 6, areaSqm: 61.9,
    buildingYear: 1980, buildingMonth: 3, floor: 2, totalFloors: 7, floorPlan: '3LDK', managementFeeYen: 15_430, repairReserveYen: 0,
    renovation: { status: 'renovated', year: 2026, scope: '内装', evidence: '掲載情報' },
    priceHistory: [{ date: '2026-09-27', priceYen: 13_800_000, memo: '' }], memo: '',
    createdAt: '2026-09-27', updatedAt: '2026-09-27', sourceName: 'サンプル', externalId: '123', status: 'active',
    firstSeen: '2026-09-27', lastSeen: '2026-09-27', locationPrecision: 'exact', areaBasis: '壁芯', landRights: '所有権',
    totalUnits: 27, direction: '南', dupGroup: null, detailFetchedAt: '2026-09-27', ...overrides,
  };
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const META = { generatedAt: '2026-09-27T21:00:00+09:00', sourceName: 'サンプル', lastListRunAt: null,
  counts: { active: 1, removed: 0, withDetail: 1, exact: 1, approx: 0 }, detailCommandTemplate: 'fetch-details --ids {ids}' };

describe('loadLocalData', () => {
  it('returns null when the local data does not exist (public site)', async () => {
    const fetcher = (async () => response(404, {})) as unknown as typeof fetch;
    expect(await loadLocalData(fetcher, '/')).toBeNull();
  });

  it('reads valid rows and counts invalid ones', async () => {
    const fetcher = (async (url: string) => url.endsWith('meta.json')
      ? response(200, META)
      : response(200, [makeLocal(), { id: 'broken' }])) as unknown as typeof fetch;
    const data = await loadLocalData(fetcher, '/');
    expect(data?.listings).toHaveLength(1);
    expect(data?.dropped).toBe(1);
  });
});

describe('toMyListing', () => {
  it('keeps listing fields and drops local-only fields', () => {
    const mine = toMyListing(makeLocal(), new Date('2026-09-28T00:00:00Z'), () => 'new-id');
    expect(mine.id).toBe('new-id');
    expect(mine.memo).toBe('サンプルから追加（123）');
    expect(mine).not.toHaveProperty('externalId');
    expect(mine.priceHistory).toEqual([{ date: '2026-09-27', priceYen: 13_800_000, memo: '' }]);
  });
});

describe('matchesConditions', () => {
  const base: MyConditions = { ...DEFAULT_CONDITIONS };
  it('checks budget with closing costs', () => {
    expect(matchesConditions(makeLocal(), undefined, { ...base, budgetYen: 14_766_000 })).toBe(true);
    expect(matchesConditions(makeLocal(), undefined, { ...base, budgetYen: 14_700_000 })).toBe(false);
  });
  it('checks area, walk and monthly fees, ignoring unknown values', () => {
    expect(matchesConditions(makeLocal(), undefined, { ...base, minAreaSqm: 65 })).toBe(false);
    expect(matchesConditions(makeLocal(), undefined, { ...base, maxWalkMinutes: 5 })).toBe(false);
    expect(matchesConditions(makeLocal({ walkMinutes: null }), undefined, { ...base, maxWalkMinutes: 5 })).toBe(true);
    expect(matchesConditions(makeLocal(), undefined, { ...base, maxMonthlyFeesYen: 15_000 })).toBe(false);
  });
});

describe('detailCommand', () => {
  it('lists starred listings without details', () => {
    const listings = [makeLocal({ id: 'local-1', externalId: '1', detailFetchedAt: null }), makeLocal({ id: 'local-2', externalId: '2' })];
    expect(detailCommand(listings, new Set(['local-1', 'local-2']), 'x --ids {ids}')).toBe('x --ids 1');
    expect(detailCommand(listings, new Set(['local-2']), 'x --ids {ids}')).toBeNull();
  });
});

describe('checklist for local listings', () => {
  it('flags a missing repair reserve and checks land rights', () => {
    const items = buildChecklist({ listing: makeLocal(), evaluation: null, hazard: null, conditions: DEFAULT_CONDITIONS, config, landRights: '所有権' });
    expect(items.find((item) => item.id === 'repair_reserve')?.status).toBe('ng');
    expect(items.find((item) => item.id === 'land_rights')?.status).toBe('ok');
    const leased = buildChecklist({ listing: makeLocal(), evaluation: null, hazard: null, conditions: DEFAULT_CONDITIONS, config, landRights: '借地権' });
    expect(leased.find((item) => item.id === 'land_rights')?.status).toBe('warn');
  });
  it('does not show land rights for my own listings', () => {
    const items = buildChecklist({ listing: makeLocal(), evaluation: null, hazard: null, conditions: DEFAULT_CONDITIONS, config });
    expect(items.some((item) => item.id === 'land_rights')).toBe(false);
  });
});
