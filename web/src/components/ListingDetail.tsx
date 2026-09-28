import { useEffect, useState, type ReactNode } from 'react';
import valuationJson from '../config/valuation.json';
import type { HazardResult, Listing, LocalListing, Meta, RegionIndex, Transaction, Municipality, MyConditions, PriceIndex, ValuationConfig } from '../types';
import { formatManYen, formatPct, formatPeriod, formatPpsqm, labelText, seismicText } from '../lib/format';
import { listingSeismic } from '../lib/valuation';
import { useEvaluation } from '../lib/useEvaluation';
import { buildChecklist } from '../lib/checklist';
import Checklist from './Checklist';
import HazardPanel from './HazardPanel';
import { lookupHazard } from '../lib/hazard';
import { listingRegionChange } from '../lib/regionIndex';
import ComparableCharts from './ComparableCharts';
import ComparableTable from './ComparableTable';
import PaymentCard from './PaymentCard';
import PriceHistory from './PriceHistory';

const valuationConfig = valuationJson as ValuationConfig;
// 位置がおおよその物件は地点判定しない
const NOT_JUDGED: HazardResult = { flood: { status: 'no_location' }, stormSurge: { status: 'no_location' }, tsunami: { status: 'no_location' }, landslide: { status: 'no_location' } };
// LUNA_TASKS.md §5.7 の常時表示する注意書き
const EVALUATION_NOTICE = '国交省の成約事例との比較です。階数・向き・眺望・室内の状態・管理の状態は比較に含まれていません。購入の判断には、物件の現地確認、重要事項説明、資金計画の確認が必要です。';

interface ListingDetailProps {
  listing: Listing;
  municipalities: Municipality[];
  priceIndex: PriceIndex | null;
  meta: Meta | null;
  conditions: MyConditions;
  onBack: () => void;
  /** 無ければ編集ボタンを出さない（手元データの物件） */
  onEdit?: () => void;
  /** 無ければ価格の記録フォームを出さない */
  onUpdate?: (listing: Listing) => void;
  /** 手元データの物件だけが渡す（チェックリストの土地権利） */
  landRights?: string | null;
  backLabel?: string;
  actions?: ReactNode;
  notes?: ReactNode;
  /** false なら位置がおおよそのためハザードの地点判定をしない */
  allowHazard?: boolean;
  /** 地域別の時点修正と騰落の表示（地域の動き） */
  timeAdjust?: (tx: Transaction) => number | null;
  regionIndex?: RegionIndex | null;
  trendBasePos?: number;
}

function yenMonthly(listing: Listing): string {
  if (listing.managementFeeYen === null || listing.repairReserveYen === null) return '不明';
  return `${(listing.managementFeeYen + listing.repairReserveYen).toLocaleString('ja-JP')}円/月`;
}

export default function ListingDetail({ listing, municipalities, priceIndex, meta, conditions, onBack, onEdit, onUpdate, landRights, backLabel = '← 物件一覧へ', actions, notes, allowHazard = true, timeAdjust, regionIndex, trendBasePos }: ListingDetailProps) {
  const { evaluation, transactions, loading, error } = useEvaluation({
    listing,
    municipalities,
    priceIndex,
    latestPeriod: meta?.periodTo ?? '',
    negotiationRate: conditions.negotiationRate,
    config: valuationConfig,
    timeAdjust,
  });
  const region = regionIndex && trendBasePos !== undefined
    ? listingRegionChange(regionIndex, listing as Listing | LocalListing, municipalities, trendBasePos) : null;
  const municipalityName = municipalities.find((item) => item.code === listing.municipalityCode)?.name ?? '不明';
  const latest = listing.priceHistory.at(-1);
  const ppsqm = latest ? latest.priceYen / listing.areaSqm : null;
  const [hazard, setHazard] = useState<HazardResult | null>(null);
  const [hazardLoading, setHazardLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHazard(null);
    if (!allowHazard) return;
    setHazardLoading(true);
    void lookupHazard(listing.lat, listing.lon).then((result) => { if (!cancelled) setHazard(result); })
      .catch(() => { if (!cancelled) setHazard(null); })
      .finally(() => { if (!cancelled) setHazardLoading(false); });
    return () => { cancelled = true; };
  }, [listing.lat, listing.lon, allowHazard]);
  const checklist = buildChecklist({ listing, evaluation, hazard: allowHazard ? hazard : NOT_JUDGED, conditions, config: valuationConfig, ...(landRights === undefined ? {} : { landRights }) });

  return (
    <>
      <section className="content-section listing-detail">
        <div className="section-heading section-heading--content">
          <div><button type="button" className="text-button" onClick={onBack}>{backLabel}</button><h2>{listing.name || '名称未入力'}</h2></div>
          <div className="form-actions">{actions}{onEdit ? <button type="button" className="button button--quiet" onClick={onEdit}>編集</button> : null}</div>
        </div>
        <section className="detail-card">
          <h3>基本情報</h3>
          <dl className="detail-grid">
            <div><dt>市区町村</dt><dd>{municipalityName}</dd></div>
            <div><dt>住所</dt><dd>{listing.addressText || '不明'}</dd></div>
            <div><dt>売出価格</dt><dd>{latest ? formatManYen(latest.priceYen) : '不明'}（{latest?.date ?? '確認日不明'}）</dd></div>
            <div><dt>㎡単価</dt><dd>{ppsqm === null ? '不明' : formatPpsqm(ppsqm)}</dd></div>
            <div><dt>専有面積</dt><dd>{listing.areaSqm.toFixed(1)}㎡</dd></div>
            <div><dt>築年・耐震区分</dt><dd>{listing.buildingYear === null ? '築年不明' : `${listing.buildingYear}年${listing.buildingMonth ? `${listing.buildingMonth}月` : ''}`}・{seismicText(listingSeismic(listing.buildingYear))}</dd></div>
            <div><dt>最寄駅・徒歩</dt><dd>{listing.station || '不明'}{listing.walkMinutes === null ? '' : `・徒歩${listing.walkMinutes}分`}</dd></div>
            <div><dt>管理費＋修繕積立金</dt><dd>{yenMonthly(listing)}</dd></div>
            <div><dt>所在階</dt><dd>{listing.floor === null ? '不明' : `${listing.floor}階${listing.totalFloors === null ? '' : ` / ${listing.totalFloors}階建`}`}</dd></div>
            <div><dt>間取り</dt><dd>{listing.floorPlan || '不明'}</dd></div>
            <div><dt>リフォーム</dt><dd>{listing.renovation.status === 'renovated' ? `実施済み${listing.renovation.year ? `（${listing.renovation.year}年）` : ''}` : listing.renovation.status === 'not_renovated' ? '未改装' : '不明'}{listing.renovation.scope ? `・${listing.renovation.scope}` : ''}{listing.renovation.evidence ? `・根拠: ${listing.renovation.evidence}` : ''}</dd></div>
            <div><dt>掲載ページ</dt><dd>{listing.sourceUrl ? <a href={listing.sourceUrl} target="_blank" rel="noopener noreferrer">別タブで開く</a> : '未登録'}</dd></div>
          </dl>
          {listing.memo ? <p className="detail-memo">メモ: {listing.memo}</p> : null}
          {notes}
        </section>

        <PaymentCard listing={listing} conditions={conditions} />

        <section className="detail-card evaluation-card">
          <h3>相場との比較</h3>
          {loading ? <p>比較事例を読み込み中です。</p> : error ? <p className="inline-error" role="alert">{error}</p> : !evaluation ? <p>相場を計算できません。</p> : (
            <>
              <p className={`evaluation-label evaluation-label--${evaluation.label}`}><strong>{labelText(evaluation.label)}</strong><span>信頼度 {evaluation.confidence}</span></p>
              <div className="evaluation-stats">
                <p><span>相場との差</span><strong>{evaluation.gapPct === null ? '保留' : formatPct(evaluation.gapPct)}</strong></p>
                <p><span>推定価格</span><strong>{evaluation.estimatedPrice === null ? '保留' : formatManYen(evaluation.estimatedPrice)}</strong></p>
                <p><span>推定レンジ</span><strong>{evaluation.estimatedLow === null || evaluation.estimatedHigh === null ? '保留' : `${formatManYen(evaluation.estimatedLow)}〜${formatManYen(evaluation.estimatedHigh)}`}</strong></p>
                <p><span>比較件数</span><strong>{evaluation.stats?.n ?? 0}件</strong></p>
                {conditions.negotiationRate !== 0 ? <p><span>売出価格のままの場合</span><strong>{evaluation.gapPctAsking === null ? '保留' : formatPct(evaluation.gapPctAsking)}</strong></p> : null}
              </div>
              {evaluation.relaxations.length > 0 ? <p><strong>条件の緩和:</strong> {evaluation.relaxations.join('、')}</p> : null}
              {evaluation.holdReasons.length > 0 ? <p><strong>判定保留の理由:</strong> {evaluation.holdReasons.join('、')}</p> : null}
              <p><strong>比較上の注意:</strong> {evaluation.limitations.join('。')}。</p>
            </>
          )}
          {region && regionIndex && trendBasePos !== undefined ? (
            <p className="form-note">
              <strong>地域の動き：</strong>{region.series.name}{region.level === 'station' ? '駅周辺' : ''}は {formatPeriod(regionIndex.periods[trendBasePos])}比 {formatPct(region.changePct)}
              （関西平均との差 {region.vsAveragePt >= 0 ? '+' : ''}{region.vsAveragePt.toFixed(1)}pt{region.lowN ? '・件数が少なく参考値' : ''}）。比較事例の時点修正には地域別の指数を使っています。
            </p>
          ) : null}
          <p className="disclaimer">{EVALUATION_NOTICE}</p>
        </section>

        {evaluation && priceIndex ? <section className="detail-card"><h3>比較グラフ</h3><ComparableCharts listing={listing} evaluation={evaluation} transactions={transactions} latestPeriod={meta?.periodTo ?? ''} priceIndex={priceIndex} /></section> : null}
        {evaluation ? <section className="detail-card"><h3>比較事例</h3><ComparableTable evaluation={evaluation} /></section> : null}
        <HazardPanel hazard={hazard} loading={hazardLoading} allowed={allowHazard} />
        <Checklist items={checklist} />
      </section>
      <PriceHistory history={listing.priceHistory} onSave={onUpdate ? (priceHistory) => onUpdate({ ...listing, priceHistory, updatedAt: new Date().toISOString() }) : undefined} />
    </>
  );
}
