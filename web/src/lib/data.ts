import type { Meta, Municipality, PriceIndex, Transaction } from '../types';

const transactionCache = new Map<string, Promise<Transaction[]>>();

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  if (!response.ok) throw new Error(`データを読み込めませんでした: ${path} (${response.status})`);
  return (await response.json()) as T;
}

export async function loadSiteData(): Promise<{
  meta: Meta;
  municipalities: Municipality[];
  priceIndex: PriceIndex;
}> {
  const [meta, municipalities, priceIndex] = await Promise.all([
    fetchJson<Meta>('meta.json'),
    fetchJson<Municipality[]>('municipalities.json'),
    fetchJson<PriceIndex>('price_index.json'),
  ]);
  return { meta, municipalities, priceIndex };
}

export function loadTransactions(code: string): Promise<Transaction[]> {
  const cached = transactionCache.get(code);
  if (cached) return cached;
  const request = fetchJson<Transaction[]>(`transactions/${code}.json`);
  transactionCache.set(code, request);
  request.catch(() => transactionCache.delete(code));
  return request;
}

export async function loadTransactionsForCodes(codes: string[]): Promise<Transaction[]> {
  const rows = await Promise.all(codes.map((code) => loadTransactions(code)));
  return rows.flat();
}
