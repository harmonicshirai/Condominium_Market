import { useEffect, useState } from 'react';
import type { Evaluation, Listing, Meta, Municipality, MyConditions, PriceIndex, Transaction, ValuationConfig } from '../types';
import { loadTransactionsForCodes } from './data';
import { evaluateListing } from './valuation';

interface UseEvaluationsArgs {
  listings: Listing[];
  municipalities: Municipality[];
  priceIndex: PriceIndex | null;
  meta: Meta | null;
  conditions: MyConditions;
  config: ValuationConfig;
  timeAdjust?: (tx: Transaction) => number | null;
}

interface EvaluationsState {
  evaluations: Map<string, Evaluation>;
  loading: boolean;
  error: string | null;
}

export function useEvaluations({ listings, municipalities, priceIndex, meta, conditions, config, timeAdjust }: UseEvaluationsArgs): EvaluationsState {
  const [state, setState] = useState<EvaluationsState>({ evaluations: new Map(), loading: false, error: null });
  useEffect(() => {
    if (listings.length === 0 || !priceIndex || !meta) {
      setState({ evaluations: new Map(), loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));
    const codes = new Set<string>();
    for (const listing of listings) {
      const target = municipalities.find((municipality) => municipality.code === listing.municipalityCode);
      for (const municipality of municipalities) {
        if (target && municipality.group === target.group) codes.add(municipality.code);
      }
      codes.add(listing.municipalityCode);
    }
    void loadTransactionsForCodes([...codes]).then((transactions: Transaction[]) => {
      if (cancelled) return;
      const evaluations = new Map<string, Evaluation>();
      for (const listing of listings) {
        evaluations.set(listing.id, evaluateListing({
          listing,
          transactions,
          municipalities,
          priceIndex,
          latestPeriod: meta.periodTo,
          negotiationRate: conditions.negotiationRate,
          config,
          timeAdjust,
        }));
      }
      setState({ evaluations, loading: false, error: null });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setState({ evaluations: new Map(), loading: false, error: error instanceof Error ? error.message : '評価を読み込めませんでした' });
    });
    return () => { cancelled = true; };
  }, [listings, municipalities, priceIndex, meta, conditions.negotiationRate, config, timeAdjust]);
  return state;
}
