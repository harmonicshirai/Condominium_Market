import { useMemo, useState } from 'react';
import {
  CartesianGrid, Label, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import type { Evaluation, Listing, LocalListing, Municipality, RegionIndex, RegionSeries } from '../types';
import { formatManYen, formatPct, formatPeriod } from '../lib/format';
import { latestPosition, listingRegionChange, rebased, regionChange, type RegionChange, type RegionLevel } from '../lib/regionIndex';

export interface TrendListing {
  kind: 'local' | 'mine';
  listing: Listing | LocalListing;
  evaluation: Evaluation | undefined;
}

interface MarketTrendsProps {
  index: RegionIndex;
  basePos: number;
  onBaseChange: (pos: number) => void;
  municipalities: Municipality[];
  listings: TrendListing[];
  onOpen: (kind: 'local' | 'mine', id: string) => void;
}

const MAX_SELECTED = 5;
const LEVEL_LABELS: Record<RegionLevel, string> = { municipality: '市区町村', group: 'グループ', station: '駅（CSVの事例がある駅）' };

function shortPeriod(period: string): string {
  const match = /^(\d{2})(\d{2})Q([1-4])$/.exec(period);
  return match ? `${match[2]}Q${match[3]}` : period;
}

/** Recharts の Scatter の onClick は点そのもの、または payload に点を入れて渡すため両方に対応する */
function pointId(data: unknown): string | null {
  const record = data as { id?: unknown; payload?: { id?: unknown } } | null;
  const id = record?.payload?.id ?? record?.id;
  return typeof id === 'string' ? id : null;
}

function signedPt(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}pt`;
}

export default function MarketTrends({ index, basePos, onBaseChange, municipalities, listings, onOpen }: MarketTrendsProps) {
  const latestPos = latestPosition(index);
  const listingMunicipality = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of listings) counts.set(item.listing.municipalityCode, (counts.get(item.listing.municipalityCode) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }, [listings]);
  const [level, setLevel] = useState<RegionLevel>('municipality');
  const [smoothed, setSmoothed] = useState(true);
  const [stationFilter, setStationFilter] = useState(listingMunicipality);
  // 色は選んだ順に固定の枠へ割り当て、外しても他の地域の色は変えない
  const [slots, setSlots] = useState<Record<string, number>>(() => (listingMunicipality ? { [`municipality:${listingMunicipality}`]: 1 } : {}));

  const seriesOfLevel = (target: RegionLevel): RegionSeries[] => (
    target === 'municipality' ? index.municipalities
      : target === 'group' ? index.groups
        : index.stations.filter((item) => !stationFilter || item.municipalityCodes?.[0] === stationFilter)
  );
  const rows = useMemo(() => seriesOfLevel(level)
    .map((series) => regionChange(index, series, level, basePos, latestPos))
    .filter((row): row is RegionChange => row !== null)
    .sort((a, b) => b.changePct - a.changePct),
  [index, level, basePos, latestPos, stationFilter]);
  const average = regionChange(index, index.average, 'average', basePos, latestPos);
  const maxAbsPt = Math.max(5, ...rows.map((row) => Math.abs(row.vsAveragePt)));

  const allSeries = [...index.municipalities.map((s) => ['municipality', s] as const), ...index.groups.map((s) => ['group', s] as const), ...index.stations.map((s) => ['station', s] as const)];
  const selected = allSeries
    .map(([lv, series]) => ({ key: `${lv}:${series.id}`, series, slot: slots[`${lv}:${series.id}`] }))
    .filter((item): item is { key: string; series: RegionSeries; slot: number } => item.slot !== undefined)
    .sort((a, b) => a.slot - b.slot);

  function toggle(key: string): void {
    setSlots((current) => {
      if (current[key] !== undefined) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      const used = new Set(Object.values(current));
      const free = [1, 2, 3, 4, 5].find((slot) => !used.has(slot));
      return free === undefined ? current : { ...current, [key]: free };
    });
  }

  const chartData = useMemo(() => {
    const averageValues = rebased(index.average, basePos, smoothed);
    const values = selected.map((item) => [item.key, rebased(item.series, basePos, smoothed)] as const);
    return index.periods.map((period, pos) => {
      const row: Record<string, number | string | null> = { period: shortPeriod(period), average: averageValues[pos] };
      for (const [key, series] of values) row[key] = series[pos];
      return row;
    });
  }, [index, basePos, smoothed, selected]);

  const points = useMemo(() => listings.flatMap((item) => {
    const evaluation = item.evaluation;
    if (!evaluation || evaluation.label === 'hold' || evaluation.gapPct === null) return [];
    if ('status' in item.listing && item.listing.status === 'removed') return [];
    const region = listingRegionChange(index, item.listing, municipalities, basePos);
    if (!region) return [];
    return [{
      x: Math.round(region.vsAveragePt * 10) / 10, y: evaluation.gapPct, kind: item.kind, id: item.listing.id,
      name: item.listing.name || '名称なし', region: `${region.series.name}${region.level === 'station' ? '駅周辺' : ''}`,
      price: item.listing.priceHistory.at(-1)?.priceYen ?? 0, confidence: evaluation.confidence, lowN: region.lowN,
    }];
  }), [listings, index, municipalities, basePos]);
  // 縦軸は外れ値で広がりすぎないよう、2〜98パーセンタイルの範囲に切る（範囲外の点は端に寄せて描く）
  const yDomain = useMemo((): [number, number] => {
    const ys = points.map((point) => point.y).sort((a, b) => a - b);
    if (ys.length === 0) return [-50, 50];
    const at = (q: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.round((ys.length - 1) * q)))];
    return [Math.min(-10, Math.floor(at(0.02) / 10) * 10), Math.max(10, Math.ceil(at(0.98) / 10) * 10)];
  }, [points]);
  const clipped = (point: (typeof points)[number]) => ({ ...point, y: Math.min(yDomain[1], Math.max(yDomain[0], point.y)), rawY: point.y });
  const hotAndCheap = points.filter((point) => point.x > 0 && point.y <= -5 && !point.lowN).sort((a, b) => a.y - b.y).slice(0, 8);

  return (
    <section className="content-section trends">
      <div className="section-heading section-heading--content">
        <h2>地域の動き</h2>
        <span className="count-note">{formatPeriod(index.periods[basePos])}＝100・最新 {formatPeriod(index.periods[latestPos])}</span>
      </div>
      <div className="filter-row trends-controls" aria-label="表示の条件">
        <label>基準の四半期<select value={basePos} onChange={(event) => onBaseChange(Number(event.target.value))}>
          {index.periods.map((period, pos) => pos < latestPos ? <option key={period} value={pos}>{formatPeriod(period)}{period === index.defaultBase ? '（既定・金利上昇前）' : ''}</option> : null)}
        </select></label>
        <label>地域の単位<select value={level} onChange={(event) => setLevel(event.target.value as RegionLevel)}>
          {(Object.keys(LEVEL_LABELS) as RegionLevel[]).map((key) => <option key={key} value={key}>{LEVEL_LABELS[key]}</option>)}
        </select></label>
        {level === 'station' ? (
          <label>駅の市区町村<select value={stationFilter} onChange={(event) => setStationFilter(event.target.value)}>
            <option value="">すべて</option>
            {index.municipalities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        ) : null}
        <label className="check-inline"><input type="checkbox" checked={smoothed} onChange={(event) => setSmoothed(event.target.checked)} />4四半期の移動平均</label>
      </div>

      {average ? (
        <div className="trend-kpis">
          <p><span>関西平均（2府4県）</span><strong>{formatPct(average.changePct)}</strong><small>{formatPeriod(index.periods[basePos])} → {formatPeriod(index.periods[latestPos])}</small></p>
          {selected.slice(0, 3).map((item) => {
            const change = regionChange(index, item.series, 'municipality', basePos, latestPos);
            return change ? <p key={item.key}><span><i className={`swatch swatch--${item.slot}`} aria-hidden="true" />{item.series.name}</span><strong>{formatPct(change.changePct)}</strong><small>平均との差 {signedPt(change.vsAveragePt)}{change.lowN ? '・参考値' : ''}</small></p> : null;
          })}
        </div>
      ) : null}

      <article className="chart-card chart-card--wide">
        <h3>騰落の推移（{formatPeriod(index.periods[basePos])}＝100）</h3>
        <p className="form-note">一覧の行をクリックすると、その地域をグラフに加えます（最大{MAX_SELECTED}つ）。太い線が関西平均です。</p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 10, right: 24, bottom: 8, left: 4 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted)' }} domain={['auto', 'auto']} width={40} />
            <Tooltip formatter={(value) => (typeof value === 'number' ? value.toFixed(1) : '—')} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={100} stroke="var(--color-muted)" strokeDasharray="4 4" />
            <ReferenceLine x={shortPeriod(index.periods[basePos])} stroke="var(--color-muted)" strokeDasharray="2 3" />
            <Line type="monotone" dataKey="average" name="関西平均" stroke="var(--chart-average)" strokeWidth={3} dot={false} connectNulls />
            {selected.map((item) => (
              <Line key={item.key} type="monotone" dataKey={item.key} name={item.series.name} stroke={`var(--series-${item.slot})`} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </article>

      <article className="chart-card chart-card--wide">
        <h3>{LEVEL_LABELS[level]}ごとの騰落（関西平均 {average ? formatPct(average.changePct) : '—'} との差）</h3>
        <div className="table-wrap">
          <table className="listing-table trend-table">
            <thead><tr><th>地域</th><th>騰落率</th><th>関西平均との差</th></tr></thead>
            <tbody>{rows.map((row) => {
              const key = `${level}:${row.series.id}`;
              const slot = slots[key];
              const width = (Math.abs(row.vsAveragePt) / maxAbsPt) * 50;
              return (
                <tr key={key} onClick={() => toggle(key)} aria-selected={slot !== undefined} className={row.lowN ? 'row--removed' : undefined}>
                  <td>{slot !== undefined ? <i className={`swatch swatch--${slot}`} aria-hidden="true" /> : null}{row.series.name}
                    <br /><small>件数 {row.baseN} / {row.latestN}（基準・直近の4四半期）{row.lowN ? '・少なく参考値' : ''}</small></td>
                  <td>{formatPct(row.changePct)}<br /><small>{signedPt(row.vsAveragePt)}</small></td>
                  <td className="trend-table__bar">
                    <div className="diverging" role="img" aria-label={`関西平均との差 ${signedPt(row.vsAveragePt)}`}>
                      <span className={`diverging__bar diverging__bar--${row.vsAveragePt >= 0 ? 'up' : 'down'}`}
                        style={row.vsAveragePt >= 0 ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </article>

      <article className="chart-card chart-card--wide">
        <h3>地域の勢い × 物件の割安度</h3>
        <p className="form-note">
          横軸は物件の地域（駅 → 市区町村 → グループのうち件数が足りるもの）の騰落率と関西平均との差、縦軸は周辺の成約相場との差（相場比）です。
          右下ほど「平均より上がっている地域で、相場より安い」物件です。判定保留の物件は出していません。
        </p>
        {points.length === 0 ? <p className="empty-state">相場比が出ている物件がありません。</p> : (
          <div className="quadrant">
            <p className="quadrant__legend">右下＝平均より上がっている地域で、相場より安い／左上＝上がっていない地域で、相場より高い</p>
            <ResponsiveContainer width="100%" height={360}>
              <ScatterChart margin={{ top: 12, right: 24, bottom: 28, left: 8 }}>
                <CartesianGrid stroke="var(--chart-grid)" />
                <XAxis type="number" dataKey="x" name="関西平均との差" unit="pt" tick={{ fontSize: 11, fill: 'var(--color-muted)' }}>
                  <Label value="地域の騰落と関西平均の差（右ほど上がっている）" position="insideBottom" offset={-14} style={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                </XAxis>
                <YAxis type="number" dataKey="y" name="相場比" unit="%" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} width={52} domain={yDomain} allowDataOverflow>
                  <Label value="相場比（下ほど割安）" angle={-90} position="insideLeft" offset={4} style={{ fontSize: 11, fill: 'var(--color-muted)', textAnchor: 'middle' }} />
                </YAxis>
                <ZAxis range={[40, 40]} />
                <ReferenceLine x={0} stroke="var(--color-muted)" />
                <ReferenceLine y={0} stroke="var(--color-muted)" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
                  const point = payload?.[0]?.payload as ((typeof points)[number] & { rawY: number }) | undefined;
                  return point ? (
                    <div className="chart-tooltip">
                      <strong>{point.name}</strong>
                      <span>{point.region}：関西平均との差 {signedPt(point.x)}{point.lowN ? '（参考値）' : ''}</span>
                      <span>相場比 {formatPct(point.rawY)}・信頼度 {point.confidence}・{formatManYen(point.price)}</span>
                    </div>
                  ) : null;
                }} />
                {points.some((point) => point.kind === 'mine') ? <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} /> : null}
                <Scatter name="掲載物件（手元）" data={points.filter((point) => point.kind === 'local').map(clipped)} fill="var(--series-1)" fillOpacity={0.55}
                  onClick={(data) => { const id = pointId(data); if (id) onOpen('local', id); }} />
                {points.some((point) => point.kind === 'mine') ? <Scatter name="自分の物件" data={points.filter((point) => point.kind === 'mine').map(clipped)} fill="var(--series-2)" shape="diamond"
                  onClick={(data) => { const id = pointId(data); if (id) onOpen('mine', id); }} /> : null}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
        {hotAndCheap.length ? (
          <>
            <h4>平均より上がっている地域で、相場より5%以上安い物件</h4>
            <ul className="side-list">{hotAndCheap.map((point) => (
              <li key={point.id}><button type="button" onClick={() => onOpen(point.kind, point.id)}>
                {point.name}<span>{point.region} {signedPt(point.x)}・相場比 {formatPct(point.y)}・{formatManYen(point.price)}・信頼度 {point.confidence}</span>
              </button></li>
            ))}</ul>
          </>
        ) : null}
        <p className="form-note">
          騰落率は、国交省の成約・取引事例から築年数と面積の違いを除いて求めた四半期ごとの指数です（{index.smoothQuarters}四半期の移動平均）。
          関西平均は2府4県の中古マンション等の全事例から、市区町村の違いを除いて求めています。件数が少ない地域の値は大きく揺れるため「参考値」としています。
        </p>
      </article>
    </section>
  );
}
