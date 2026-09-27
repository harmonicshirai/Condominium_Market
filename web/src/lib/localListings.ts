import { z } from 'zod';
import type { Evaluation, Listing, LocalListing, LocalMeta, MyConditions } from '../types';
import { listingBaseSchema } from './storage';

export const STARRED_KEY = 'keihan-mansion-map:v1:starred';

const localListingSchema = listingBaseSchema.extend({
  floor: z.number().int().nullable(), // 地下階は負の数
  sourceName: z.string(),
  externalId: z.string().min(1),
  line: z.string().nullable().optional(),
  status: z.enum(['active', 'removed']),
  firstSeen: z.string().min(1),
  lastSeen: z.string().min(1),
  locationPrecision: z.enum(['exact', 'approx', 'none']),
  areaBasis: z.enum(['壁芯', '内法']).nullable(),
  landRights: z.string().nullable(),
  totalUnits: z.number().int().nonnegative().nullable(),
  direction: z.string().nullable(),
  dupGroup: z.string().nullable(),
  detailFetchedAt: z.string().nullable(),
});

const localMetaSchema = z.object({
  generatedAt: z.string(),
  sourceName: z.string(),
  lastListRunAt: z.string().nullable(),
  counts: z.object({ active: z.number(), removed: z.number(), withDetail: z.number(), exact: z.number(), approx: z.number() }),
  detailCommandTemplate: z.string(),
});

export interface LocalData {
  meta: LocalMeta;
  listings: LocalListing[];
  dropped: number;
}

/** 手元のデータ（web/public/local-data/）を読む。無ければ null（公開サイトでは常に null）。 */
export async function loadLocalData(fetcher: typeof fetch = fetch, base = import.meta.env.BASE_URL): Promise<LocalData | null> {
  try {
    const [metaResponse, listingsResponse] = await Promise.all([
      fetcher(`${base}local-data/meta.json`),
      fetcher(`${base}local-data/listings.json`),
    ]);
    if (!metaResponse.ok || !listingsResponse.ok) return null;
    const meta = localMetaSchema.safeParse(await metaResponse.json());
    const rows: unknown = await listingsResponse.json();
    if (!meta.success || !Array.isArray(rows)) return null;
    const listings: LocalListing[] = [];
    let dropped = 0;
    for (const row of rows) {
      const parsed = localListingSchema.safeParse(row);
      if (parsed.success) listings.push(parsed.data as LocalListing);
      else dropped += 1;
    }
    return { meta: meta.data, listings, dropped };
  } catch {
    return null;
  }
}

/** 自分の物件として保存できる形にする（手元データ固有の項目は落とす）。 */
export function toMyListing(local: LocalListing, now = new Date(), newId: () => string = () => crypto.randomUUID()): Listing {
  const listing: Listing = {
    id: newId(),
    name: local.name,
    sourceUrl: local.sourceUrl,
    municipalityCode: local.municipalityCode,
    addressText: local.addressText,
    lat: local.lat,
    lon: local.lon,
    station: local.station,
    walkMinutes: local.walkMinutes,
    areaSqm: local.areaSqm,
    buildingYear: local.buildingYear,
    buildingMonth: local.buildingMonth,
    floor: local.floor !== null && local.floor < 0 ? null : local.floor,
    totalFloors: local.totalFloors,
    floorPlan: local.floorPlan,
    managementFeeYen: local.managementFeeYen,
    repairReserveYen: local.repairReserveYen,
    renovation: { ...local.renovation },
    priceHistory: local.priceHistory.map((item) => ({ ...item })),
    memo: `${local.sourceName}から追加（${local.externalId}）`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return listing;
}

/** 自分の条件（予算・面積・徒歩・月額費用）をすべて満たすか。条件か物件の値が null の項目は判定しない。 */
export function matchesConditions(listing: Listing, evaluation: Evaluation | undefined, conditions: MyConditions): boolean {
  const asking = listing.priceHistory.at(-1)?.priceYen ?? null;
  const effective = evaluation?.effectivePrice ?? (asking === null ? null : asking * (1 - conditions.negotiationRate));
  if (conditions.budgetYen !== null && effective !== null && effective * (1 + conditions.closingCostRate) > conditions.budgetYen) return false;
  if (conditions.minAreaSqm !== null && listing.areaSqm < conditions.minAreaSqm) return false;
  if (conditions.maxWalkMinutes !== null && listing.walkMinutes !== null && listing.walkMinutes > conditions.maxWalkMinutes) return false;
  if (conditions.maxMonthlyFeesYen !== null && listing.managementFeeYen !== null && listing.repairReserveYen !== null
    && listing.managementFeeYen + listing.repairReserveYen > conditions.maxMonthlyFeesYen) return false;
  return true;
}

export function readStarred(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STARRED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveStarred(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STARRED_KEY, JSON.stringify([...ids]));
  } catch {
    // 保存できなくても表示は続ける
  }
}

/** 星付きで詳細未取得の物件の ID を入れた取得コマンド。 */
export function detailCommand(listings: LocalListing[], starred: Set<string>, template: string): string | null {
  const ids = listings.filter((item) => starred.has(item.id) && item.detailFetchedAt === null).map((item) => item.externalId);
  return ids.length ? template.replace('{ids}', ids.join(',')) : null;
}
