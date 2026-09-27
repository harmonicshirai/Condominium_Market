import { describe, expect, it } from 'vitest';
import type { Listing } from '../types';
import { CONDITIONS_KEY, DEFAULT_CONDITIONS, EXPORT_SCHEMA, LISTINGS_KEY, createExport, importExport, readConditions, readListings, saveListings } from './storage';

const listing: Listing = {
  id: 'one', name: '物件', sourceUrl: '', municipalityCode: '28202', addressText: '', lat: null, lon: null,
  station: '', walkMinutes: null, areaSqm: 70, buildingYear: 2000, buildingMonth: 1, floor: null,
  totalFloors: null, floorPlan: '3LDK', managementFeeYen: null, repairReserveYen: null,
  renovation: { status: 'unknown', year: null, scope: '', evidence: '' },
  priceHistory: [{ date: '2026-09-25', priceYen: 30_000_000, memo: '' }], memo: '',
  createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
};

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

describe('local storage', () => {
  it('round-trips listings and drops invalid entries', () => {
    const storage = fakeStorage({ [LISTINGS_KEY]: JSON.stringify([listing, { id: 'bad' }]) });
    expect(readListings(storage)).toEqual({ listings: [listing], dropped: 1 });
    expect(saveListings([listing], storage)).toBe(true);
    expect(readListings(storage)).toEqual({ listings: [listing], dropped: 0 });
  });

  it('returns defaults when the stored data cannot be read', () => {
    expect(readListings(null)).toEqual({ listings: [], dropped: 0 });
    expect(readConditions(null)).toEqual(DEFAULT_CONDITIONS);
    const storage = fakeStorage({ [CONDITIONS_KEY]: '{' });
    expect(readConditions(storage)).toEqual(DEFAULT_CONDITIONS);
  });

  it('validates export schema and merges duplicate ids only when requested', () => {
    const payload = JSON.parse(createExport([listing], DEFAULT_CONDITIONS, new Date('2026-09-25T00:00:00.000Z'))) as unknown;
    expect((payload as { schema: string }).schema).toBe(EXPORT_SCHEMA);
    const imported = importExport(payload, [{ ...listing, name: '既存' }], true);
    expect(imported.listings[0].name).toBe('物件');
    expect(importExport(payload, [{ ...listing, name: '既存' }], false).listings[0].name).toBe('既存');
    expect(() => importExport({ schema: 'wrong' }, [], false)).toThrow();
  });
});
