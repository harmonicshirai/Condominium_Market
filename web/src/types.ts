export type PriceCategory = 'contract' | 'trade';
export type Seismic = 'new' | 'old' | 'unknown';
export type RenovationStatus = 'renovated' | 'not_renovated' | 'unknown';

/** 国交省の成約・取引事例 */
export interface Transaction {
  id: string;
  priceCategory: PriceCategory;
  municipalityCode: string;
  district: string | null;
  period: string;
  priceYen: number;
  areaSqm: number;
  pricePerSqm: number;
  buildingYear: number | null;
  ageAtTrade: number | null;
  seismic: Seismic;
  floorPlan: string | null;
  structure: string | null;
  renovation: RenovationStatus;
  nearestStation: string | null;
  walkMinutes: number | null;
  source: 'api' | 'csv';
}

export interface Municipality {
  code: string;
  name: string;
  prefectureCode: string;
  group: string;
  groupName: string;
  contractCount: number;
  tradeCount: number;
  latestPeriod: string | null;
}

export interface PriceIndexPoint {
  period: string;
  value: number;
  n: number;
  lowN: boolean;
}

export interface PriceIndex {
  method: 'time_dummy_hedonic';
  basePeriod: string;
  points: PriceIndexPoint[];
  generatedAt: string;
}

export interface SourceCredit {
  id: string;
  name: string;
  url: string;
  credit: string;
  usage: string;
}

export interface Meta {
  generatedAt: string;
  periodFrom: string;
  periodTo: string;
  transactionCount: number;
  hasStations: boolean;
  hasHazard: boolean;
  sources: SourceCredit[];
}

export interface StationMarket {
  medianPricePerSqm: number;
  n: number;
  periodFrom: string;
  periodTo: string;
}

export interface Station {
  code: string | null;
  name: string;
  operator: string;
  line: string;
  lat: number;
  lon: number;
  isTargetLine: boolean;
  passengers: number | null;
  market: StationMarket | null;
}

export interface PriceObservation {
  date: string;
  priceYen: number;
  memo: string;
}

export interface Renovation {
  status: RenovationStatus;
  year: number | null;
  scope: string;
  evidence: string;
}

/** 利用者が登録する物件。localStorage にだけ保存します。 */
export interface Listing {
  id: string;
  name: string;
  sourceUrl: string;
  municipalityCode: string;
  addressText: string;
  lat: number | null;
  lon: number | null;
  station: string;
  walkMinutes: number | null;
  areaSqm: number;
  buildingYear: number | null;
  buildingMonth: number | null;
  floor: number | null;
  totalFloors: number | null;
  floorPlan: string;
  managementFeeYen: number | null;
  repairReserveYen: number | null;
  renovation: Renovation;
  priceHistory: PriceObservation[];
  memo: string;
  createdAt: string;
  updatedAt: string;
}

/** 手元専用のデータ（web/public/local-data/）の掲載物件。公開サイトには含まれない。 */
export interface LocalListing extends Listing {
  sourceName: string;
  externalId: string;
  /** 最寄駅の路線名（駅別の騰落指数を選ぶため） */
  line?: string | null;
  status: 'active' | 'removed';
  firstSeen: string;
  lastSeen: string;
  locationPrecision: 'exact' | 'approx' | 'none';
  areaBasis: '壁芯' | '内法' | null;
  landRights: string | null;
  totalUnits: number | null;
  direction: string | null;
  dupGroup: string | null;
  detailFetchedAt: string | null;
  /** 間取り図の画像 URL（拡大用・縮小版）。画像は見るときにブラウザが掲載元から読み込む */
  floorPlanImageUrl?: string | null;
  floorPlanThumbUrl?: string | null;
}

/** 騰落指数の1系列（pipeline/build_region_index.py）。値は ln 指数で、periods と同じ並び */
export interface RegionSeries {
  id: string;
  name: string;
  rows: number;
  log: (number | null)[];
  smooth: (number | null)[];
  n: number[];
  n4: number[];
  group?: string;
  municipalityCodes?: string[];
}

export interface RegionIndex {
  generatedAt: string;
  method: string;
  periods: string[];
  defaultBase: string;
  smoothQuarters: number;
  minWindowN: number;
  average: RegionSeries;
  municipalities: RegionSeries[];
  groups: RegionSeries[];
  stations: RegionSeries[];
}

export interface LocalMeta {
  generatedAt: string;
  sourceName: string;
  lastListRunAt: string | null;
  counts: { active: number; removed: number; withDetail: number; exact: number; approx: number };
  detailCommandTemplate: string;
}

/** auto は年齢から選ぶ（80歳までに15年の返済期間が取れなければ利息のみ型） */
export type LoanMethod = 'auto' | 'interest_only' | 'amortizing';

/** 支払いの試算の設定（financing.ts） */
export interface FinancingSettings {
  showLoan: boolean;
  ageYears: number | null;
  /** 年収（年金を含む） */
  annualIncomeYen: number | null;
  ratePct: number;
  method: LoanMethod;
  /** 元利均等の返済期間。null は「80歳 − 年齢」（最長35年） */
  termYears: number | null;
  /** 利息のみ型の借入上限（担保評価額に対する割合、%） */
  loanToValuePct: number;
}

export interface MyConditions {
  budgetYen: number | null;
  minAreaSqm: number | null;
  maxWalkMinutes: number | null;
  maxMonthlyFeesYen: number | null;
  negotiationRate: number;
  closingCostRate: number;
  financing: FinancingSettings;
}

export type Label = 'below' | 'near' | 'above' | 'hold';
export type Confidence = 'A' | 'B' | 'C' | 'D';

export interface AdjustedComparable {
  tx: Transaction;
  factor: number;
  adjustedPricePerSqm: number;
}

export interface EvaluationStats {
  n: number;
  median: number;
  p25: number;
  p75: number;
  iqrRatio: number;
}

export interface Evaluation {
  status: 'ok' | 'hold';
  holdReasons: string[];
  relaxations: string[];
  comparables: AdjustedComparable[];
  stats: EvaluationStats | null;
  estimatedPrice: number | null;
  estimatedLow: number | null;
  estimatedHigh: number | null;
  askingPrice: number;
  effectivePrice: number;
  gapPctAsking: number | null;
  gapPct: number | null;
  confidence: Confidence;
  label: Label;
  limitations: string[];
}

export type FloodResult =
  | { status: 'in'; rank: number; label: string; minM: number; maxM: number | null; rivers: string[] }
  | { status: 'none' }
  | { status: 'out_of_coverage' }
  | { status: 'no_location' };

export type LandslideResult =
  | { status: 'in'; zone: 'warning' | 'special'; types: string[] }
  | { status: 'none' }
  | { status: 'out_of_coverage' }
  | { status: 'no_location' };

export interface HazardResult {
  flood: FloodResult;
  stormSurge: FloodResult; // 高潮（T17）
  tsunami: FloodResult; // 津波（T17）
  landslide: LandslideResult;
}

export type CheckStatus = 'ok' | 'warn' | 'ng' | 'unknown' | 'info';

export interface CheckItem {
  id: string;
  category: 'price' | 'building' | 'hazard' | 'mine';
  label: string;
  status: CheckStatus;
  detail: string;
}

export type ValuationScope = 'municipality' | 'group';

export interface ValuationRelaxStep {
  label: string;
  walkMinutesDiff?: number | null;
  periodQuarters?: number;
  ageYears?: number;
  areaRatio?: number;
  scope?: ValuationScope;
  includeTrade?: boolean;
}

export interface ValuationConfig {
  priceCategory: 'contract';
  minComparables: number;
  holdBelow: number;
  base: {
    walkMinutesDiff: number | null;
    periodQuarters: number;
    ageYears: number;
    areaRatio: number;
    scope: ValuationScope;
    includeTrade: boolean;
  };
  relaxSteps: ValuationRelaxStep[];
  seismicMustMatch: boolean;
  renovationPreferenceMin: number;
  labelThresholdPct: number;
  confidence: {
    A: { minN: number; maxIqrRatio: number };
    B: { minN: number; maxIqrRatio: number };
    C: { minN: number };
  };
  staleQuarters: number;
  checklist: {
    areaOkSqm: number;
    areaWarnSqm: number;
    repairReserveGuidelineYenPerSqm: number | null;
    repairReserveWarnRatio: number;
  };
}
