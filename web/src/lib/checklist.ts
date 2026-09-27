import type { CheckItem, Evaluation, FloodResult, HazardResult, Listing, MyConditions, ValuationConfig } from '../types';
import { listingSeismic } from './valuation';

export interface BuildChecklistArgs {
  listing: Listing;
  evaluation: Evaluation | null;
  hazard: HazardResult | null;
  conditions: MyConditions;
  config: ValuationConfig;
  landRights?: string | null;
}

function latestAskingPrice(listing: Listing): number | null {
  return listing.priceHistory.at(-1)?.priceYen ?? null;
}

export function buildChecklist({ listing, evaluation, hazard, conditions, config, landRights }: BuildChecklistArgs): CheckItem[] {
  const priceGap: CheckItem = evaluation?.label === 'below' || evaluation?.label === 'near'
    ? { id: 'price_gap', category: 'price', label: '相場との比較', status: 'ok', detail: `${evaluation.gapPct === null ? '判定保留' : `${evaluation.gapPct.toFixed(1)}%`}・信頼度${evaluation.confidence}` }
    : evaluation?.label === 'above'
      ? { id: 'price_gap', category: 'price', label: '相場との比較', status: 'warn', detail: `${evaluation.gapPct?.toFixed(1) ?? '不明'}%・信頼度${evaluation.confidence}` }
      : { id: 'price_gap', category: 'price', label: '相場との比較', status: 'unknown', detail: evaluation?.holdReasons.join('、') || '評価データがありません' };

  const seismic = listingSeismic(listing.buildingYear);
  const monthlyFees = listing.managementFeeYen !== null && listing.repairReserveYen !== null
    ? listing.managementFeeYen + listing.repairReserveYen
    : null;
  const reserveRatio = listing.areaSqm > 0 && listing.repairReserveYen !== null
    ? listing.repairReserveYen / listing.areaSqm
    : null;
  const reserveGuideline = config.checklist.repairReserveGuidelineYenPerSqm;
  const currentPrice = latestAskingPrice(listing);
  const effectivePrice = evaluation?.effectivePrice ?? (currentPrice === null ? null : currentPrice * (1 - conditions.negotiationRate));
  const budgetTotal = effectivePrice === null ? null : effectivePrice * (1 + conditions.closingCostRate);

  // 洪水・高潮・津波は同じ規則（T11 の flood の規則）
  const depthItem = (id: string, label: string, result: FloodResult | undefined, noneDetail: string): CheckItem => {
    const deepLowFloor = result?.status === 'in' && listing.floor !== null && listing.floor <= 2 && result.minM >= 3;
    const status = !result || result.status === 'out_of_coverage' || result.status === 'no_location'
      ? 'unknown' : result.status === 'none' ? 'ok' : deepLowFloor ? 'ng' : 'warn';
    const detail = !result ? '未取得' : result.status === 'in'
      ? `${result.label}${deepLowFloor ? '・所在階が2階以下のため浸水の影響を確認' : ''}`
      : result.status === 'none' ? noneDetail
        : result.status === 'no_location' ? '位置がないか、おおよそのため判定していません' : '判定できる範囲のデータがありません';
    return { id, category: 'hazard', label, status, detail };
  };
  const landslide = hazard?.landslide;
  const landslideStatus = !landslide || landslide.status === 'out_of_coverage' || landslide.status === 'no_location'
    ? 'unknown'
    : landslide.status === 'none' ? 'ok'
      : landslide.zone === 'special' ? 'ng' : 'warn';
  const landslideDetail = !landslide ? '未取得' : landslide.status === 'in'
    ? landslide.zone === 'special' ? '土砂災害特別警戒区域' : '土砂災害警戒区域'
    : landslide.status === 'none' ? '区域外' : '判定できる位置・範囲のデータがありません';

  return [
    priceGap,
    {
      id: 'seismic', category: 'building', label: '耐震区分',
      status: seismic === 'new' ? 'ok' : seismic === 'old' ? 'ng' : 'warn',
      detail: seismic === 'new' ? '新耐震相当。建築確認日も確認してください' : seismic === 'old' ? '旧耐震相当。耐震診断・補強状況を確認してください' : '1981年6月以降の建築確認かを確認',
    },
    {
      id: 'tax_area', category: 'building', label: '住宅ローン控除の面積要件',
      status: listing.areaSqm >= config.checklist.areaOkSqm ? 'ok' : 'warn',
      detail: listing.areaSqm >= config.checklist.areaOkSqm
        ? `${listing.areaSqm.toFixed(1)}㎡（登記簿の床面積と最新の要件を確認してください）`
        : `広告面積 ${listing.areaSqm.toFixed(1)}㎡。住宅ローン控除は登記簿の床面積（内法）で判断され、広告の面積（壁芯）より小さくなります。最新の要件を確認してください`,
    },
    {
      id: 'repair_reserve', category: 'building', label: '修繕積立金',
      status: listing.repairReserveYen === 0 ? 'ng'
        : listing.repairReserveYen === null || reserveGuideline === null ? 'unknown'
        : (reserveRatio ?? 0) < reserveGuideline * config.checklist.repairReserveWarnRatio ? 'warn' : 'ok',
      detail: listing.repairReserveYen === 0 ? '修繕積立金がありません。大規模修繕の費用を一時金で求められる可能性が高いので、管理組合の修繕計画を確認してください'
        : listing.repairReserveYen === null || reserveGuideline === null ? '基準値が未設定、または修繕積立金が未入力'
        : (reserveRatio ?? 0) < reserveGuideline * config.checklist.repairReserveWarnRatio ? '将来の値上げや一時金の可能性を確認してください' : '設定した基準値以上です。長期修繕計画も確認してください',
    },
    depthItem('flood', '洪水', hazard?.flood, '区域外。ただし未整備の河川もあります'),
    depthItem('storm_surge', '高潮', hazard?.stormSurge, '区域外'),
    depthItem('tsunami', '津波', hazard?.tsunami, '区域外'),
    { id: 'landslide', category: 'hazard', label: '土砂災害', status: landslideStatus, detail: landslideDetail },
    {
      id: 'budget', category: 'mine', label: '予算（諸費用込み）',
      status: conditions.budgetYen === null || budgetTotal === null ? 'unknown' : budgetTotal <= conditions.budgetYen ? 'ok' : 'warn',
      detail: conditions.budgetYen === null ? '予算が未設定' : budgetTotal === null ? '価格が未入力' : `${Math.round(budgetTotal).toLocaleString('ja-JP')}円（設定予算 ${conditions.budgetYen.toLocaleString('ja-JP')}円）`,
    },
    {
      id: 'min_area', category: 'mine', label: '最低面積',
      status: conditions.minAreaSqm === null ? 'unknown' : listing.areaSqm >= conditions.minAreaSqm ? 'ok' : 'warn',
      detail: conditions.minAreaSqm === null ? '条件が未設定' : `${listing.areaSqm.toFixed(1)}㎡（条件 ${conditions.minAreaSqm}㎡）`,
    },
    {
      id: 'walk', category: 'mine', label: '駅徒歩',
      status: conditions.maxWalkMinutes === null || listing.walkMinutes === null ? 'unknown' : listing.walkMinutes <= conditions.maxWalkMinutes ? 'ok' : 'warn',
      detail: conditions.maxWalkMinutes === null ? '条件が未設定' : listing.walkMinutes === null ? '徒歩分数が未入力' : `${listing.walkMinutes}分（上限 ${conditions.maxWalkMinutes}分）`,
    },
    {
      id: 'monthly_fees', category: 'mine', label: '管理費・修繕積立金',
      status: conditions.maxMonthlyFeesYen === null || monthlyFees === null ? 'unknown' : monthlyFees <= conditions.maxMonthlyFeesYen ? 'ok' : 'warn',
      detail: conditions.maxMonthlyFeesYen === null ? '条件が未設定' : monthlyFees === null ? '管理費または修繕積立金が未入力' : `${monthlyFees.toLocaleString('ja-JP')}円/月（上限 ${conditions.maxMonthlyFeesYen.toLocaleString('ja-JP')}円）`,
    },
    ...(landRights === undefined ? [] : [{
      id: 'land_rights', category: 'building' as const, label: '土地権利',
      status: landRights === null ? 'unknown' as const : landRights.includes('所有権') ? 'ok' as const : 'warn' as const,
      detail: landRights === null ? '土地権利が未入力' : landRights.includes('所有権') ? '所有権' : '借地権などは価格が安く出やすく、所有権の成約事例とは比べにくい',
    }]),
  ];
}
