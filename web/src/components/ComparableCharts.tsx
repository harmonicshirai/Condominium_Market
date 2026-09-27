import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Evaluation, Listing, PriceIndex, Transaction } from '../types';
import { buildChartData } from '../lib/chartData';

interface ComparableChartsProps {
  listing: Listing;
  evaluation: Evaluation;
  transactions: Transaction[];
  latestPeriod: string;
  priceIndex: PriceIndex;
}

function yenPerSqm(value: number): string {
  return `${(value / 10_000).toFixed(1)}万円/㎡`;
}

export default function ComparableCharts({ listing, evaluation, transactions, latestPeriod, priceIndex }: ComparableChartsProps) {
  const chart = buildChartData({ listing, evaluation, transactions, latestPeriod, priceIndex });
  const trendData = chart.trend;

  return (
    <div className="chart-grid">
      <article className="chart-card">
        <h4>築年数 × ㎡単価</h4>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 12, right: 18, bottom: 18, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" name="築年数" unit="年" />
            <YAxis type="number" dataKey="y" name="㎡単価" tickFormatter={(value: number) => `${value}万円`} />
            <Tooltip formatter={(value) => typeof value === 'number' ? `${value.toFixed(1)}万円/㎡` : value} />
            <Scatter name="同じ市区町村の成約事例" data={chart.ageBackground} fill="var(--color-muted)" />
            <Scatter name="比較に使用" data={chart.ageComparables} fill="var(--color-accent)" />
            {chart.ageTarget ? <Scatter name="この物件（実効価格）" data={[chart.ageTarget]} fill="var(--color-price)" shape="star" /> : null}
          </ScatterChart>
        </ResponsiveContainer>
      </article>
      <article className="chart-card">
        <h4>面積 × 価格</h4>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 12, right: 18, bottom: 18, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" name="面積" unit="㎡" />
            <YAxis type="number" dataKey="y" name="価格" tickFormatter={(value: number) => `${value}百万円`} />
            <Tooltip formatter={(value) => typeof value === 'number' ? `${value.toFixed(1)}百万円` : value} />
            <Scatter name="同じ市区町村の成約事例" data={chart.areaBackground} fill="var(--color-muted)" />
            <Scatter name="比較に使用" data={chart.areaComparables} fill="var(--color-accent)" />
            <Scatter name="この物件（実効価格）" data={[chart.areaTarget]} fill="var(--color-price)" shape="star" />
          </ScatterChart>
        </ResponsiveContainer>
      </article>
      <article className="chart-card chart-card--wide">
        <h4>地域の成約㎡単価の推移（中央値・5件以上）</h4>
        {trendData.length === 0 ? <p className="empty-state">表示できる四半期データがありません。</p> : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trendData} margin={{ top: 12, right: 20, bottom: 8, left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" />
              <YAxis tickFormatter={(value: number) => `${value}万円`} />
              <Tooltip formatter={(value) => typeof value === 'number' ? yenPerSqm(value * 10_000) : value} />
              <Line type="monotone" dataKey="median" name="㎡単価中央値" stroke="var(--color-accent)" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        )}
      </article>
    </div>
  );
}
