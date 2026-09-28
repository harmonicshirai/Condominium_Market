import type { ReactNode } from 'react';
import type { Municipality, MyConditions } from '../types';
import { paymentPlan } from '../lib/financing';
import { MAX_COMPARE, type SavedItem } from '../lib/saved';
import CompareTable from './CompareTable';
import ListingCard from './ListingCard';

interface SavedPanelProps {
  items: SavedItem[];
  missing: number;
  compareIds: string[];
  conditions: MyConditions;
  municipalities: Municipality[];
  today: string;
  onToggleCompare: (id: string) => void;
  onOpen: (item: SavedItem) => void;
  onUnsave: (item: SavedItem) => void;
  /** 物件ごとの変化の印（新着・値下げなど） */
  badgesFor?: (item: SavedItem) => ReactNode;
}

export default function SavedPanel({ items, missing, compareIds, conditions, municipalities, today, onToggleCompare, onOpen, onUnsave, badgesFor }: SavedPanelProps) {
  const compared = compareIds.map((id) => items.find((item) => item.listing.id === id)).filter((item): item is SavedItem => Boolean(item));
  const full = compared.length >= MAX_COMPARE;
  const municipalityName = (code: string) => municipalities.find((item) => item.code === code)?.name ?? code;
  return (
    <section className="content-section">
      <div className="section-heading section-heading--content">
        <h2>保存・比較</h2>
        <span className="count-note">{items.length}件</span>
      </div>
      <p className="form-note">
        掲載物件で☆を押して保存した物件と、「自分の物件」に登録した物件です。保存はこのブラウザにだけ残ります。
        {missing ? ` 保存した物件のうち ${missing}件は、今のデータに見つかりません。` : ''}
      </p>

      {compared.length > 0 ? (
        <>
          <h3 className="saved-heading">比較（{compared.length}件）</h3>
          <p className="form-note">緑の太字は、比べた中で一番よい値（安い・広い・新しい・駅に近い）です。</p>
          <CompareTable items={compared} conditions={conditions} municipalities={municipalities} today={today} onOpen={onOpen} onRemove={(item) => onToggleCompare(item.listing.id)} />
        </>
      ) : items.length > 0 ? <p className="empty-state">下の物件で「比較する」を選ぶと、ここに並べて比べられます（{MAX_COMPARE}件まで）。</p> : null}

      <h3 className="saved-heading">保存した物件</h3>
      {items.length === 0 ? <p className="empty-state">まだ保存した物件はありません。「掲載物件」の一覧で☆を押すと、ここに集まります。</p> : (
        <div className="card-grid">{items.map((item) => {
          const inCompare = compareIds.includes(item.listing.id);
          const plan = paymentPlan({ listing: item.listing, negotiationRate: conditions.negotiationRate, closingCostRate: conditions.closingCostRate, budgetYen: conditions.budgetYen, settings: conditions.financing });
          return (
            <ListingCard
              key={item.listing.id}
              listing={item.listing}
              municipalityName={municipalityName(item.listing.municipalityCode)}
              evaluation={item.evaluation}
              today={today}
              onOpen={() => onOpen(item)}
              totalCostYen={plan?.totalCostYen ?? null}
              removed={item.local?.status === 'removed'}
              badges={<>{item.kind === 'mine' ? <span className="badge">自分で登録</span> : null}{item.local?.status === 'removed' ? <span className="badge badge--removed">掲載終了</span> : null}{badgesFor?.(item)}</>}
              footer={<>
                <label className="check-inline"><input type="checkbox" checked={inCompare} disabled={!inCompare && full} onChange={() => onToggleCompare(item.listing.id)} />比較する</label>
                {item.kind === 'local' ? <button type="button" className="text-button text-button--danger" onClick={() => onUnsave(item)}>保存を外す</button> : null}
              </>}
            />
          );
        })}</div>
      )}
    </section>
  );
}
