import type { Listing, MyConditions } from '../types';
import { formatManYen } from '../lib/format';
import { paymentPlan, type BudgetFit, type LoanStatus } from '../lib/financing';
import { formatYen } from './FinancingSummary';

interface PaymentCardProps {
  listing: Listing;
  conditions: MyConditions;
}

export const BUDGET_FIT_TEXT: Record<BudgetFit, string> = {
  cash: '予算内（一括で払える）',
  with_loan: '借入を足せば予算内',
  over: '予算を超える',
  unknown: '予算が未設定',
};

export const LOAN_STATUS_TEXT: Record<LoanStatus, string> = {
  ok: '借りられる目安',
  conditional: '条件つき（下の注意を確認）',
  ineligible: 'この条件では借りられない',
};

/** 物件詳細の「支払いの目安」（一括の総額と、ローンを使う場合の毎月の支払い） */
export default function PaymentCard({ listing, conditions }: PaymentCardProps) {
  const plan = paymentPlan({
    listing,
    negotiationRate: conditions.negotiationRate,
    closingCostRate: conditions.closingCostRate,
    budgetYen: conditions.budgetYen,
    settings: conditions.financing,
  });
  if (!plan) return null;
  const loan = plan.loan;
  const closingPct = Math.round(conditions.closingCostRate * 1000) / 10;
  return (
    <section className="detail-card payment-card">
      <h3>支払いの目安</h3>
      <div className="evaluation-stats">
        <p><span>一括で払う場合（価格＋諸費用{closingPct}%）</span><strong>{formatManYen(plan.totalCostYen)}</strong></p>
        <p><span>予算との比較</span><strong className={`budget-fit budget-fit--${plan.budgetFit}`}>{BUDGET_FIT_TEXT[plan.budgetFit]}</strong></p>
        <p><span>毎月の管理費＋修繕積立金</span><strong>{plan.monthlyFeesYen === null ? '不明（詳細が未取得）' : formatYen(plan.monthlyFeesYen)}</strong></p>
      </div>
      {conditions.negotiationRate > 0 ? <p className="form-note">価格は想定値引き率{conditions.negotiationRate * 100}%を引いた{formatManYen(plan.priceYen)}で計算しています。</p> : null}
      {loan ? (
        <>
          <h4>ローンを使う場合（{loan.method === 'interest_only' ? '毎月は利息のみ・リ・バース60型' : `元利均等 ${loan.termYears}年`}・金利{conditions.financing.ratePct}%）</h4>
          <p className={`loan-status loan-status--${loan.status}`}>{LOAN_STATUS_TEXT[loan.status]}</p>
          {loan.status === 'ineligible' ? null : (
            <div className="evaluation-stats">
              <p><span>借入額{conditions.budgetYen === null ? '（上限まで借りた場合）' : '（予算で足りない分）'}</span><strong>{formatManYen(loan.loanYen)}</strong></p>
              <p><span>借りられる上限の目安</span><strong>{formatManYen(loan.maxLoanYen)}</strong><small>{loan.limitedBy === 'value' ? '担保評価額で決まる' : '年収（返済負担率）で決まる'}</small></p>
              <p><span>手元から出す額</span><strong>{formatManYen(loan.cashYen)}</strong></p>
              <p><span>毎月の返済</span><strong>{formatYen(loan.monthlyPaymentYen)}</strong></p>
              <p><span>毎月の合計（返済＋管理費等）</span><strong>{loan.monthlyTotalYen === null ? '不明' : formatYen(loan.monthlyTotalYen)}</strong></p>
            </div>
          )}
          <ul className="financing-notes">{loan.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </>
      ) : <p className="form-note">「自分の条件」で年齢と年収を入れて「ローンの試算も表示する」を選ぶと、ローンを使う場合の毎月の支払いも出ます。</p>}
    </section>
  );
}
