import { useState, type FormEvent } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PriceObservation } from '../types';
import { formatManYen, localIsoDate } from '../lib/format';
import { summarizePriceHistory, upsertPriceObservation } from '../lib/priceHistory';

interface PriceHistoryProps {
  history: PriceObservation[];
  /** 無ければ閲覧専用（記録フォームを出さない） */
  onSave?: (history: PriceObservation[]) => void;
}

export default function PriceHistory({ history, onSave }: PriceHistoryProps) {
  const today = localIsoDate();
  const [date, setDate] = useState(today);
  const [price, setPrice] = useState('');
  const [memo, setMemo] = useState('');
  const summary = summarizePriceHistory(history, today);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const observation = { date, priceYen: Number(price), memo: memo.trim() };
    if (!Number.isInteger(observation.priceYen) || observation.priceYen <= 0) return;
    if (history.some((item) => item.date === date) && !window.confirm(`${date} の価格記録を上書きしますか？`)) return;
    onSave?.(upsertPriceObservation(history, observation));
    setPrice('');
    setMemo('');
  }

  return (
    <section className="content-section price-history-section">
      <h3>売出価格の推移</h3>
      {onSave ? <p className="form-note">掲載ページを見直したときに価格を記録すると、値下げの履歴が残ります</p> : <p className="form-note">取得ツールが一覧を取得するたびに価格を記録しています</p>}
      {onSave ? <form className="price-history-form" onSubmit={submit}>
        <label className="form-field"><span>確認日</span><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="form-field"><span>価格（円）</span><input type="number" min="1" required value={price} onChange={(event) => setPrice(event.target.value)} /></label>
        <label className="form-field"><span>メモ</span><input value={memo} onChange={(event) => setMemo(event.target.value)} /></label>
        <button type="submit" className="button button--primary">価格を記録</button>
      </form> : null}
      {!summary || history.length < 2 ? <p className="empty-state">価格の記録が1件のため推移はまだありません</p> : (
        <>
          <div className="history-stats">
            <p><span>初回価格</span><strong>{formatManYen(summary.initialPrice)}</strong></p>
            <p><span>現在価格</span><strong>{formatManYen(summary.currentPrice)}</strong></p>
            <p><span>値下げ・変更回数</span><strong>{summary.changeCount}回</strong></p>
            <p><span>初回からの変化</span><strong>{formatManYen(Math.abs(summary.totalChange))}{summary.totalChange < 0 ? '下落' : summary.totalChange > 0 ? '上昇' : '変化なし'}（{summary.totalChangePct.toFixed(1)}%）</strong></p>
            <p><span>掲載日数</span><strong>{summary.daysListed}日</strong></p>
            <p><span>直近の価格変更日</span><strong>{summary.lastChangeDate ?? '変更なし'}</strong></p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={[...history].sort((left, right) => left.date.localeCompare(right.date))} margin={{ top: 10, right: 20, bottom: 8, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value: number) => `${(value / 10_000).toFixed(0)}万円`} />
              <Tooltip formatter={(value) => typeof value === 'number' ? formatManYen(value) : value} />
              <Line type="monotone" dataKey="priceYen" name="売出価格" stroke="var(--color-accent)" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </section>
  );
}
