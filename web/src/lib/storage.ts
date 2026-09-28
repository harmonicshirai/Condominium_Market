import { z } from 'zod';
import type { Listing, MyConditions } from '../types';
import { DEFAULT_FINANCING } from './financing';

export const LISTINGS_KEY = 'keihan-mansion-map:v1:listings';
export const CONDITIONS_KEY = 'keihan-mansion-map:v1:conditions';
export const EXPORT_SCHEMA = 'keihan-mansion-map/listings';

const nullableNumber = z.number().finite().nonnegative().nullable();
const observationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  priceYen: z.number().int().positive(),
  memo: z.string(),
});

export const listingBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  sourceUrl: z.string(),
  municipalityCode: z.string().regex(/^\d{5}$/),
  addressText: z.string(),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  station: z.string(),
  walkMinutes: nullableNumber,
  areaSqm: z.number().finite().min(10).max(300),
  buildingYear: z.number().int().min(1800).max(2200).nullable(),
  buildingMonth: z.number().int().min(1).max(12).nullable(),
  floor: nullableNumber,
  totalFloors: nullableNumber,
  floorPlan: z.string(),
  managementFeeYen: nullableNumber,
  repairReserveYen: nullableNumber,
  renovation: z.object({
    status: z.enum(['renovated', 'not_renovated', 'unknown']),
    year: z.number().int().min(1800).max(2200).nullable(),
    scope: z.string(),
    evidence: z.string(),
  }),
  priceHistory: z.array(observationSchema).min(1),
  memo: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const listingSchema = listingBaseSchema.superRefine((listing, context) => {
  if ((listing.lat === null) !== (listing.lon === null)) {
    context.addIssue({ code: 'custom', path: ['lat'], message: '緯度と経度は両方指定してください' });
  }
  const dates = listing.priceHistory.map((item) => item.date);
  if (dates.some((date, index) => index > 0 && date < dates[index - 1])) {
    context.addIssue({ code: 'custom', path: ['priceHistory'], message: '価格履歴は日付順にしてください' });
  }
});

// 以前に保存した条件（financing がない）も読めるように、項目ごとに既定値を持たせる
export const financingSchema = z.object({
  showLoan: z.boolean().default(DEFAULT_FINANCING.showLoan),
  ageYears: z.number().int().min(18).max(120).nullable().default(DEFAULT_FINANCING.ageYears),
  annualIncomeYen: nullableNumber.default(DEFAULT_FINANCING.annualIncomeYen),
  ratePct: z.number().min(0).max(20).default(DEFAULT_FINANCING.ratePct),
  method: z.enum(['auto', 'interest_only', 'amortizing']).default(DEFAULT_FINANCING.method),
  termYears: z.number().int().min(1).max(50).nullable().default(DEFAULT_FINANCING.termYears),
  loanToValuePct: z.number().min(0).max(100).default(DEFAULT_FINANCING.loanToValuePct),
});

export const conditionsSchema = z.object({
  budgetYen: nullableNumber,
  minAreaSqm: nullableNumber,
  maxWalkMinutes: nullableNumber,
  maxMonthlyFeesYen: nullableNumber,
  negotiationRate: z.number().min(0).max(0.2),
  closingCostRate: z.number().min(0).max(1),
  financing: financingSchema.prefault({}),
});

const exportSchema = z.object({
  schema: z.literal(EXPORT_SCHEMA),
  version: z.literal(1),
  exportedAt: z.string().min(1),
  listings: z.array(listingSchema),
  conditions: conditionsSchema,
});

export const DEFAULT_CONDITIONS: MyConditions = {
  budgetYen: null,
  minAreaSqm: null,
  maxWalkMinutes: null,
  maxMonthlyFeesYen: null,
  negotiationRate: 0,
  closingCostRate: 0.07,
  financing: DEFAULT_FINANCING,
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readListings(storage: StorageLike | null = browserStorage()): { listings: Listing[]; dropped: number } {
  if (!storage) return { listings: [], dropped: 0 };
  try {
    const raw = storage.getItem(LISTINGS_KEY);
    if (!raw) return { listings: [], dropped: 0 };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { listings: [], dropped: 1 };
    const listings: Listing[] = [];
    let dropped = 0;
    for (const item of parsed) {
      const result = listingSchema.safeParse(item);
      if (result.success) listings.push(result.data);
      else dropped += 1;
    }
    return { listings, dropped };
  } catch {
    return { listings: [], dropped: 1 };
  }
}

export function readConditions(storage: StorageLike | null = browserStorage()): MyConditions {
  if (!storage) return DEFAULT_CONDITIONS;
  try {
    const raw = storage.getItem(CONDITIONS_KEY);
    if (!raw) return DEFAULT_CONDITIONS;
    const parsed: unknown = JSON.parse(raw);
    const result = conditionsSchema.safeParse(parsed);
    return result.success ? result.data : DEFAULT_CONDITIONS;
  } catch {
    return DEFAULT_CONDITIONS;
  }
}

export function saveListings(listings: Listing[], storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LISTINGS_KEY, JSON.stringify(listings));
    return true;
  } catch {
    return false;
  }
}

export function saveConditions(conditions: MyConditions, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CONDITIONS_KEY, JSON.stringify(conditions));
    return true;
  } catch {
    return false;
  }
}

export function createExport(listings: Listing[], conditions: MyConditions, exportedAt = new Date()): string {
  return JSON.stringify({
    schema: EXPORT_SCHEMA,
    version: 1,
    exportedAt: exportedAt.toISOString(),
    listings,
    conditions,
  }, null, 2);
}

export function downloadExport(listings: Listing[], conditions: MyConditions, now = new Date()): boolean {
  try {
    const blob = new Blob([createExport(listings, conditions, now)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${now.toISOString().slice(0, 10).replaceAll('-', '')}.listings.json`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export function importExport(
  input: unknown,
  current: Listing[],
  overwriteDuplicates: boolean,
): { listings: Listing[]; conditions: MyConditions } {
  const payload = exportSchema.parse(input);
  const incoming = new Map(payload.listings.map((listing) => [listing.id, listing]));
  const merged = new Map(current.map((listing) => [listing.id, listing]));
  for (const [id, listing] of incoming) {
    if (!merged.has(id) || overwriteDuplicates) merged.set(id, listing);
  }
  return { listings: [...merged.values()], conditions: payload.conditions };
}

export function importedDuplicateIds(input: unknown, current: Listing[]): string[] {
  const payload = exportSchema.parse(input);
  const currentIds = new Set(current.map((listing) => listing.id));
  return [...new Set(payload.listings.filter((listing) => currentIds.has(listing.id)).map((listing) => listing.id))];
}

export async function readImportFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}
