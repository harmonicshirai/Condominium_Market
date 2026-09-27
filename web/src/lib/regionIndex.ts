import type { Listing, LocalListing, Municipality, RegionIndex, RegionSeries, Transaction } from '../types';

export type RegionLevel = 'municipality' | 'group' | 'station';

export interface RegionChange {
  series: RegionSeries;
  level: RegionLevel | 'average';
  /** 基準四半期から直近までの騰落率（%） */
  changePct: number;
  /** 関西平均との差（ポイント） */
  vsAveragePt: number;
  /** 4四半期の件数が minWindowN 未満なら true（参考値） */
  lowN: boolean;
  baseN: number;
  latestN: number;
}

/** 系列の値（移動平均か1四半期ごと） */
export function valuesOf(series: RegionSeries, smoothed: boolean): (number | null)[] {
  return smoothed ? series.smooth : series.log;
}

/** 最新の四半期（平均の移動平均に値がある最後の位置） */
export function latestPosition(index: RegionIndex): number {
  for (let i = index.periods.length - 1; i >= 0; i -= 1) if (index.average.smooth[i] !== null) return i;
  return index.periods.length - 1;
}

/** 基準四半期を100とした値。基準に値がなければ null */
export function rebased(series: RegionSeries, basePos: number, smoothed: boolean): (number | null)[] {
  const values = valuesOf(series, smoothed);
  const base = values[basePos];
  return values.map((value) => (value === null || base === null || base === undefined ? null : Math.exp(value - base) * 100));
}

function change(series: RegionSeries, basePos: number, latestPos: number): number | null {
  const base = series.smooth[basePos];
  const latest = series.smooth[latestPos];
  return base === null || latest === null || base === undefined || latest === undefined ? null : (Math.exp(latest - base) - 1) * 100;
}

export function regionChange(index: RegionIndex, series: RegionSeries, level: RegionLevel | 'average', basePos: number, latestPos = latestPosition(index)): RegionChange | null {
  const pct = change(series, basePos, latestPos);
  const average = change(index.average, basePos, latestPos);
  if (pct === null || average === null) return null;
  const baseN = series.n4[basePos] ?? 0;
  const latestN = series.n4[latestPos] ?? 0;
  return {
    series, level, changePct: pct, vsAveragePt: pct - average,
    lowN: baseN < index.minWindowN || latestN < index.minWindowN, baseN, latestN,
  };
}

// 国交省の駅名の括弧（「尼崎(JR)」「塚口(阪急)」）と路線名の対応
const LINE_TAGS: [RegExp, string][] = [
  [/JR/, 'JR'], [/阪神/, '阪神'], [/阪急/, '阪急'], [/京阪/, '京阪'], [/近鉄/, '近鉄'], [/南海/, '南海'],
  [/大阪メトロ|Osaka\s*Metro|大阪市営/, '大阪メトロ'], [/京都市営|京都市交通局|烏丸線|東西線/, '京都市営'],
  [/嵐電|京福/, '嵐電'], [/叡山/, '叡電'], [/北大阪急行/, '北大阪急行'], [/モノレール/, '大阪モノレール'],
];
const REGION_TAGS = new Set(['京都', '大阪', '兵庫']);

function normalizeStation(name: string): string {
  return name.normalize('NFKC').trim().replace(/駅$/, '').replace(/ヶ/g, 'ケ');
}

function splitStation(id: string): { base: string; qualifier: string | null } {
  const match = /^(.+?)\((.+)\)$/.exec(normalizeStation(id));
  return match ? { base: match[1], qualifier: match[2] } : { base: normalizeStation(id), qualifier: null };
}

/** 物件の最寄駅（と路線名）に当たる駅の系列 */
export function stationSeriesFor(index: RegionIndex, station: string, line: string | null | undefined): RegionSeries | null {
  if (!station) return null;
  const base = normalizeStation(station);
  const tags = new Set(LINE_TAGS.filter(([pattern]) => pattern.test((line ?? '').normalize('NFKC'))).map(([, tag]) => tag));
  const candidates = index.stations.filter((series) => splitStation(series.id).base === base);
  const byOperator = candidates.find((series) => {
    const { qualifier } = splitStation(series.id);
    return qualifier !== null && tags.has(qualifier);
  });
  if (byOperator) return byOperator;
  const neutral = candidates.filter((series) => {
    const { qualifier } = splitStation(series.id);
    return qualifier === null || REGION_TAGS.has(qualifier);
  });
  if (neutral.length === 1) return neutral[0];
  return !line && candidates.length === 1 ? candidates[0] : null;
}

/** 物件の地域の騰落。駅 → 市区町村 → グループの順に、件数が足りるものを使う */
export function listingRegionChange(
  index: RegionIndex, listing: Listing | LocalListing, municipalities: Municipality[], basePos: number,
): RegionChange | null {
  const latestPos = latestPosition(index);
  const line = 'line' in listing ? listing.line : null;
  const station = stationSeriesFor(index, listing.station, line);
  const candidates: [RegionSeries | undefined | null, RegionLevel][] = [
    [station, 'station'],
    [index.municipalities.find((series) => series.id === listing.municipalityCode), 'municipality'],
    [index.groups.find((series) => series.id === municipalities.find((item) => item.code === listing.municipalityCode)?.group), 'group'],
  ];
  let fallback: RegionChange | null = null;
  for (const [series, level] of candidates) {
    if (!series) continue;
    const result = regionChange(index, series, level, basePos, latestPos);
    if (result && !result.lowN) return result;
    fallback ??= result;
  }
  return fallback;
}

/**
 * 評価の時点修正（T09 手順7）を地域別の指数で行う関数。
 * 事例の市区町村の系列（件数が足りなければグループ、それもなければ関西平均）で、事例の四半期から最新四半期までの変化を掛ける。
 */
export function makeTimeAdjuster(index: RegionIndex, municipalities: Municipality[], latestPeriod: string): (tx: Transaction) => number | null {
  const latestPos = index.periods.indexOf(latestPeriod);
  const groupOf = new Map(municipalities.map((item) => [item.code, item.group]));
  const cache = new Map<string, number | null>();
  const usable = (series: RegionSeries | undefined, pos: number): series is RegionSeries =>
    !!series && series.smooth[pos] !== null && series.smooth[latestPos] !== null
    && (series.n4[pos] ?? 0) >= index.minWindowN && (series.n4[latestPos] ?? 0) >= index.minWindowN;
  return (tx) => {
    const key = `${tx.municipalityCode}|${tx.period}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const pos = index.periods.indexOf(tx.period);
    let factor: number | null = null;
    if (pos >= 0 && latestPos >= 0) {
      const series = [
        index.municipalities.find((item) => item.id === tx.municipalityCode),
        index.groups.find((item) => item.id === groupOf.get(tx.municipalityCode)),
      ].find((item) => usable(item, pos)) ?? index.average;
      const from = series.smooth[pos];
      const to = series.smooth[latestPos];
      factor = from === null || to === null ? null : Math.exp(to - from);
    }
    cache.set(key, factor);
    return factor;
  };
}
