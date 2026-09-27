import { useEffect, useState } from 'react';
import type { Evaluation, Listing, Municipality, PriceIndex, Transaction, ValuationConfig } from '../types';
import { loadTransactionsForCodes } from './data';
import { evaluateListing } from './valuation';

interface UseEvaluationArgs {
  listing: Listing | null;
  municipalities: Municipality[];
  priceIndex: PriceIndex | null;
  latestPeriod: string;
  negotiationRate: number;
  config: ValuationConfig;
  timeAdjust?: (tx: Transaction) => number | null;
}

interface EvaluationState {
  evaluation: Evaluation | null;
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
}

const EMPTY: EvaluationState = { evaluation: null, transactions: [], loading: false, error: null };

export function useEvaluation({ listing, municipalities, priceIndex, latestPeriod, negotiationRate, config, timeAdjust }: UseEvaluationArgs): EvaluationState {
  const [state, setState] = useState<EvaluationState>(EMPTY);
  const listingId = listing?.id ?? null;

  useEffect(() => {
    if (!listing || !priceIndex || !latestPeriod) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ ...EMPTY, loading: true });
    const target = municipalities.find((municipality) => municipality.code === listing.municipalityCode);
    const codes = target
      ? municipalities.filter((municipality) => municipality.group === target.group).map((municipality) => municipality.code)
      : [listing.municipalityCode];
    void loadTransactionsForCodes([...new Set([...codes, listing.municipalityCode])]).then((transactions) => {
      if (cancelled) return;
      const evaluation = evaluateListing({ listing, transactions, municipalities, priceIndex, latestPeriod, negotiationRate, config, timeAdjust });
      setState({ evaluation, transactions, loading: false, error: null });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setState({ ...EMPTY, error: error instanceof Error ? error.message : '比較事例を読み込めませんでした' });
    });
    return () => { cancelled = true; };
  }, [listingId, listing, municipalities, priceIndex, latestPeriod, negotiationRate, config, timeAdjust]);

  return state;
}
