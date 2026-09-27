import { describe, expect, it } from 'vitest';
import type { Evaluation, Listing, MyConditions, ValuationConfig } from '../types';
import { buildChecklist } from './checklist';

const listing: Listing = {
  id: 'a', name: '物件', sourceUrl: '', municipalityCode: '27207', addressText: '', lat: null, lon: null,
  station: '高槻', walkMinutes: 5, areaSqm: 70, buildingYear: 2011, buildingMonth: 1, floor: 5, totalFloors: 10,
  floorPlan: '3LDK', managementFeeYen: 10_000, repairReserveYen: 12_000,
  renovation: { status: 'unknown', year: null, scope: '', evidence: '' },
  priceHistory: [{ date: '2026-09-01', priceYen: 30_000_000, memo: '' }], memo: '', createdAt: '', updatedAt: '',
};
const conditions: MyConditions = { budgetYen: 40_000_000, minAreaSqm: 60, maxWalkMinutes: 10, maxMonthlyFeesYen: 30_000, negotiationRate: 0, closingCostRate: 0.07 };
const config: ValuationConfig = {
  priceCategory: 'contract', minComparables: 10, holdBelow: 5,
  base: { walkMinutesDiff: 5, periodQuarters: 8, ageYears: 7, areaRatio: 0.25, scope: 'municipality', includeTrade: false },
  relaxSteps: [], seismicMustMatch: true, renovationPreferenceMin: 10, labelThresholdPct: 5,
  confidence: { A: { minN: 30, maxIqrRatio: 0.25 }, B: { minN: 15, maxIqrRatio: 0.35 }, C: { minN: 5 } }, staleQuarters: 4,
  checklist: { areaOkSqm: 55, areaWarnSqm: 50, repairReserveGuidelineYenPerSqm: 200, repairReserveWarnRatio: 0.7 },
};
const okayEvaluation: Evaluation = {
  status: 'ok', holdReasons: [], relaxations: [], comparables: [], stats: null,
  estimatedPrice: 29_000_000, estimatedLow: 28_000_000, estimatedHigh: 30_000_000,
  askingPrice: 30_000_000, effectivePrice: 30_000_000, gapPctAsking: 3.4, gapPct: 3.4,
  confidence: 'C', label: 'near', limitations: [],
};

function item(id: string, overrides: Partial<Parameters<typeof buildChecklist>[0]> = {}) {
  return buildChecklist({ listing, evaluation: okayEvaluation, hazard: { flood: { status: 'none' }, stormSurge: { status: 'none' }, tsunami: { status: 'none' }, landslide: { status: 'none' } }, conditions, config, ...overrides }).find((entry) => entry.id === id)!;
}

describe('buildChecklist', () => {
  it.each([
    ['price_gap', 'ok', { evaluation: okayEvaluation }],
    ['price_gap', 'unknown', { evaluation: null }],
    ['seismic', 'ok', { listing }],
    ['seismic', 'ng', { listing: { ...listing, buildingYear: 1979 } }],
    ['tax_area', 'ok', { listing }],
    ['tax_area', 'warn', { listing: { ...listing, areaSqm: 40 } }],
    ['repair_reserve', 'ok', { listing }],
    ['repair_reserve', 'warn', { listing: { ...listing, repairReserveYen: 100 } }],
    ['flood', 'ok', { hazard: { flood: { status: 'none' }, stormSurge: { status: 'none' }, tsunami: { status: 'none' }, landslide: { status: 'none' } } }],
    ['flood', 'unknown', { hazard: null }],
    ['landslide', 'ok', { hazard: { flood: { status: 'none' }, stormSurge: { status: 'none' }, tsunami: { status: 'none' }, landslide: { status: 'none' } } }],
    ['landslide', 'unknown', { hazard: null }],
    ['budget', 'ok', { conditions }],
    ['budget', 'warn', { conditions: { ...conditions, budgetYen: 1 } }],
    ['min_area', 'ok', { conditions }],
    ['min_area', 'warn', { conditions: { ...conditions, minAreaSqm: 80 } }],
    ['walk', 'ok', { conditions }],
    ['walk', 'warn', { conditions: { ...conditions, maxWalkMinutes: 2 } }],
    ['monthly_fees', 'ok', { conditions }],
    ['monthly_fees', 'warn', { conditions: { ...conditions, maxMonthlyFeesYen: 1 } }],
    ['land_rights', 'ok', { landRights: '所有権' }],
    ['land_rights', 'warn', { landRights: '定期借地権' }],
  ] as const)('%s is %s', (id, expected, overrides) => {
    expect(item(id, overrides).status).toBe(expected);
  });

  it('returns unknown for missing land rights', () => {
    expect(item('land_rights', { landRights: null }).status).toBe('unknown');
  });
});
