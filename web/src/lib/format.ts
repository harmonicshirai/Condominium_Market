export function formatManYen(value: number): string {
  return `${Math.round(value / 10_000).toLocaleString('ja-JP')}万円`;
}

export function formatPpsqm(value: number): string {
  return `${(value / 10_000).toFixed(1)}万円/㎡`;
}

export function formatPct(value: number): string {
  if (value === 0) return '0.0%';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function formatPeriod(period: string): string {
  const match = /^(\d{4})Q([1-4])$/.exec(period);
  if (!match) return '期間不明';
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return `${year}年${startMonth}〜${endMonth}月`;
}

export function localIsoDate(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function labelText(label: 'below' | 'near' | 'above' | 'hold'): string {
  const labels = {
    below: '周辺の成約相場より低い',
    near: '周辺の成約相場に近い',
    above: '周辺の成約相場より高い',
    hold: '判定保留',
  } satisfies Record<typeof label, string>;
  return labels[label];
}

export function seismicText(seismic: 'new' | 'old' | 'unknown'): string {
  const labels = {
    new: '新耐震（1983年以降の竣工）',
    old: '旧耐震（1980年以前の竣工）',
    unknown: '要確認（1981〜82年竣工、または不明）',
  } satisfies Record<typeof seismic, string>;
  return labels[seismic];
}
