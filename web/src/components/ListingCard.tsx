import type { ReactNode } from 'react';
import type { Evaluation, Listing } from '../types';
import { formatManYen, formatPct, labelText, seismicText } from '../lib/format';
import { summarizePriceHistory } from '../lib/priceHistory';
import { listingSeismic } from '../lib/valuation';

interface ListingCardProps {
  listing: Listing;
  municipalityName: string;
  evaluation?: Evaluation;
  today: string;
  onOpen: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
  /** 一括で払う額（諸費用込み） */
  totalCostYen?: number | null;
  removed?: boolean;
  badges?: ReactNode;
  footer?: ReactNode;
}

/** スマホや保存一覧で使う物件のカード（表の1行分） */
export default function ListingCard({ listing, municipalityName, evaluation, today, onOpen, saved, onToggleSave, totalCostYen, removed, badges, footer }: ListingCardProps) {
  const price = listing.priceHistory.at(-1)?.priceYen ?? 0;
  const history = summarizePriceHistory(listing.priceHistory, today);
  const label = evaluation?.label ?? 'hold';
  return (
    <article className={`listing-card${removed ? ' listing-card--removed' : ''}`}>
      <div className="listing-card__head">
        <button type="button" className="listing-card__name" onClick={onOpen}>{listing.name || '名称なし'}</button>
        {onToggleSave ? (
          <button type="button" className="star-button" aria-pressed={saved} aria-label={saved ? '保存を外す' : '保存する'} onClick={onToggleSave}>{saved ? '★' : '☆'}<span>{saved ? '保存済み' : '保存'}</span></button>
        ) : null}
      </div>
      <p className="listing-card__place">{municipalityName}・{listing.station || '駅不明'}{listing.walkMinutes === null ? '' : ` 徒歩${listing.walkMinutes}分`}</p>
      <p className="listing-card__main">
        <strong>{formatManYen(price)}</strong>
        <span>{listing.areaSqm.toFixed(1)}㎡{listing.floorPlan ? ` ${listing.floorPlan}` : ''}</span>
        <span>{listing.buildingYear ?? '築年不明'}{listing.buildingYear ? '年' : ''} {seismicText(listingSeismic(listing.buildingYear)).split('（')[0]}</span>
      </p>
      <p className={`listing-card__label evaluation-label--${label}`}>
        <strong>{evaluation && evaluation.gapPct !== null && label !== 'hold' ? `相場比 ${formatPct(evaluation.gapPct)}` : '相場比 —'}</strong>
        <span>{labelText(label)}{evaluation ? `（信頼度 ${evaluation.confidence}）` : ''}</span>
      </p>
      <p className="listing-card__meta">
        {totalCostYen ? `諸費用込み ${formatManYen(totalCostYen)}` : null}
        {history ? `${totalCostYen ? '・' : ''}掲載 ${history.daysListed}日${history.changeCount > 0 ? `・価格変更 ${history.changeCount}回` : ''}` : null}
        {listing.sourceUrl ? <> ・<a href={listing.sourceUrl} target="_blank" rel="noopener noreferrer">掲載ページ</a></> : null}
      </p>
      {badges ? <div className="listing-card__badges">{badges}</div> : null}
      {footer ? <div className="listing-card__footer">{footer}</div> : null}
    </article>
  );
}
