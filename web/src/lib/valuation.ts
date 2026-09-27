import type {
  AdjustedComparable,
  Confidence,
  Evaluation,
  Listing,
  Municipality,
  PriceIndex,
  Seismic,
  Transaction,
  ValuationConfig,
  ValuationRelaxStep,
} from '../types';
import { quantile } from './stats';

/** 推定レンジ（p25〜p75）からこの割合以上外れたら注意を出す */
const OUTSIDE_RANGE_MARGIN = 0.2;

export interface EvaluateInput {
  listing: Listing;
  transactions: Transaction[];
  municipalities: Municipality[];
  priceIndex: PriceIndex;
  latestPeriod: string;
  negotiationRate: number;
  config: ValuationConfig;
  /** 地域別の時点修正（regionIndex.ts の makeTimeAdjuster）。null を返した事例は priceIndex で補正する */
  timeAdjust?: (tx: Transaction) => number | null;
}

export function listingSeismic(buildingYear: number | null): Seismic {
  if (buildingYear === null) return 'unknown';
  if (buildingYear <= 1980) return 'old';
  if (buildingYear <= 1982) return 'unknown';
  return 'new';
}

function periodIndex(period: string): number {
  const match = /^(\d{4})Q([1-4])$/.exec(period);
  if (!match) throw new Error(`期間の形式が不正です: ${period}`);
  return Number(match[1]) * 4 + Number(match[2]) - 1;
}

function filterComparables(
  input: EvaluateInput,
  settings: EvaluateInput['config']['base'],
  buildingAge: number | null,
  listingSeismicClass: Seismic,
): Transaction[] {
  const listingMunicipality = input.municipalities.find((item) => item.code === input.listing.municipalityCode);
  const targetMunicipalityCodes = settings.scope === 'group' && listingMunicipality
    ? new Set(input.municipalities.filter((item) => item.group === listingMunicipality.group).map((item) => item.code))
    : new Set([input.listing.municipalityCode]);
  const latestIndex = periodIndex(input.latestPeriod);
  return input.transactions.filter((transaction) => {
    if (transaction.priceCategory !== 'contract' && !(settings.includeTrade && transaction.priceCategory === 'trade')) return false;
    if (!targetMunicipalityCodes.has(transaction.municipalityCode)) return false;
    if (latestIndex - periodIndex(transaction.period) >= settings.periodQuarters) return false;
    if (buildingAge !== null && (transaction.ageAtTrade === null || Math.abs(transaction.ageAtTrade - buildingAge) > settings.ageYears)) return false;
    if (Math.abs(transaction.areaSqm - input.listing.areaSqm) / input.listing.areaSqm > settings.areaRatio) return false;
    if (input.config.seismicMustMatch && listingSeismicClass !== 'unknown' && transaction.seismic !== listingSeismicClass) return false;
    if (settings.walkMinutesDiff !== null) {
      if (input.listing.walkMinutes === null || transaction.walkMinutes === null) return false;
      if (Math.abs(transaction.walkMinutes - input.listing.walkMinutes) > settings.walkMinutesDiff) return false;
    }
    return true;
  });
}

function applyRelaxStep(
  current: EvaluateInput['config']['base'],
  step: ValuationRelaxStep,
): EvaluateInput['config']['base'] {
  return { ...current, ...step };
}

function confidenceFor(n: number, iqrRatio: number, stale: boolean, config: ValuationConfig): Confidence {
  let confidence: Confidence = 'D';
  if (n >= config.confidence.A.minN && iqrRatio <= config.confidence.A.maxIqrRatio) confidence = 'A';
  else if (n >= config.confidence.B.minN && iqrRatio <= config.confidence.B.maxIqrRatio) confidence = 'B';
  else if (n >= config.confidence.C.minN) confidence = 'C';
  if (stale && confidence !== 'D') {
    const levels: Confidence[] = ['A', 'B', 'C', 'D'];
    confidence = levels[Math.min(levels.indexOf(confidence) + 1, levels.length - 1)];
  }
  return confidence;
}

export function evaluateListing(input: EvaluateInput): Evaluation {
  const latestObservation = input.listing.priceHistory.at(-1);
  if (!latestObservation) throw new Error('売出価格の履歴がありません');
  const askingPrice = latestObservation.priceYen;
  const effectivePrice = askingPrice * (1 - input.negotiationRate);
  const evaluationYear = Number(latestObservation.date.slice(0, 4));
  const buildingAge = input.listing.buildingYear === null ? null : evaluationYear - input.listing.buildingYear;
  const seismic = listingSeismic(input.listing.buildingYear);
  const holdReasons: string[] = [];
  const relaxations: string[] = [];
  const limitations = [
    '階数・向き・眺望・室内と管理の状態は比較に含まれていない',
    '国交省の事例は個別の物件が特定できないよう加工されている',
  ];
  if (input.listing.buildingYear === null) holdReasons.push('築年が未入力');
  if (seismic === 'unknown') limitations.push('耐震区分が要確認のため、新旧をそろえずに比較');
  if (input.negotiationRate === 0) limitations.push('想定値引き率が0%のため、売出価格をそのまま成約相場と比べている');

  const base = { ...input.config.base };
  if (input.listing.walkMinutes === null) base.walkMinutesDiff = null;
  let settings = base;
  let selected = filterComparables(input, settings, buildingAge, seismic);
  for (const step of input.config.relaxSteps) {
    if (selected.length >= input.config.minComparables) break;
    if (input.listing.walkMinutes === null && step.walkMinutesDiff === null) continue;
    settings = applyRelaxStep(settings, step);
    selected = filterComparables(input, settings, buildingAge, seismic);
    relaxations.push(step.label);
  }

  if (input.listing.renovation.status !== 'unknown') {
    const sameRenovation = selected.filter((transaction) => transaction.renovation === input.listing.renovation.status);
    if (sameRenovation.length >= input.config.renovationPreferenceMin) selected = sameRenovation;
    else if (input.listing.renovation.status === 'renovated') {
      limitations.push('比較事例の多くはリフォーム状況が不明（未改装を含む）のため、リフォーム済みのこの物件は相場より高く出やすい');
    } else {
      limitations.push('成約事例には『未改装』の区分がないため、リフォームの有無はそろえていない');
    }
  }

  const indexPoints = new Map(input.priceIndex.points.map((point) => [point.period, point.value]));
  let missingIndex = false;
  const comparables: AdjustedComparable[] = selected.map((transaction) => {
    const regional = input.timeAdjust?.(transaction) ?? null;
    const index = indexPoints.get(transaction.period);
    const factor = regional ?? (index !== undefined && index > 0 ? 1 / index : 1);
    if (regional === null && (index === undefined || index <= 0)) missingIndex = true;
    return { tx: transaction, factor, adjustedPricePerSqm: transaction.pricePerSqm * factor };
  });
  if (missingIndex) limitations.push('一部の事例は時点修正できなかった');

  if (comparables.length < input.config.holdBelow) {
    holdReasons.push('比較できる成約事例が5件未満');
    return {
      status: 'hold', holdReasons, relaxations, comparables, stats: null,
      estimatedPrice: null, estimatedLow: null, estimatedHigh: null,
      askingPrice, effectivePrice, gapPctAsking: null, gapPct: null,
      confidence: 'D', label: 'hold', limitations,
    };
  }

  const prices = comparables.map((comparable) => comparable.adjustedPricePerSqm);
  const median = quantile(prices, 0.5);
  const p25 = quantile(prices, 0.25);
  const p75 = quantile(prices, 0.75);
  const iqrRatio = median === 0 ? 0 : (p75 - p25) / median;
  const estimatedPrice = Math.round(median * input.listing.areaSqm);
  const estimatedLow = Math.round(p25 * input.listing.areaSqm);
  const estimatedHigh = Math.round(p75 * input.listing.areaSqm);
  // 推定レンジから大きく外れる物件は、比較データにない理由（借地権・管理・室内・眺望など）がある可能性が高い
  if (effectivePrice < estimatedLow * (1 - OUTSIDE_RANGE_MARGIN)) {
    limitations.push('推定レンジの下限を大きく下回っています。借地権、管理や室内の状態など、安い理由がないか必ず確認してください');
  } else if (effectivePrice > estimatedHigh * (1 + OUTSIDE_RANGE_MARGIN)) {
    limitations.push('推定レンジの上限を大きく上回っています。リフォームや眺望など、高い理由があるか確認してください');
  }
  const gapPct = Math.round((effectivePrice / estimatedPrice - 1) * 1000) / 10;
  const gapPctAsking = Math.round((askingPrice / estimatedPrice - 1) * 1000) / 10;
  const newestComparable = Math.max(...comparables.map((item) => periodIndex(item.tx.period)));
  const stale = periodIndex(input.latestPeriod) - newestComparable >= input.config.staleQuarters;
  const confidence = confidenceFor(comparables.length, iqrRatio, stale, input.config);
  const label = holdReasons.length > 0 || confidence === 'D'
    ? 'hold'
    : gapPct <= -input.config.labelThresholdPct
      ? 'below'
      : gapPct >= input.config.labelThresholdPct
        ? 'above'
        : 'near';
  return {
    status: holdReasons.length ? 'hold' : 'ok',
    holdReasons,
    relaxations,
    comparables,
    stats: { n: comparables.length, median, p25, p75, iqrRatio },
    estimatedPrice,
    estimatedLow,
    estimatedHigh,
    askingPrice,
    effectivePrice,
    gapPctAsking,
    gapPct,
    confidence,
    label,
    limitations,
  };
}
