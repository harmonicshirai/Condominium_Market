import type { PriceObservation } from '../types';

export interface PriceHistorySummary {
  firstDate: string;
  lastDate: string;
  daysListed: number;
  initialPrice: number;
  currentPrice: number;
  changeCount: number;
  totalChange: number;
  totalChangePct: number;
  lastChangeDate: string | null;
}

export function summarizePriceHistory(history: PriceObservation[], today: string): PriceHistorySummary | null {
  if (history.length === 0) return null;
  const ordered = [...history].sort((left, right) => left.date.localeCompare(right.date));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (!first || !last) return null;
  let changeCount = 0;
  let lastChangeDate: string | null = null;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous && current && previous.priceYen !== current.priceYen) {
      changeCount += 1;
      lastChangeDate = current.date;
    }
  }
  const totalChange = last.priceYen - first.priceYen;
  const daysListed = Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / 86_400_000));
  return {
    firstDate: first.date,
    lastDate: last.date,
    daysListed,
    initialPrice: first.priceYen,
    currentPrice: last.priceYen,
    changeCount,
    totalChange,
    totalChangePct: first.priceYen > 0 ? Math.round((totalChange / first.priceYen) * 1000) / 10 : 0,
    lastChangeDate,
  };
}

export function upsertPriceObservation(history: PriceObservation[], observation: PriceObservation): PriceObservation[] {
  return [...history.filter((item) => item.date !== observation.date), observation]
    .sort((left, right) => left.date.localeCompare(right.date));
}
