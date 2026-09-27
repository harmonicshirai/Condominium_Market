import type { CheckItem, CheckStatus } from '../types';

const GROUPS: { id: CheckItem['category']; label: string }[] = [
  { id: 'price', label: '価格' },
  { id: 'building', label: '建物' },
  { id: 'hazard', label: '災害' },
  { id: 'mine', label: '自分の条件' },
];

const STATUS: Record<CheckStatus, { symbol: string; label: string }> = {
  ok: { symbol: '✓', label: '確認' },
  warn: { symbol: '!', label: '注意' },
  ng: { symbol: '×', label: '要確認' },
  unknown: { symbol: '?', label: '不明' },
  info: { symbol: 'i', label: '情報' },
};

export default function Checklist({ items }: { items: CheckItem[] }) {
  const counts = (group: CheckItem['category']) => {
    const selected = items.filter((item) => item.category === group);
    return (['ok', 'warn', 'ng', 'unknown'] as const).map((status) => `${STATUS[status].label} ${selected.filter((item) => item.status === status).length}件`).join('・');
  };
  return (
    <section className="content-section checklist-section">
      <h3>判断材料のまとめ</h3>
      <div className="checklist-summary">{GROUPS.map((group) => <p key={group.id}><strong>{group.label}</strong><span>{counts(group.id)}</span></p>)}</div>
      {GROUPS.map((group) => {
        const selected = items.filter((item) => item.category === group.id);
        if (selected.length === 0) return null;
        return <section key={group.id} className="checklist-group"><h4>{group.label}</h4><ul>{selected.map((item) => (
          <li key={item.id} className={`check-item check-item--${item.status}`}>
            <span className="check-item__status" aria-label={STATUS[item.status].label}>{STATUS[item.status].symbol} {STATUS[item.status].label}</span>
            <div><strong>{item.label}</strong><p>{item.detail}</p></div>
          </li>
        ))}</ul></section>;
      })}
    </section>
  );
}
