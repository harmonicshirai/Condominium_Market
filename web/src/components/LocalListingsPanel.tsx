import { useMemo, useState } from 'react';
import type { ChangeKind, ListingChange } from '../lib/changes';
import { countChanges } from '../lib/changes';
import ChangeBadge, { CHANGE_TEXT, formatCheckedAt } from './ChangeBadge';
import ListingCard from './ListingCard';
import FloorPlanImage from './FloorPlanImage';
import { paymentPlan } from '../lib/financing';
import { NARROW_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import type { Confidence, Evaluation, LocalListing, Municipality, MyConditions } from '../types';
import { formatManYen, formatPct, formatPpsqm, labelText, seismicText } from '../lib/format';
import { detailCommand, matchesConditions, type LocalData } from '../lib/localListings';
import { summarizePriceHistory } from '../lib/priceHistory';
import { listingSeismic } from '../lib/valuation';

interface LocalListingsPanelProps {
  data: LocalData;
  evaluations: ReadonlyMap<string, Evaluation>;
  evaluationsLoading: boolean;
  municipalities: Municipality[];
  conditions: MyConditions;
  starred: Set<string>;
  onToggleStar: (id: string) => void;
  onOpen: (listing: LocalListing) => void;
  today: string;
  /** 手元のサーバーのデータなら共有用ファイルを書き出せる */
  onExport?: () => void;
  /** 共有ファイルから読み込んだデータなら、読み直し・削除のボタンを出す */
  onReplace?: () => void;
  onClear?: () => void;
  /** 前回確認したときからの変化 */
  changes: ReadonlyMap<string, ListingChange>;
  checkedAt: string | null;
  /** このブラウザで初めてデータを見た（今のデータを基準にした） */
  firstCheck: boolean;
  onMarkChecked: () => void;
}

const CHANGE_KINDS: ChangeKind[] = ['new', 'price_down', 'price_up', 'removed'];
// スマホでは表の見出しで並べ替えられないので、選択肢で選ぶ
const SORT_OPTIONS: { key: SortKey; ascending: boolean; label: string }[] = [
  { key: 'gap', ascending: true, label: '相場比が低い順' },
  { key: 'gap', ascending: false, label: '相場比が高い順' },
  { key: 'price', ascending: true, label: '価格が安い順' },
  { key: 'price', ascending: false, label: '価格が高い順' },
  { key: 'ppsqm', ascending: true, label: '㎡単価が安い順' },
  { key: 'area', ascending: false, label: '面積が広い順' },
  { key: 'built', ascending: false, label: '築年が新しい順' },
  { key: 'walk', ascending: true, label: '駅に近い順' },
  { key: 'days', ascending: false, label: '掲載日数が長い順' },
  { key: 'days', ascending: true, label: '掲載日数が短い順' },
];

type SortKey = 'gap' | 'price' | 'ppsqm' | 'area' | 'built' | 'walk' | 'days';
const PAGE_SIZE = 50;
const CONFIDENCE_ORDER: Confidence[] = ['A', 'B', 'C', 'D'];

export default function LocalListingsPanel({ data, evaluations, evaluationsLoading, municipalities, conditions, starred, onToggleStar, onOpen, today, onExport, onReplace, onClear, changes, checkedAt, firstCheck, onMarkChecked }: LocalListingsPanelProps) {
  const [municipalityCode, setMunicipalityCode] = useState('');
  const [label, setLabel] = useState('');
  const [minConfidence, setMinConfidence] = useState<Confidence>('C');
  const [maxPriceMan, setMaxPriceMan] = useState('');
  const [minArea, setMinArea] = useState('');
  const [maxWalk, setMaxWalk] = useState('');
  const [minBuilt, setMinBuilt] = useState('');
  const [seismic, setSeismic] = useState('');
  const [status, setStatus] = useState<'active' | 'removed' | ''>('active');
  const [onlyMine, setOnlyMine] = useState(false);
  const [dedupe, setDedupe] = useState(true);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [changeFilter, setChangeFilter] = useState<'' | 'any' | ChangeKind>('');
  const [sortKey, setSortKey] = useState<SortKey>('gap');
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState('');
  const narrow = useMediaQuery(NARROW_QUERY);

  const rows = useMemo(() => {
    const minConfidenceIndex = CONFIDENCE_ORDER.indexOf(minConfidence);
    let filtered = data.listings.filter((listing) => {
      const evaluation = evaluations.get(listing.id);
      const price = listing.priceHistory.at(-1)?.priceYen ?? 0;
      const change = changes.get(listing.id);
      if (changeFilter && (changeFilter === 'any' ? !change : change?.kind !== changeFilter)) return false;
      // 変化で絞り込むときは、掲載終了になった物件も出す
      if (status && listing.status !== status && !(changeFilter && change)) return false;
      if (municipalityCode && listing.municipalityCode !== municipalityCode) return false;
      if (label && (evaluation?.label ?? 'hold') !== label) return false;
      if (label !== 'hold' && evaluation && CONFIDENCE_ORDER.indexOf(evaluation.confidence) > minConfidenceIndex) return false;
      if (maxPriceMan && price > Number(maxPriceMan) * 10_000) return false;
      if (minArea && listing.areaSqm < Number(minArea)) return false;
      if (maxWalk && (listing.walkMinutes === null || listing.walkMinutes > Number(maxWalk))) return false;
      if (minBuilt && (listing.buildingYear === null || listing.buildingYear < Number(minBuilt))) return false;
      if (seismic && listingSeismic(listing.buildingYear) !== seismic) return false;
      if (onlyMine && !matchesConditions(listing, evaluation, conditions)) return false;
      if (onlyStarred && !starred.has(listing.id)) return false;
      return true;
    });
    if (dedupe) {
      const cheapest = new Map<string, LocalListing>();
      for (const listing of filtered) {
        if (!listing.dupGroup) continue;
        const current = cheapest.get(listing.dupGroup);
        if (!current || (listing.priceHistory.at(-1)?.priceYen ?? 0) < (current.priceHistory.at(-1)?.priceYen ?? 0)) cheapest.set(listing.dupGroup, listing);
      }
      filtered = filtered.filter((listing) => !listing.dupGroup || cheapest.get(listing.dupGroup)?.id === listing.id);
    }
    const value = (listing: LocalListing): number | null => {
      const price = listing.priceHistory.at(-1)?.priceYen ?? 0;
      const evaluation = evaluations.get(listing.id);
      switch (sortKey) {
        case 'gap': return evaluation && evaluation.label !== 'hold' ? evaluation.gapPct : null;
        case 'price': return price;
        case 'ppsqm': return price / listing.areaSqm;
        case 'area': return listing.areaSqm;
        case 'built': return listing.buildingYear;
        case 'walk': return listing.walkMinutes;
        case 'days': return summarizePriceHistory(listing.priceHistory, today)?.daysListed ?? null;
      }
    };
    return [...filtered].sort((left, right) => {
      const a = value(left);
      const b = value(right);
      if (a === null && b === null) return 0;
      if (a === null) return 1; // 値のないものは常に後ろ
      if (b === null) return -1;
      return ascending ? a - b : b - a;
    });
  }, [data.listings, evaluations, municipalityCode, label, minConfidence, maxPriceMan, minArea, maxWalk, minBuilt, seismic, status, onlyMine, dedupe, onlyStarred, sortKey, ascending, conditions, starred, today, changes, changeFilter]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const municipalityName = (code: string) => municipalities.find((item) => item.code === code)?.name ?? code;
  const command = detailCommand(data.listings, starred, data.meta.detailCommandTemplate);
  const counts = data.meta.counts;
  const changeCounts = countChanges(changes);
  const changeTotal = CHANGE_KINDS.reduce((sum, kind) => sum + changeCounts[kind], 0);
  const savedChangeCounts = countChanges(changes, starred);
  const savedChanged = CHANGE_KINDS.filter((kind) => kind !== 'new' && savedChangeCounts[kind] > 0);
  const pickChange = (value: '' | 'any' | ChangeKind) => { setChangeFilter(value); setPage(0); };

  function sortBy(key: SortKey): void {
    if (sortKey === key) setAscending((value) => !value);
    else { setSortKey(key); setAscending(key !== 'built' && key !== 'days'); }
    setPage(0);
  }

  async function copyCommand(): Promise<void> {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied('コピーしました。リポジトリのルートで実行してください');
    } catch {
      setCopied(command);
    }
  }

  const header = (key: SortKey, text: string) => (
    <th><button type="button" className="sort-button" aria-pressed={sortKey === key} onClick={() => sortBy(key)}>{text}{sortKey === key ? (ascending ? ' ▲' : ' ▼') : ''}</button></th>
  );

  return (
    <section className="content-section">
      <div className="section-heading section-heading--content">
        <h2>掲載物件</h2>
        <span className="count-note">{data.meta.sourceName}・一覧取得 {data.meta.lastListRunAt ? new Date(data.meta.lastListRunAt).toLocaleString('ja-JP') : '不明'}</span>
      </div>
      <p className="form-note">
        掲載中 {counts.active}件・掲載終了 {counts.removed}件・詳細取得済み {counts.withDetail}件・正確な位置 {counts.exact}件・おおよその位置 {counts.approx}件。
        {data.origin === 'file'
          ? '共有ファイルから読み込んだデータです。このブラウザの中にだけ保存していて、サイトには送っていません。'
          : 'このデータはこのパソコンの中だけにあり、公開サイトには含まれません。'}
        {data.dropped ? `読み取れなかった物件が ${data.dropped}件あります。` : ''}
      </p>
      <div className="check-row">
        {onExport ? <button type="button" className="button button--quiet" onClick={onExport}>共有用ファイルを書き出す</button> : null}
        {onReplace ? <button type="button" className="button button--quiet" onClick={onReplace}>別のファイルを読み込む</button> : null}
        {onClear ? <button type="button" className="button button--quiet" onClick={onClear}>このブラウザから消す</button> : null}
      </div>
      {onExport ? <p className="form-note">書き出したファイルを家族などに送ると、公開サイトの「掲載物件」タブで読み込んで同じように見られます。</p> : null}
      <div className="change-banner" role="status">
        {firstCheck || !checkedAt ? (
          <p>今のデータを「確認済み」の基準にしました。次にデータが新しくなると、ここに新着・値下げ・掲載終了が出ます。</p>
        ) : changeTotal === 0 ? (
          <p>前回の確認（{formatCheckedAt(checkedAt)}）から変化はありません。</p>
        ) : (
          <>
            <p>前回の確認（{formatCheckedAt(checkedAt)}）からの変化：</p>
            <div className="change-banner__chips">
              {CHANGE_KINDS.map((kind) => changeCounts[kind] > 0 ? (
                <button key={kind} type="button" className={`badge badge--${kind} badge--button`} aria-pressed={changeFilter === kind} onClick={() => pickChange(changeFilter === kind ? '' : kind)}>{CHANGE_TEXT[kind]} {changeCounts[kind]}件</button>
              ) : null)}
              {changeFilter ? <button type="button" className="text-button" onClick={() => pickChange('')}>絞り込みを解除</button> : null}
            </div>
            {savedChanged.length > 0 ? <p className="change-banner__saved">保存した物件：{savedChanged.map((kind) => `${CHANGE_TEXT[kind]} ${savedChangeCounts[kind]}件`).join('・')}</p> : null}
            <button type="button" className="button button--quiet" onClick={() => { onMarkChecked(); pickChange(''); }}>すべて確認済みにする</button>
          </>
        )}
      </div>
      {evaluationsLoading ? <p className="data-empty-note" role="status">相場との比較を計算しています。</p> : null}
      <details className="filter-details" open={!narrow} key={narrow ? 'narrow' : 'wide'}>
      <summary>絞り込み{narrow ? '・並び順' : ''}</summary>
      {narrow ? (
        <label className="form-field sort-select">並び順
          <select value={`${sortKey}-${ascending ? 'asc' : 'desc'}`} onChange={(event) => {
            const option = SORT_OPTIONS.find((item) => `${item.key}-${item.ascending ? 'asc' : 'desc'}` === event.target.value);
            if (option) { setSortKey(option.key); setAscending(option.ascending); setPage(0); }
          }}>
            {SORT_OPTIONS.map((item) => <option key={`${item.key}-${item.ascending}`} value={`${item.key}-${item.ascending ? 'asc' : 'desc'}`}>{item.label}</option>)}
          </select>
        </label>
      ) : null}
      <div className="filter-row" aria-label="掲載物件を絞り込む">
        <label>市区町村<select value={municipalityCode} onChange={(event) => { setMunicipalityCode(event.target.value); setPage(0); }}><option value="">すべて</option>{[...new Set(data.listings.map((item) => item.municipalityCode))].map((code) => <option key={code} value={code}>{municipalityName(code)}</option>)}</select></label>
        <label>判定<select value={label} onChange={(event) => { setLabel(event.target.value); setPage(0); }}><option value="">すべて</option><option value="below">{labelText('below')}</option><option value="near">{labelText('near')}</option><option value="above">{labelText('above')}</option><option value="hold">判定保留</option></select></label>
        <label>信頼度（以上）<select value={minConfidence} onChange={(event) => { setMinConfidence(event.target.value as Confidence); setPage(0); }}>{CONFIDENCE_ORDER.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>価格上限（万円）<input type="number" min="0" value={maxPriceMan} onChange={(event) => { setMaxPriceMan(event.target.value); setPage(0); }} /></label>
        <label>面積下限（㎡）<input type="number" min="0" value={minArea} onChange={(event) => { setMinArea(event.target.value); setPage(0); }} /></label>
        <label>徒歩上限（分）<input type="number" min="0" value={maxWalk} onChange={(event) => { setMaxWalk(event.target.value); setPage(0); }} /></label>
        <label>築年（以降）<input type="number" min="1900" value={minBuilt} onChange={(event) => { setMinBuilt(event.target.value); setPage(0); }} /></label>
        <label>耐震<select value={seismic} onChange={(event) => { setSeismic(event.target.value); setPage(0); }}><option value="">すべて</option><option value="new">新耐震</option><option value="unknown">要確認</option><option value="old">旧耐震</option></select></label>
        <label>前回からの変化<select value={changeFilter} onChange={(event) => pickChange(event.target.value as '' | 'any' | ChangeKind)}><option value="">すべて</option><option value="any">変化があった物件</option>{CHANGE_KINDS.map((kind) => <option key={kind} value={kind}>{CHANGE_TEXT[kind]}</option>)}</select></label>
        <label>掲載<select value={status} onChange={(event) => { setStatus(event.target.value as 'active' | 'removed' | ''); setPage(0); }}><option value="active">掲載中のみ</option><option value="removed">掲載終了のみ</option><option value="">すべて</option></select></label>
      </div>
      <div className="check-row">
        <label><input type="checkbox" checked={onlyMine} onChange={(event) => { setOnlyMine(event.target.checked); setPage(0); }} />自分の条件に合うものだけ</label>
        <label><input type="checkbox" checked={dedupe} onChange={(event) => { setDedupe(event.target.checked); setPage(0); }} />重複候補は最安の1件だけ</label>
        <label><input type="checkbox" checked={onlyStarred} onChange={(event) => { setOnlyStarred(event.target.checked); setPage(0); }} />保存した物件だけ</label>
        {data.origin !== 'file' ? <button type="button" className="button button--quiet" disabled={!command} title="保存した物件のうち、詳細が未取得のものを取得するコマンド" onClick={() => void copyCommand()}>詳細取得コマンドをコピー</button> : null}
      </div>
      </details>
      {copied ? <p className="form-note" role="status">{copied}</p> : null}
      <p className="count-note">{rows.length}件（判定が保留の物件は、相場比の並べ替えで後ろに回ります）</p>
      {rows.length === 0 ? <p className="empty-state">条件に合う物件はありません</p> : narrow ? (
        <div className="card-list">{visible.map((listing) => {
          const plan = paymentPlan({ listing, negotiationRate: conditions.negotiationRate, closingCostRate: conditions.closingCostRate, budgetYen: conditions.budgetYen, settings: conditions.financing });
          return (
            <ListingCard
              key={listing.id}
              listing={listing}
              municipalityName={municipalityName(listing.municipalityCode)}
              evaluation={evaluations.get(listing.id)}
              today={today}
              onOpen={() => onOpen(listing)}
              saved={starred.has(listing.id)}
              onToggleSave={() => onToggleStar(listing.id)}
              totalCostYen={plan?.totalCostYen ?? null}
              removed={listing.status === 'removed'}
              floorPlanThumbUrl={listing.floorPlanThumbUrl}
              badges={changes.has(listing.id) || listing.status === 'removed' || listing.dupGroup ? <>
                <ChangeBadge change={changes.get(listing.id)} />
                {listing.status === 'removed' && !changes.has(listing.id) ? <span className="badge badge--removed">掲載終了</span> : null}
                {listing.dupGroup ? <span className="badge">重複候補あり</span> : null}
              </> : null}
            />
          );
        })}</div>
      ) : (
        <div className="table-wrap">
          <table className="listing-table">
            <thead><tr>
              <th aria-label="保存"></th><th>物件名</th><th>間取り</th><th>市区町村・駅</th>
              {header('price', '価格')}{header('ppsqm', '㎡単価')}{header('area', '面積')}{header('built', '築年')}{header('walk', '徒歩')}
              {header('gap', '相場比')}<th>判定</th>{header('days', '掲載日数')}<th>詳細</th>
            </tr></thead>
            <tbody>{visible.map((listing) => {
              const evaluation = evaluations.get(listing.id);
              const price = listing.priceHistory.at(-1)?.priceYen ?? 0;
              const history = summarizePriceHistory(listing.priceHistory, today);
              const isStarred = starred.has(listing.id);
              return (
                <tr key={listing.id} onClick={() => onOpen(listing)} className={listing.status === 'removed' ? 'row--removed' : undefined}>
                  <td><button type="button" className="star-button" aria-pressed={isStarred} aria-label={isStarred ? '保存を外す' : '保存する'} title={isStarred ? '保存を外す' : '保存する（保存・比較タブに集まります）'} onClick={(event) => { event.stopPropagation(); onToggleStar(listing.id); }}>{isStarred ? '★' : '☆'}</button></td>
                  <td><a href={listing.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{listing.name || '名称なし'}</a>{listing.status === 'removed' ? <><br /><small>掲載終了</small></> : null}{listing.dupGroup ? <><br /><small>重複候補あり</small></> : null}{changes.has(listing.id) ? <div className="row-badges"><ChangeBadge change={changes.get(listing.id)} /></div> : null}</td>
                  <td className="floor-plan-cell"><FloorPlanImage url={listing.floorPlanThumbUrl} size="thumb" /><small>{listing.floorPlan || '—'}</small></td>
                  <td>{municipalityName(listing.municipalityCode)}<br /><small>{listing.station || '駅不明'}</small></td>
                  <td>{formatManYen(price)}</td>
                  <td>{formatPpsqm(price / listing.areaSqm)}</td>
                  <td>{listing.areaSqm.toFixed(1)}㎡</td>
                  <td>{listing.buildingYear ?? '不明'}<br /><small>{seismicText(listingSeismic(listing.buildingYear)).split('（')[0]}</small></td>
                  <td>{listing.walkMinutes === null ? '不明' : `${listing.walkMinutes}分`}</td>
                  <td>{evaluation && evaluation.gapPct !== null && evaluation.label !== 'hold' ? formatPct(evaluation.gapPct) : '—'}</td>
                  <td>{labelText(evaluation?.label ?? 'hold')}<br /><small>信頼度 {evaluation?.confidence ?? '—'}</small></td>
                  <td>{history ? `${history.daysListed}日` : '—'}{history && history.changeCount > 0 ? <><br /><small>値下げ等 {history.changeCount}回</small></> : null}</td>
                  <td>{listing.detailFetchedAt ? '取得済み' : '未取得'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {pageCount > 1 ? (
        <div className="pager">
          <button type="button" className="button button--quiet" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前へ</button>
          <span>{currentPage + 1} / {pageCount}ページ</span>
          <button type="button" className="button button--quiet" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>次へ</button>
        </div>
      ) : null}
    </section>
  );
}
