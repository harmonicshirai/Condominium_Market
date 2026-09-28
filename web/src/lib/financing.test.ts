import { describe, expect, it } from 'vitest';
import type { FinancingSettings, Listing } from '../types';
import { DEFAULT_FINANCING, amortizingTermYears, annualPaymentCapYen, monthlyPayment, paymentPlan, principalForMonthly, resolveMethod } from './financing';

const listing: Listing = {
  id: 'one', name: '物件', sourceUrl: '', municipalityCode: '28202', addressText: '', lat: null, lon: null,
  station: '塚口', walkMinutes: 8, areaSqm: 70, buildingYear: 2000, buildingMonth: 1, floor: 3,
  totalFloors: 10, floorPlan: '3LDK', managementFeeYen: 15_000, repairReserveYen: 12_000,
  renovation: { status: 'unknown', year: null, scope: '', evidence: '' },
  priceHistory: [{ date: '2026-09-25', priceYen: 20_000_000, memo: '' }], memo: '',
  createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
};

// 75歳・年金360万円/年・金利2%
const senior: FinancingSettings = { ...DEFAULT_FINANCING, showLoan: true, ageYears: 75, annualIncomeYen: 3_600_000 };

function plan(overrides: { listing?: Partial<Listing>; settings?: Partial<FinancingSettings>; budgetYen?: number | null } = {}) {
  return paymentPlan({
    listing: { ...listing, ...overrides.listing },
    negotiationRate: 0,
    closingCostRate: 0.07,
    budgetYen: overrides.budgetYen ?? null,
    settings: { ...senior, ...overrides.settings },
  });
}

describe('loan arithmetic', () => {
  it('uses the 30% repayment ratio below 4 million yen of income and 35% above', () => {
    expect(annualPaymentCapYen(3_600_000)).toBeCloseTo(1_080_000);
    expect(annualPaymentCapYen(5_000_000)).toBeCloseTo(1_750_000);
    expect(annualPaymentCapYen(null)).toBeNull();
  });

  it('computes interest-only and level payments at 2%', () => {
    expect(monthlyPayment(10_000_000, 2, 'interest_only', 0)).toBeCloseTo(16_666.67, 1);
    expect(monthlyPayment(10_000_000, 2, 'amortizing', 35)).toBeCloseTo(33_126, 0);
    expect(monthlyPayment(10_000_000, 2, 'amortizing', 20)).toBeCloseTo(50_588, 0);
    expect(monthlyPayment(12_000_000, 0, 'amortizing', 10)).toBe(100_000);
  });

  it('inverts the monthly payment', () => {
    expect(principalForMonthly(90_000, 2, 'interest_only', 0)).toBeCloseTo(54_000_000);
    const principal = principalForMonthly(50_000, 2, 'amortizing', 20);
    expect(monthlyPayment(principal, 2, 'amortizing', 20)).toBeCloseTo(50_000);
  });

  it('picks interest-only when 15 years cannot be repaid by age 80', () => {
    expect(resolveMethod({ ...DEFAULT_FINANCING, ageYears: 75 })).toBe('interest_only');
    expect(resolveMethod({ ...DEFAULT_FINANCING, ageYears: 66 })).toBe('interest_only');
    expect(resolveMethod({ ...DEFAULT_FINANCING, ageYears: 65 })).toBe('amortizing');
    expect(resolveMethod({ ...DEFAULT_FINANCING, ageYears: null })).toBe('amortizing');
    expect(resolveMethod({ ...DEFAULT_FINANCING, ageYears: 75, method: 'amortizing' })).toBe('amortizing');
  });

  it('limits the level-payment term to age 80 and 35 years', () => {
    expect(amortizingTermYears({ ...DEFAULT_FINANCING, ageYears: 40 })).toBe(35);
    expect(amortizingTermYears({ ...DEFAULT_FINANCING, ageYears: 60 })).toBe(20);
    expect(amortizingTermYears({ ...DEFAULT_FINANCING, ageYears: 60, termYears: 10 })).toBe(10);
  });
});

describe('paymentPlan', () => {
  it('shows only the cash total when the loan is off', () => {
    const result = plan({ settings: { showLoan: false }, budgetYen: 25_000_000 });
    expect(result?.totalCostYen).toBeCloseTo(21_400_000);
    expect(result?.monthlyFeesYen).toBe(27_000);
    expect(result?.loan).toBeNull();
    expect(result?.budgetFit).toBe('cash');
    expect(plan({ settings: { showLoan: false }, budgetYen: 15_000_000 })?.budgetFit).toBe('over');
  });

  it('caps a 75-year-old at half the price with interest-only payments', () => {
    const loan = plan()?.loan;
    expect(loan?.method).toBe('interest_only');
    expect(loan?.status).toBe('ok');
    expect(loan?.maxLoanYen).toBe(10_000_000);
    expect(loan?.limitedBy).toBe('value');
    expect(loan?.loanYen).toBe(10_000_000);
    expect(loan?.cashYen).toBeCloseTo(11_400_000);
    expect(loan?.monthlyPaymentYen).toBeCloseTo(16_666.67, 1);
    expect(loan?.monthlyTotalYen).toBeCloseTo(43_666.67, 1);
  });

  it('borrows only the shortfall when a budget is set', () => {
    const result = plan({ budgetYen: 15_000_000 });
    expect(result?.budgetFit).toBe('with_loan');
    expect(result?.loan?.loanYen).toBe(6_400_000);
    expect(result?.loan?.monthlyPaymentYen).toBeCloseTo(10_666.67, 1);
    expect(plan({ budgetYen: 25_000_000 })?.loan?.loanYen).toBe(0);
    expect(plan({ budgetYen: 25_000_000 })?.budgetFit).toBe('cash');
    expect(plan({ budgetYen: 5_000_000 })?.budgetFit).toBe('over');
  });

  it('rules out old-seismic buildings for the reverse mortgage', () => {
    const result = plan({ listing: { buildingYear: 1975 }, budgetYen: 15_000_000 });
    expect(result?.loan?.status).toBe('ineligible');
    expect(result?.loan?.maxLoanYen).toBe(0);
    expect(result?.loan?.notes.join()).toContain('旧耐震');
    expect(result?.budgetFit).toBe('over');
    expect(plan({ listing: { buildingYear: 1981 } })?.loan?.status).toBe('conditional');
  });

  it('limits a level-payment loan by income and flags applicants aged 70 or over', () => {
    const younger = plan({ listing: { priceHistory: [{ date: '2026-09-25', priceYen: 30_000_000, memo: '' }] }, settings: { ageYears: 50 } })?.loan;
    expect(younger?.method).toBe('amortizing');
    expect(younger?.termYears).toBe(30);
    expect(younger?.limitedBy).toBe('income');
    expect(younger?.maxLoanYen).toBe(Math.floor(principalForMonthly(90_000, 2, 'amortizing', 30) / 100_000) * 100_000);
    const relay = plan({ settings: { method: 'amortizing', termYears: 20 } })?.loan;
    expect(relay?.status).toBe('conditional');
    expect(relay?.notes.join()).toContain('親子リレー');
  });
});
