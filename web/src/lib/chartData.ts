import type { Evaluation, Listing, PriceIndex, Transaction } from '../types';
import { quantile } from './stats';

export interface ChartPoint {
  x: number;
  y: number;
}

export interface TrendPoint {
  period: string;
  median: number;
}

export interface ChartData {
  /** 築年数 × 万円/㎡ */
  ageBackground: ChartPoint[];
  ageComparables: ChartPoint[];
  ageTarget: ChartPoint | null;
  /** 面積 × 百万円 */
  areaBackground: ChartPoint[];
  areaComparables: ChartPoint[];
  areaTarget: ChartPoint;
  /** 四半期 × 万円/㎡ */
  trend: TrendPoint[];
}

export interface BuildChartDataArgs {
  listing: Listing;
  evaluation: Evaluation;
  transactions: Transaction[];
  latestPeriod: string;
  priceIndex: PriceIndex;
}

const MAN_YEN = 10_000;
const MILLION_YEN = 1_000_000;
const BACKGROUND_QUARTERS = 12;
const TREND_MIN_COUNT = 5;

function periodIndex(period: string): number {
  const match = /^(\d{4})Q([1-4])$/.exec(period);
  return match ? Number(match[1]) * 4 + Number(match[2]) - 1 : -Infinity;
}

export function buildChartData({ listing, evaluation, transactions, latestPeriod, priceIndex }: BuildChartDataArgs): ChartData {
  const latest = periodIndex(latestPeriod);
  const indexValues = new Map(priceIndex.points.map((point) => [point.period, point.value]));
  const adjusted = (tx: Transaction) => {
    const value = indexValues.get(tx.period);
    return value !== undefined && value > 0 ? tx.pricePerSqm / value : tx.pricePerSqm;
  };

  // 比較事例は評価結果から直接作る（別の市区町村・取引価格情報の事例も含む）
  const comparableIds = new Set(evaluation.comparables.map((item) => item.tx.id));
  const ageComparables = evaluation.comparables
    .filter((item) => item.tx.ageAtTrade !== null)
    .map((item) => ({ x: item.tx.ageAtTrade as number, y: item.adjustedPricePerSqm / MAN_YEN }));
  const areaComparables = evaluation.comparables.map((item) => ({
    x: item.tx.areaSqm,
    y: (item.adjustedPricePerSqm * item.tx.areaSqm) / MILLION_YEN,
  }));

  const municipalityContracts = transactions.filter(
    (tx) => tx.municipalityCode === listing.municipalityCode && tx.priceCategory === 'contract',
  );
  const background = municipalityContracts.filter(
    (tx) => latest - periodIndex(tx.period) < BACKGROUND_QUARTERS && !comparableIds.has(tx.id),
  );
  const ageBackground = background
    .filter((tx) => tx.ageAtTrade !== null)
    .map((tx) => ({ x: tx.ageAtTrade as number, y: adjusted(tx) / MAN_YEN }));
  const areaBackground = background.map((tx) => ({ x: tx.areaSqm, y: (adjusted(tx) * tx.areaSqm) / MILLION_YEN }));

  const evaluationYear = Number(listing.priceHistory.at(-1)?.date.slice(0, 4));
  const ageTarget = listing.buildingYear === null || !Number.isFinite(evaluationYear)
    ? null
    : { x: evaluationYear - listing.buildingYear, y: evaluation.effectivePrice / listing.areaSqm / MAN_YEN };
  const areaTarget = { x: listing.areaSqm, y: evaluation.effectivePrice / MILLION_YEN };

  const byPeriod = new Map<string, number[]>();
  for (const tx of municipalityContracts) {
    const values = byPeriod.get(tx.period) ?? [];
    values.push(tx.pricePerSqm);
    byPeriod.set(tx.period, values);
  }
  const trend = [...byPeriod.entries()]
    .filter(([, values]) => values.length >= TREND_MIN_COUNT)
    .sort(([left], [right]) => periodIndex(left) - periodIndex(right))
    .map(([period, values]) => ({ period, median: quantile(values, 0.5) / MAN_YEN }));

  return { ageBackground, ageComparables, ageTarget, areaBackground, areaComparables, areaTarget, trend };
}
