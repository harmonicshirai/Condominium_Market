import type { ChangeKind, ListingChange } from '../lib/changes';
import { formatManYen } from '../lib/format';

export const CHANGE_TEXT: Record<ChangeKind, string> = {
  new: '新着',
  price_down: '値下げ',
  price_up: '値上げ',
  removed: '掲載終了',
};

export function formatCheckedAt(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 前回確認したときからの変化の印 */
export default function ChangeBadge({ change }: { change?: ListingChange }) {
  if (!change) return null;
  const diff = change.diffYen === null ? '' : ` ${change.diffYen > 0 ? '+' : ''}${formatManYen(change.diffYen)}`;
  return <span className={`badge badge--${change.kind}`}>{CHANGE_TEXT[change.kind]}{diff}</span>;
}
