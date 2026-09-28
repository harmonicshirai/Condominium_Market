import type { ReactNode } from 'react';
import type { Municipality, MyConditions } from '../types';
import { formatManYen, formatPct, formatPpsqm, labelText, seismicText } from '../lib/format';
import { paymentPlan, type PaymentPlan } from '../lib/financing';
import { summarizePriceHistory } from '../lib/priceHistory';
import { bestIndexes, type SavedItem } from '../lib/saved';
import { listingSeismic } from '../lib/valuation';
import { formatYen } from './FinancingSummary';
import { BUDGET_FIT_TEXT } from './PaymentCard';
import FloorPlanImage from './FloorPlanImage';

interface CompareTableProps {
  items: SavedItem[];
  conditions: MyConditions;
  municipalities: Municipality[];
  today: string;
  onOpen: (item: SavedItem) => void;
  onRemove: (item: SavedItem) => void;
}

interface Row {
  label: string;
  cell: (item: SavedItem, plan: PaymentPlan | null) => ReactNode;
  /** 一番よい値に印を付ける行 */
  value?: (item: SavedItem, plan: PaymentPlan | null) => number | null;
  best?: 'min' | 'max';
}

const dash = '—';
const price = (item: SavedItem) => item.listing.priceHistory.at(-1)?.priceYen ?? null;

export default function CompareTable({ items, conditions, municipalities, today, onOpen, onRemove }: CompareTableProps) {
  const plans = items.map((item) => paymentPlan({
    listing: item.listing,
    negotiationRate: conditions.negotiationRate,
    closingCostRate: conditions.closingCostRate,
    budgetYen: conditions.budgetYen,
    settings: conditions.financing,
  }));
  const showLoan = conditions.financing.showLoan;
  const rows: Row[] = [
    ...(items.some((item) => item.local?.floorPlanThumbUrl) ? [{
      label: '間取り図',
      cell: (item: SavedItem) => item.local?.floorPlanThumbUrl
        ? <FloorPlanImage url={item.local.floorPlanThumbUrl} largeUrl={item.local.floorPlanImageUrl} size="card" />
        : <small>{item.kind === 'local' ? '未取得' : dash}</small>,
    }] : []),
    {
      label: '売出価格', value: price, best: 'min',
      cell: (item) => {
        const current = price(item);
        const history = summarizePriceHistory(item.listing.priceHistory, today);
        return <>{current === null ? dash : formatManYen(current)}{history && history.totalChange < 0 ? <><br /><small>最初から {formatManYen(history.totalChange)}（{history.changeCount}回）</small></> : null}</>;
      },
    },
    { label: '一括で払う額（諸費用込み）', value: (_item, plan) => plan?.totalCostYen ?? null, best: 'min', cell: (_item, plan) => plan ? formatManYen(plan.totalCostYen) : dash },
    { label: '予算との比較', cell: (_item, plan) => plan ? <span className={`budget-fit budget-fit--${plan.budgetFit}`}>{BUDGET_FIT_TEXT[plan.budgetFit]}</span> : dash },
    { label: '管理費＋修繕積立金（月）', value: (_item, plan) => plan?.monthlyFeesYen ?? null, best: 'min', cell: (_item, plan) => plan?.monthlyFeesYen === null || !plan ? '不明' : formatYen(plan.monthlyFeesYen) },
    ...(showLoan ? [
      { label: 'ローンの借入額', cell: (_item: SavedItem, plan: PaymentPlan | null) => !plan?.loan ? dash : plan.loan.status === 'ineligible' ? <span className="loan-status--ineligible">借りられない</span> : <>{formatManYen(plan.loan.loanYen)}{plan.loan.status === 'conditional' ? <><br /><small>条件つき</small></> : null}</> },
      { label: '毎月の支払い（返済＋管理費等）', value: (_item: SavedItem, plan: PaymentPlan | null) => plan?.loan && plan.loan.status !== 'ineligible' ? plan.loan.monthlyTotalYen : null, best: 'min' as const, cell: (_item: SavedItem, plan: PaymentPlan | null) => !plan?.loan || plan.loan.status === 'ineligible' ? dash : plan.loan.monthlyTotalYen === null ? `返済 ${formatYen(plan.loan.monthlyPaymentYen)}＋管理費等 不明` : formatYen(plan.loan.monthlyTotalYen) },
    ] : []),
    { label: '専有面積・間取り', value: (item) => item.listing.areaSqm, best: 'max', cell: (item) => `${item.listing.areaSqm.toFixed(1)}㎡ ${item.listing.floorPlan || ''}` },
    { label: '㎡単価', value: (item) => { const current = price(item); return current === null ? null : current / item.listing.areaSqm; }, best: 'min', cell: (item) => { const current = price(item); return current === null ? dash : formatPpsqm(current / item.listing.areaSqm); } },
    { label: '築年・耐震', value: (item) => item.listing.buildingYear, best: 'max', cell: (item) => <>{item.listing.buildingYear ?? '不明'}{item.listing.buildingYear ? '年' : ''}<br /><small>{seismicText(listingSeismic(item.listing.buildingYear)).split('（')[0]}</small></> },
    { label: '最寄駅・徒歩', value: (item) => item.listing.walkMinutes, best: 'min', cell: (item) => `${item.listing.station || '不明'}${item.listing.walkMinutes === null ? '' : ` 徒歩${item.listing.walkMinutes}分`}` },
    { label: '所在階', cell: (item) => item.listing.floor === null ? '不明' : `${item.listing.floor}階${item.listing.totalFloors === null ? '' : ` / ${item.listing.totalFloors}階建`}` },
    { label: '向き・総戸数', cell: (item) => item.local ? `${item.local.direction ?? '不明'}・${item.local.totalUnits === null ? '不明' : `${item.local.totalUnits}戸`}` : dash },
    { label: '土地の権利', cell: (item) => item.local?.landRights ?? '不明' },
    {
      label: '相場との比較', value: (item) => item.evaluation && item.evaluation.label !== 'hold' ? item.evaluation.gapPct : null, best: 'min',
      cell: (item) => !item.evaluation ? '計算中' : <>{item.evaluation.gapPct === null || item.evaluation.label === 'hold' ? '保留' : formatPct(item.evaluation.gapPct)}<br /><small>{labelText(item.evaluation.label)}・信頼度 {item.evaluation.confidence}</small></>,
    },
    { label: '推定レンジ', cell: (item) => item.evaluation?.estimatedLow && item.evaluation.estimatedHigh ? `${formatManYen(item.evaluation.estimatedLow)}〜${formatManYen(item.evaluation.estimatedHigh)}` : dash },
    { label: '市区町村', cell: (item) => municipalities.find((municipality) => municipality.code === item.listing.municipalityCode)?.name ?? '不明' },
    {
      label: '掲載', cell: (item) => {
        const history = summarizePriceHistory(item.listing.priceHistory, today);
        if (!item.local) return '自分で登録';
        return <>{item.local.status === 'removed' ? <strong className="badge badge--removed">掲載終了</strong> : '掲載中'}{history ? ` ${history.daysListed}日` : ''}<br /><small>詳細 {item.local.detailFetchedAt ? '取得済み' : '未取得'}</small></>;
      },
    },
  ];

  return (
    <div className="table-wrap compare-wrap">
      <table className="compare-table">
        <thead>
          <tr>
            <th scope="col" className="compare-table__label">項目</th>
            {items.map((item) => (
              <th scope="col" key={item.listing.id}>
                <button type="button" className="text-button compare-table__name" onClick={() => onOpen(item)}>{item.listing.name || '名称なし'}</button>
                <button type="button" className="text-button" onClick={() => onRemove(item)}>比較から外す</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map((row) => {
          const best = row.value && row.best ? bestIndexes(items.map((item, index) => row.value!(item, plans[index])), row.best) : new Set<number>();
          return (
            <tr key={row.label}>
              <th scope="row" className="compare-table__label">{row.label}</th>
              {items.map((item, index) => <td key={item.listing.id} className={best.has(index) ? 'cell--best' : undefined}>{row.cell(item, plans[index])}</td>)}
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
