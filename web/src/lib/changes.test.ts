import { describe, expect, it } from 'vitest';
import type { LocalListing } from '../types';
import { countChanges, diffListings, takeSnapshot } from './changes';

const listing = (id: string, priceYen: number, status: 'active' | 'removed' = 'active'): LocalListing => ({
  id, name: id, sourceUrl: '', municipalityCode: '28202', addressText: '', lat: null, lon: null,
  station: '', walkMinutes: null, areaSqm: 70, buildingYear: 2000, buildingMonth: 1, floor: null,
  totalFloors: null, floorPlan: '', managementFeeYen: null, repairReserveYen: null,
  renovation: { status: 'unknown', year: null, scope: '', evidence: '' },
  priceHistory: [{ date: '2026-09-25', priceYen, memo: '' }], memo: '', createdAt: '', updatedAt: '',
  sourceName: 'テスト', externalId: id, status, firstSeen: '2026-09-25', lastSeen: '2026-09-25',
  locationPrecision: 'approx', areaBasis: null, landRights: null, totalUnits: null, direction: null, dupGroup: null, detailFetchedAt: null,
});

describe('changes since the last check', () => {
  const before = takeSnapshot([
    listing('same', 20_000_000), listing('down', 30_000_000), listing('up', 10_000_000),
    listing('gone', 15_000_000), listing('back', 12_000_000, 'removed'), listing('old-removed', 9_000_000, 'removed'),
  ], '2026-09-28T09:00:00+09:00');
  const now = [
    listing('same', 20_000_000), listing('down', 29_000_000), listing('up', 10_500_000),
    listing('gone', 15_000_000, 'removed'), listing('back', 12_000_000), listing('old-removed', 9_000_000, 'removed'),
    listing('fresh', 25_000_000), listing('fresh-removed', 25_000_000, 'removed'),
  ];

  it('finds new, price-changed and removed listings', () => {
    const changes = diffListings(now, before);
    expect(changes.get('down')).toEqual({ kind: 'price_down', previousPriceYen: 30_000_000, diffYen: -1_000_000 });
    expect(changes.get('up')?.kind).toBe('price_up');
    expect(changes.get('gone')?.kind).toBe('removed');
    expect(changes.get('fresh')?.kind).toBe('new');
    expect(changes.get('back')?.kind).toBe('new');
    expect(changes.has('same')).toBe(false);
    expect(changes.has('old-removed')).toBe(false);
    expect(changes.has('fresh-removed')).toBe(false);
  });

  it('counts changes overall and for a subset such as saved listings', () => {
    const changes = diffListings(now, before);
    expect(countChanges(changes)).toEqual({ new: 2, price_down: 1, price_up: 1, removed: 1 });
    expect(countChanges(changes, ['down', 'same', 'gone'])).toEqual({ new: 0, price_down: 1, price_up: 0, removed: 1 });
  });

  it('shows nothing right after checking', () => {
    expect(diffListings(now, takeSnapshot(now, '2026-09-29T09:00:00+09:00')).size).toBe(0);
  });
});
