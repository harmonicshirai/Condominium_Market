import type { Evaluation, Listing, LocalListing } from '../types';

export const COMPARE_KEY = 'keihan-mansion-map:v1:compare';
export const MAX_COMPARE = 4;

/** 保存・比較の画面に出す物件。local は掲載物件で保存したもの、mine は自分で登録した物件 */
export interface SavedItem {
  kind: 'local' | 'mine';
  listing: Listing;
  local: LocalListing | null;
  evaluation?: Evaluation;
}

/** 保存した掲載物件（保存した順）と、自分で登録した物件を並べる。データにない保存 ID は missing に数える */
export function collectSaved(
  localListings: LocalListing[],
  starred: Set<string>,
  mine: Listing[],
  localEvaluations: ReadonlyMap<string, Evaluation>,
  mineEvaluations: ReadonlyMap<string, Evaluation>,
): { items: SavedItem[]; missing: number } {
  const byId = new Map(localListings.map((listing) => [listing.id, listing]));
  const items: SavedItem[] = [];
  let missing = 0;
  for (const id of starred) {
    const local = byId.get(id);
    if (!local) { missing += 1; continue; }
    items.push({ kind: 'local', listing: local, local, evaluation: localEvaluations.get(id) });
  }
  for (const listing of mine) items.push({ kind: 'mine', listing, local: null, evaluation: mineEvaluations.get(listing.id) });
  return { items, missing };
}

/** 比較に入れる・外す。上限に達していれば追加しない */
export function toggleCompareId(ids: string[], id: string, max = MAX_COMPARE): string[] {
  if (ids.includes(id)) return ids.filter((item) => item !== id);
  return ids.length >= max ? ids : [...ids, id];
}

/** 比較表で一番よい値の列（2件以上に値があり、差があるときだけ） */
export function bestIndexes(values: (number | null)[], mode: 'min' | 'max'): Set<number> {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (present.length < 2 || present.every((value) => value === present[0])) return new Set();
  const best = mode === 'min' ? Math.min(...present) : Math.max(...present);
  return new Set(values.flatMap((value, index) => value === best ? [index] : []));
}

export function readCompare(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(COMPARE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

export function saveCompare(ids: string[]): void {
  try {
    window.localStorage.setItem(COMPARE_KEY, JSON.stringify(ids));
  } catch {
    // 保存できなくても表示は続ける
  }
}
