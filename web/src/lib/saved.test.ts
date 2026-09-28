import { describe, expect, it } from 'vitest';
import type { Listing, LocalListing } from '../types';
import { bestIndexes, collectSaved, toggleCompareId } from './saved';

const base: Listing = {
  id: 'mine-1', name: '自分', sourceUrl: '', municipalityCode: '28202', addressText: '', lat: null, lon: null,
  station: '', walkMinutes: null, areaSqm: 70, buildingYear: 2000, buildingMonth: 1, floor: null,
  totalFloors: null, floorPlan: '3LDK', managementFeeYen: null, repairReserveYen: null,
  renovation: { status: 'unknown', year: null, scope: '', evidence: '' },
  priceHistory: [{ date: '2026-09-25', priceYen: 30_000_000, memo: '' }], memo: '', createdAt: '', updatedAt: '',
};
const local = (id: string): LocalListing => ({
  ...base, id, name: id, sourceName: 'テスト', externalId: id, status: 'active', firstSeen: '2026-09-25', lastSeen: '2026-09-25',
  locationPrecision: 'approx', areaBasis: null, landRights: null, totalUnits: null, direction: null, dupGroup: null, detailFetchedAt: null,
});

describe('saved listings', () => {
  it('lists saved listings in saved order, then my own listings, and counts missing ids', () => {
    const { items, missing } = collectSaved([local('a'), local('b')], new Set(['b', 'gone', 'a']), [base], new Map(), new Map());
    expect(items.map((item) => [item.kind, item.listing.id])).toEqual([['local', 'b'], ['local', 'a'], ['mine', 'mine-1']]);
    expect(missing).toBe(1);
  });

  it('adds to the comparison up to the limit and removes on a second toggle', () => {
    expect(toggleCompareId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleCompareId(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleCompareId(['a', 'b', 'c', 'd'], 'e')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('marks the best value only when there is a difference', () => {
    expect([...bestIndexes([30, 20, null, 20], 'min')]).toEqual([1, 3]);
    expect([...bestIndexes([60, 75], 'max')]).toEqual([1]);
    expect(bestIndexes([10, 10], 'min').size).toBe(0);
    expect(bestIndexes([10, null], 'min').size).toBe(0);
  });
});
