import type { FinancingSettings } from '../types';
import { formatManYen } from '../lib/format';
import { LOAN_RULES, annualPaymentCapYen, burdenRatio, monthlyPayment, principalForMonthly } from '../lib/financing';

interface FinancingSummaryProps {
  settings: FinancingSettings;
}

const AMOUNTS = [5_000_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000];
const TERMS = [10, 20, 35];
const EXAMPLE_PRICE = 20_000_000;

export function formatYen(value: number): string {
  return `${Math.round(value).toLocaleString('ja-JP')}円`;
}

/** 年齢で使える返済方法の説明（LOAN_RULES の公表条件から） */
function methodNotes(age: number | null): string[] {
  if (age === null) return ['年齢を入れると、使える返済方法を表示します。'];
  const term = Math.min(LOAN_RULES.flat35MaxTermYears, LOAN_RULES.flat35PayoffAge - age);
  const notes: string[] = [];
  if (age >= LOAN_RULES.flat35MaxApplyAge) {
    notes.push(`${age}歳では、フラット35（申込時に満70歳未満が条件）に一人では申し込めません。子・孫など（申込時に満70歳未満）が連帯債務者になる「親子リレー返済」なら使えます。`);
  } else if (term < LOAN_RULES.flat35MinTermYears) {
    notes.push(`${age}歳では、フラット35の返済期間（15年以上で、80歳まで）が取れません。親子リレー返済なら使えます。`);
  } else {
    notes.push(`${age}歳なら、フラット35の返済期間は最長${term}年です（80歳で完済、最長35年）。`);
  }
  if (age >= LOAN_RULES.reverse60MinAge) {
    notes.push('満60歳以上なので「リ・バース60」（毎月は利息のみ）の対象です。');
  }
  return notes;
}

/** 自分の条件の下に出す「金利◯%だといくらか」の整理 */
export default function FinancingSummary({ settings }: FinancingSummaryProps) {
  const rate = settings.ratePct;
  const age = settings.ageYears;
  const cap = annualPaymentCapYen(settings.annualIncomeYen);
  const monthlyCap = cap === null ? null : cap / 12;
  const incomeLimit = monthlyCap === null ? null : principalForMonthly(monthlyCap, rate, 'interest_only', 0);
  const exampleLoan = EXAMPLE_PRICE * (settings.loanToValuePct / 100);
  const relayOnly = (term: number) => age !== null && (age >= LOAN_RULES.flat35MaxApplyAge || age + term > LOAN_RULES.flat35PayoffAge);
  const cell = (payment: number, key: number | string = 'interest') => (
    <td key={key} className={monthlyCap !== null && payment > monthlyCap ? 'cell--over' : undefined}>
      {formatYen(payment)}{monthlyCap !== null && payment > monthlyCap ? <><br /><small>年収の上限を超える</small></> : null}
    </td>
  );

  return (
    <section className="detail-card financing-summary">
      <h3>金利{rate}%で借りた場合の整理</h3>
      <dl className="detail-grid">
        <div>
          <dt>年収から見た返済の上限</dt>
          <dd>{cap === null || settings.annualIncomeYen === null ? '年収が未入力です' : `年${formatManYen(cap)}（月${formatYen(cap / 12)}）。年収${formatManYen(settings.annualIncomeYen)}の${Math.round(burdenRatio(settings.annualIncomeYen) * 100)}%（総返済負担率の基準）`}</dd>
        </div>
        <div>
          <dt>利息のみ型で借りられる額（年収から）</dt>
          <dd>{incomeLimit === null ? '年収が未入力です' : `計算上は${formatManYen(incomeLimit)}まで。ただし実際は担保評価額の${settings.loanToValuePct}%で頭打ちになります`}</dd>
        </div>
        <div className="form-grid__wide">
          <dt>例：{formatManYen(EXAMPLE_PRICE)}の物件（新耐震）をリ・バース60型で買う場合</dt>
          <dd>借入の目安 {formatManYen(exampleLoan)}（担保評価額の{settings.loanToValuePct}%）、毎月の利息 約{formatYen(monthlyPayment(exampleLoan, rate, 'interest_only', 0))}。残りの{formatManYen(EXAMPLE_PRICE - exampleLoan)}と諸費用は手元資金から払います。</dd>
        </div>
      </dl>
      <ul className="financing-notes">{methodNotes(age).map((note) => <li key={note}>{note}</li>)}</ul>

      <h4>借入額ごとの毎月の返済（金利{rate}%）</h4>
      <div className="table-wrap">
        <table className="listing-table financing-table">
          <thead><tr>
            <th>借入額</th>
            <th>利息のみ<br /><small>リ・バース60型</small></th>
            {TERMS.map((term) => <th key={term}>元利均等 {term}年{relayOnly(term) ? <><br /><small>親子リレーが前提</small></> : null}</th>)}
          </tr></thead>
          <tbody>{AMOUNTS.map((amount) => (
            <tr key={amount}>
              <td>{formatManYen(amount)}</td>
              {cell(monthlyPayment(amount, rate, 'interest_only', 0))}
              {TERMS.map((term) => cell(monthlyPayment(amount, rate, 'amortizing', term), term))}
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h4>リ・バース60のおもな条件</h4>
      <ul className="financing-notes">
        <li>申込時に満60歳以上。毎月の支払いは利息だけで、元金は亡くなったときに一括で返します（物件の売却など）。</li>
        <li>借入は担保評価額の50%または60%まで。残りと諸費用は手元資金が必要です。</li>
        <li>新耐震基準相当の耐震性が必要です（旧耐震の物件では使えません）。</li>
        <li>総返済負担率は、年収400万円未満なら30%以下、400万円以上なら35%以下。</li>
        <li>ノンリコース型なら、売却しても返しきれない分を相続人が返す必要はありません（リコース型は必要）。</li>
      </ul>
      <p className="form-note">
        金利や細かな条件は金融機関ごとに異なります。ここの数字は目安で、借りられることを保証するものではありません。条件の出典：
        <a href="https://www.jhf.go.jp/kojin/yushihoken_revmo/jouken.html" target="_blank" rel="noopener noreferrer">リ・バース60の利用条件（住宅金融支援機構）</a>、
        <a href="https://www.flat35.com/loan/lineup/flat35/conditions/index.html" target="_blank" rel="noopener noreferrer">フラット35の利用条件</a>（2026年9月確認）
      </p>
    </section>
  );
}
