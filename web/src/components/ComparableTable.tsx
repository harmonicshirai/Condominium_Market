import type { Evaluation } from '../types';
import { formatPpsqm, formatPeriod } from '../lib/format';

interface ComparableTableProps {
  evaluation: Evaluation;
}

export default function ComparableTable({ evaluation }: ComparableTableProps) {
  const rows = [...evaluation.comparables].sort((left, right) => right.tx.period.localeCompare(left.tx.period));
  if (rows.length === 0) return <p className="empty-state">条件に合う比較事例はありません。</p>;
  return (
    <div className="table-wrap">
      <table className="listing-table comparable-table">
        <thead><tr><th>取引時期</th><th>地区</th><th>面積</th><th>築年数</th><th>改装</th><th>㎡単価（補正前 → 補正後）</th><th>区分</th></tr></thead>
        <tbody>{rows.map(({ tx, adjustedPricePerSqm }) => (
          <tr key={tx.id}>
            <td>{formatPeriod(tx.period)}</td>
            <td>{tx.district || '不明'}</td>
            <td>{tx.areaSqm.toFixed(1)}㎡</td>
            <td>{tx.ageAtTrade === null ? '不明' : `${tx.ageAtTrade}年`}</td>
            <td>{tx.renovation === 'renovated' ? '改装済み' : tx.renovation === 'not_renovated' ? '未改装' : '不明'}</td>
            <td>{formatPpsqm(tx.pricePerSqm)} → {formatPpsqm(adjustedPricePerSqm)}</td>
            <td>{tx.priceCategory === 'contract' ? '成約' : '取引'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
