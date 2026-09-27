export function quantile(values: number[], q: number): number {
  if (values.length === 0) throw new RangeError('分位点を計算する値がありません');
  if (q < 0 || q > 1) throw new RangeError('分位点は0〜1で指定してください');
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}
