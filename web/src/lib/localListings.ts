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
  /** server: 手元のサーバー（web/public/local-data）、file: 共有ファイルから読み込んでこのブラウザに保存したもの */
  origin?: 'server' | 'file';
}

export const BUNDLE_SCHEMA = 'keihan-mansion-map/local-data';

function validate(metaInput: unknown, rows: unknown): LocalData | null {
  const meta = localMetaSchema.safeParse(metaInput);
  if (!meta.success || !Array.isArray(rows)) return null;
  const listings: LocalListing[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = localListingSchema.safeParse(row);
    if (parsed.success) listings.push(parsed.data as LocalListing);
    else dropped += 1;
  }
  return { meta: meta.data, listings, dropped };
}

/** 手元のデータ（web/public/local-data/）を読む。無ければ null（公開サイトでは常に null）。 */
export async function loadLocalData(fetcher: typeof fetch = fetch, base = import.meta.env.BASE_URL): Promise<LocalData | null> {
  try {
    const [metaResponse, listingsResponse] = await Promise.all([
      fetcher(`${base}local-data/meta.json`),
      fetcher(`${base}local-data/listings.json`),
    ]);
    if (!metaResponse.ok || !listingsResponse.ok) return null;
    const data = validate(await metaResponse.json(), await listingsResponse.json());
    return data ? { ...data, origin: 'server' } : null;
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

/** 共有用ファイル（家族などに送る）の中身。掲載物件と取得日などをまとめた JSON */
export function createBundle(data: LocalData, exportedAt = new Date()): string {
  return JSON.stringify({ schema: BUNDLE_SCHEMA, version: 1, exportedAt: exportedAt.toISOString(), meta: data.meta, listings: data.listings });
}

/** 共有用ファイルを読む。形が違えば例外（画面でそのまま表示する） */
export function parseBundle(text: string): LocalData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('ファイルを読み取れませんでした（JSON ではありません）');
  }
  const bundle = parsed as { schema?: unknown; version?: unknown; meta?: unknown; listings?: unknown };
  if (bundle?.schema !== BUNDLE_SCHEMA || bundle.version !== 1) {
    throw new Error('このサイトの「共有用ファイル」ではありません');
  }
  const data = validate(bundle.meta, bundle.listings);
  if (!data || data.listings.length === 0) throw new Error('ファイルに読み取れる物件がありません');
  return { ...data, origin: 'file' };
}

/** 共有用ファイルをダウンロードさせる */
export function downloadBundle(data: LocalData, now = new Date()): void {
  const blob = new Blob([createBundle(data, now)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  link.href = url;
  link.download = `掲載物件データ_${stamp}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 読み込んだ共有ファイルはこのブラウザの IndexedDB にだけ保存する（localStorage は容量が小さいため）
const DB_NAME = 'keihan-mansion-map';
const STORE = 'files';
const BUNDLE_KEY = 'local-data';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function saveStoredBundle(text: string): Promise<void> {
  await withStore('readwrite', (store) => store.put(text, BUNDLE_KEY));
}

export async function readStoredBundle(): Promise<LocalData | null> {
  try {
    const text = await withStore<unknown>('readonly', (store) => store.get(BUNDLE_KEY));
    return typeof text === 'string' ? parseBundle(text) : null;
  } catch {
    return null;
  }
}

export async function deleteStoredBundle(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(BUNDLE_KEY));
  } catch {
    // 消せなくても画面の表示は続ける
  }
}
