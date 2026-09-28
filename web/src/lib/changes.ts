import type { LocalListing } from '../types';

/**
 * 掲載物件の「前回確認したときから」の変化（新着・値下げ・値上げ・掲載終了）。
 * 確認した時点の価格と掲載状態を、このブラウザにだけ保存して比べる（取得の頻度に左右されない）。
 */
export const SEEN_KEY_PREFIX = 'keihan-mansion-map:v1:seen:';

export interface SeenSnapshot {
  version: 1;
  checkedAt: string;
  /** 物件 ID → [価格, 掲載終了なら 1] */
  items: Record<string, [number, 0 | 1]>;
}

export type ChangeKind = 'new' | 'price_down' | 'price_up' | 'removed';

export interface ListingChange {
  kind: ChangeKind;
  previousPriceYen: number | null;
  /** 価格の差（今 − 前回） */
  diffYen: number | null;
}

const currentPrice = (listing: LocalListing) => listing.priceHistory.at(-1)?.priceYen ?? 0;

export function takeSnapshot(listings: LocalListing[], checkedAt: string): SeenSnapshot {
  const items: SeenSnapshot['items'] = {};
  for (const listing of listings) items[listing.id] = [currentPrice(listing), listing.status === 'removed' ? 1 : 0];
  return { version: 1, checkedAt, items };
}

export function diffListings(listings: LocalListing[], snapshot: SeenSnapshot): Map<string, ListingChange> {
  const changes = new Map<string, ListingChange>();
  for (const listing of listings) {
    const previous = snapshot.items[listing.id];
    const price = currentPrice(listing);
    if (!previous) {
      if (listing.status === 'active') changes.set(listing.id, { kind: 'new', previousPriceYen: null, diffYen: null });
      continue;
    }
    const [previousPrice, previousRemoved] = previous;
    if (listing.status === 'removed') {
      if (previousRemoved === 0) changes.set(listing.id, { kind: 'removed', previousPriceYen: previousPrice, diffYen: null });
      continue;
    }
    // 掲載終了から掲載中に戻った物件は新着として扱う
    if (previousRemoved === 1) changes.set(listing.id, { kind: 'new', previousPriceYen: previousPrice, diffYen: null });
    else if (price !== previousPrice) {
      changes.set(listing.id, { kind: price < previousPrice ? 'price_down' : 'price_up', previousPriceYen: previousPrice, diffYen: price - previousPrice });
    }
  }
  return changes;
}

export function countChanges(changes: ReadonlyMap<string, ListingChange>, ids?: Iterable<string>): Record<ChangeKind, number> {
  const counts: Record<ChangeKind, number> = { new: 0, price_down: 0, price_up: 0, removed: 0 };
  if (ids) {
    for (const id of ids) {
      const change = changes.get(id);
      if (change) counts[change.kind] += 1;
    }
  } else {
    for (const change of changes.values()) counts[change.kind] += 1;
  }
  return counts;
}

function parseSnapshot(raw: string | null): SeenSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SeenSnapshot>;
    return parsed?.version === 1 && typeof parsed.checkedAt === 'string' && parsed.items && typeof parsed.items === 'object'
      ? parsed as SeenSnapshot : null;
  } catch {
    return null;
  }
}

export function readSnapshot(sourceName: string): SeenSnapshot | null {
  try {
    return parseSnapshot(window.localStorage.getItem(SEEN_KEY_PREFIX + sourceName));
  } catch {
    return null;
  }
}

export function saveSnapshot(sourceName: string, snapshot: SeenSnapshot): boolean {
  try {
    window.localStorage.setItem(SEEN_KEY_PREFIX + sourceName, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}
