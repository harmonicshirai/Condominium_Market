import type { FinancingSettings, Listing, LoanMethod } from '../types';
import { listingSeismic } from './valuation';

/**
 * 住宅金融支援機構の公表条件（2026-09-28 に確認）
 * - フラット35: https://www.flat35.com/loan/lineup/flat35/conditions/index.html
 * - リ・バース60: https://www.jhf.go.jp/kojin/yushihoken_revmo/jouken.html
 * 金利や細かな条件は金融機関ごとに異なるため、画面では「目安」として出す。
 */
export const LOAN_RULES = {
  /** 総返済負担率: 年収400万円未満は30%以下、400万円以上は35%以下（両方共通） */
  burdenIncomeThresholdYen: 4_000_000,
  burdenRatioLow: 0.3,
  burdenRatioHigh: 0.35,
  /** フラット35: 申込時の年齢が満70歳未満、借入期間は15年以上35年以下かつ「80歳 − 申込時の年齢」以下 */
  flat35MaxApplyAge: 70,
  flat35PayoffAge: 80,
  flat35MinTermYears: 15,
  flat35MaxTermYears: 35,
  /** リ・バース60: 借入申込日現在で満60歳以上。毎月は利息のみ。融資は担保評価額の50%または60%まで */
  reverse60MinAge: 60,
} as const;

export const DEFAULT_FINANCING: FinancingSettings = {
  showLoan: false,
  ageYears: null,
  annualIncomeYen: null,
  ratePct: 2,
  method: 'auto',
  termYears: null,
  loanToValuePct: 50,
};

export type ResolvedMethod = Exclude<LoanMethod, 'auto'>;

export function burdenRatio(annualIncomeYen: number): number {
  return annualIncomeYen < LOAN_RULES.burdenIncomeThresholdYen ? LOAN_RULES.burdenRatioLow : LOAN_RULES.burdenRatioHigh;
}

/** 年収から見た年間返済額の上限。年収が未入力なら null */
export function annualPaymentCapYen(annualIncomeYen: number | null): number | null {
  return annualIncomeYen === null ? null : annualIncomeYen * burdenRatio(annualIncomeYen);
}

export function resolveMethod(settings: FinancingSettings): ResolvedMethod {
  if (settings.method !== 'auto') return settings.method;
  const age = settings.ageYears;
  return age !== null && LOAN_RULES.flat35PayoffAge - age < LOAN_RULES.flat35MinTermYears ? 'interest_only' : 'amortizing';
}

/** 元利均等の返済期間（年）。指定がなければ「80歳 − 年齢」で最長35年 */
export function amortizingTermYears(settings: FinancingSettings): number {
  if (settings.termYears !== null) return settings.termYears;
  if (settings.ageYears === null) return LOAN_RULES.flat35MaxTermYears;
  return Math.max(0, Math.min(LOAN_RULES.flat35MaxTermYears, LOAN_RULES.flat35PayoffAge - settings.ageYears));
}

/** 毎月の返済額（円）。利息のみ型は元金を減らさない */
export function monthlyPayment(principalYen: number, ratePct: number, method: ResolvedMethod, termYears: number): number {
  const monthlyRate = ratePct / 100 / 12;
  if (method === 'interest_only') return principalYen * monthlyRate;
  const months = termYears * 12;
  if (months <= 0) return Number.POSITIVE_INFINITY;
  if (monthlyRate === 0) return principalYen / months;
  return (principalYen * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
}

/** 毎月の返済額の上限から逆算した借入額（円） */
export function principalForMonthly(monthlyYen: number, ratePct: number, method: ResolvedMethod, termYears: number): number {
  const monthlyRate = ratePct / 100 / 12;
  if (method === 'interest_only') return monthlyRate === 0 ? Number.POSITIVE_INFINITY : monthlyYen / monthlyRate;
  const months = termYears * 12;
  if (months <= 0) return 0;
  if (monthlyRate === 0) return monthlyYen * months;
  return (monthlyYen * (1 - (1 + monthlyRate) ** -months)) / monthlyRate;
}

export type LoanStatus = 'ok' | 'conditional' | 'ineligible';

export interface LoanPlan {
  method: ResolvedMethod;
  status: LoanStatus;
  termYears: number | null;
  /** 借りられる額の目安（10万円単位で切り捨て） */
  maxLoanYen: number;
  limitedBy: 'value' | 'income';
  /** この試算で借りる額。予算（手元資金）があれば不足分だけ、なければ上限まで */
  loanYen: number;
  cashYen: number;
  monthlyPaymentYen: number;
  /** 返済＋管理費・修繕積立金。どちらかが不明なら null */
  monthlyTotalYen: number | null;
  notes: string[];
}

export type BudgetFit = 'cash' | 'with_loan' | 'over' | 'unknown';

export interface PaymentPlan {
  /** 想定値引き後の価格 */
  priceYen: number;
  closingCostYen: number;
  /** 一括で払う場合に必要な額（価格＋諸費用） */
  totalCostYen: number;
  monthlyFeesYen: number | null;
  loan: LoanPlan | null;
  budgetFit: BudgetFit;
}

export interface PaymentPlanInput {
  listing: Listing;
  negotiationRate: number;
  closingCostRate: number;
  budgetYen: number | null;
  settings: FinancingSettings;
}

const floorTo100k = (yen: number) => Math.max(0, Math.floor(yen / 100_000) * 100_000);

function buildLoan(input: PaymentPlanInput, priceYen: number, totalCostYen: number, monthlyFeesYen: number | null): LoanPlan {
  const { settings, listing, budgetYen } = input;
  const method = resolveMethod(settings);
  const age = settings.ageYears;
  const notes: string[] = [];
  let status: LoanStatus = 'ok';
  let termYears: number | null = null;
  let maxByValue: number;

  if (method === 'interest_only') {
    maxByValue = priceYen * (settings.loanToValuePct / 100);
    if (age === null) notes.push('年齢が未入力です。リ・バース60は申込時に満60歳以上が対象です');
    else if (age < LOAN_RULES.reverse60MinAge) {
      status = 'ineligible';
      notes.push('リ・バース60は申込時に満60歳以上が対象です（50歳以上60歳未満は融資の上限が異なります）');
    }
    const seismic = listingSeismic(listing.buildingYear);
    if (seismic === 'old') {
      status = 'ineligible';
      notes.push('リ・バース60は新耐震基準相当の耐震性が必要なため、旧耐震の物件では使えません');
    } else if (seismic === 'unknown') {
      if (status === 'ok') status = 'conditional';
      notes.push('新耐震基準相当か（1981年6月以降の建築確認か）の確認が必要です');
    }
    notes.push(`借入は担保評価額の${settings.loanToValuePct}%まで。担保評価額は売出価格として計算しています（実際の評価は低く出ることがあります）`);
    notes.push('毎月の支払いは利息のみで、元金は亡くなったときに一括で返します（物件の売却など）。ノンリコース型なら、売却で足りない分を相続人が返す必要はありません');
  } else {
    termYears = amortizingTermYears(settings);
    maxByValue = priceYen;
    if (age !== null && age >= LOAN_RULES.flat35MaxApplyAge) {
      status = 'conditional';
      notes.push('フラット35は申込時に満70歳未満が条件です。70歳以上は、子・孫など（申込時に満70歳未満）が連帯債務者になる親子リレー返済が必要です');
    } else if (age !== null && age + termYears > LOAN_RULES.flat35PayoffAge) {
      status = 'conditional';
      notes.push('完済時に80歳を超えます（親子リレー返済が前提）');
    }
    if (termYears <= 0) {
      status = 'ineligible';
      notes.push('返済期間が取れません');
    } else if (termYears < LOAN_RULES.flat35MinTermYears) {
      if (status === 'ok') status = 'conditional';
      notes.push(`フラット35の借入期間は${LOAN_RULES.flat35MinTermYears}年以上です`);
    }
  }

  const cap = annualPaymentCapYen(settings.annualIncomeYen);
  const maxByIncome = cap === null ? Number.POSITIVE_INFINITY : principalForMonthly(cap / 12, settings.ratePct, method, termYears ?? 0);
  if (cap === null) notes.push('年収が未入力のため、返済負担率による上限は見ていません');
  const maxLoanYen = status === 'ineligible' ? 0 : floorTo100k(Math.min(maxByValue, maxByIncome));
  const limitedBy = maxByIncome < maxByValue ? 'income' : 'value';
  // 予算（手元資金）があれば、足りない分だけを10万円単位で切り上げて借りる
  const shortfallYen = budgetYen === null ? null : Math.ceil(Math.max(0, totalCostYen - budgetYen) / 100_000) * 100_000;
  const loanYen = shortfallYen === null ? maxLoanYen : Math.min(maxLoanYen, shortfallYen);
  const monthlyPaymentYen = loanYen === 0 ? 0 : monthlyPayment(loanYen, settings.ratePct, method, termYears ?? 0);
  notes.push('金利や細かな条件は金融機関ごとに異なります');
  return {
    method,
    status,
    termYears,
    maxLoanYen,
    limitedBy,
    loanYen,
    cashYen: totalCostYen - loanYen,
    monthlyPaymentYen,
    monthlyTotalYen: monthlyFeesYen === null ? null : monthlyPaymentYen + monthlyFeesYen,
    notes,
  };
}

export function paymentPlan(input: PaymentPlanInput): PaymentPlan | null {
  const asking = input.listing.priceHistory.at(-1)?.priceYen;
  if (asking === undefined) return null;
  const priceYen = asking * (1 - input.negotiationRate);
  const closingCostYen = priceYen * input.closingCostRate;
  const totalCostYen = priceYen + closingCostYen;
  const { managementFeeYen, repairReserveYen } = input.listing;
  const monthlyFeesYen = managementFeeYen === null || repairReserveYen === null ? null : managementFeeYen + repairReserveYen;
  const loan = input.settings.showLoan ? buildLoan(input, priceYen, totalCostYen, monthlyFeesYen) : null;
  const budget = input.budgetYen;
  const budgetFit: BudgetFit = budget === null ? 'unknown'
    : totalCostYen <= budget ? 'cash'
      : loan && loan.status !== 'ineligible' && totalCostYen - budget <= loan.maxLoanYen ? 'with_loan' : 'over';
  return { priceYen, closingCostYen, totalCostYen, monthlyFeesYen, loan, budgetFit };
}
