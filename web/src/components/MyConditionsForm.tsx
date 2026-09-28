import { useEffect, useState, type FormEvent } from 'react';
import type { LoanMethod, MyConditions } from '../types';
import { formatManYen } from '../lib/format';
import { conditionsSchema } from '../lib/storage';
import FinancingSummary from './FinancingSummary';

interface MyConditionsFormProps {
  conditions: MyConditions;
  onSave: (conditions: MyConditions) => void;
}

function inputNumber(value: number | null, divisor = 1): string {
  return value === null ? '' : String(value / divisor);
}

function toValues(conditions: MyConditions) {
  const financing = conditions.financing;
  return {
    budgetManYen: inputNumber(conditions.budgetYen, 10_000),
    minAreaSqm: inputNumber(conditions.minAreaSqm),
    maxWalkMinutes: inputNumber(conditions.maxWalkMinutes),
    maxMonthlyFeesYen: inputNumber(conditions.maxMonthlyFeesYen),
    negotiationPct: String(conditions.negotiationRate * 100),
    closingCostPct: String(Math.round(conditions.closingCostRate * 1000) / 10),
    showLoan: financing.showLoan,
    ageYears: inputNumber(financing.ageYears),
    incomeManYen: inputNumber(financing.annualIncomeYen, 10_000),
    ratePct: String(financing.ratePct),
    method: financing.method,
    termYears: inputNumber(financing.termYears),
    loanToValuePct: String(financing.loanToValuePct),
  };
}

type FormValues = ReturnType<typeof toValues>;

export default function MyConditionsForm({ conditions, onSave }: MyConditionsFormProps) {
  const [values, setValues] = useState<FormValues>(() => toValues(conditions));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValues(toValues(conditions));
  }, [conditions]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nullable = (value: string, multiplier = 1): number | null => value.trim() === '' ? null : Number(value) * multiplier;
    const negotiationPct = Number(values.negotiationPct);
    const closingCostPct = Number(values.closingCostPct);
    const validation = conditionsSchema.safeParse({
      budgetYen: nullable(values.budgetManYen, 10_000),
      minAreaSqm: nullable(values.minAreaSqm),
      maxWalkMinutes: nullable(values.maxWalkMinutes),
      maxMonthlyFeesYen: nullable(values.maxMonthlyFeesYen),
      negotiationRate: negotiationPct / 100,
      closingCostRate: closingCostPct / 100,
      financing: {
        showLoan: values.showLoan,
        ageYears: nullable(values.ageYears),
        annualIncomeYen: nullable(values.incomeManYen, 10_000),
        ratePct: Number(values.ratePct),
        method: values.method,
        termYears: nullable(values.termYears),
        loanToValuePct: Number(values.loanToValuePct),
      },
    });
    if (!validation.success || negotiationPct < 0 || negotiationPct > 20 || closingCostPct < 0 || closingCostPct > 100) {
      setError('数値と範囲を確認してください。想定値引き率は0〜20%、諸費用率は0〜100%、金利は0〜20%、年齢は18〜120歳、返済期間は1〜50年（整数）です。');
      return;
    }
    setError(null);
    onSave(validation.data);
    setSaved(true);
  }

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => { setValues((current) => ({ ...current, [key]: value })); setSaved(false); setError(null); };
  return (
    <section className="content-section">
      <div className="section-heading section-heading--content"><h2>自分の条件</h2></div>
      <p className="form-note">条件はこのブラウザに保存され、物件の比較と支払いの試算に使われます。</p>
      <form className="conditions-form" onSubmit={submit}>
        <label className="form-field"><span>予算（諸費用込み・万円）</span><input type="number" min="0" step="10" value={values.budgetManYen} onChange={(event) => set('budgetManYen', event.target.value)} placeholder="例: 3000" />{conditions.budgetYen !== null ? <small>{formatManYen(conditions.budgetYen)}</small> : null}</label>
        <label className="form-field"><span>最低面積（㎡）</span><input type="number" min="0" step="0.1" value={values.minAreaSqm} onChange={(event) => set('minAreaSqm', event.target.value)} /></label>
        <label className="form-field"><span>駅徒歩の上限（分）</span><input type="number" min="0" step="1" value={values.maxWalkMinutes} onChange={(event) => set('maxWalkMinutes', event.target.value)} /></label>
        <label className="form-field"><span>管理費＋修繕積立金の上限（月額・円）</span><input type="number" min="0" step="1000" value={values.maxMonthlyFeesYen} onChange={(event) => set('maxMonthlyFeesYen', event.target.value)} /></label>
        <label className="form-field"><span>想定値引き率（%・0〜20）</span><input type="number" min="0" max="20" step="0.5" value={values.negotiationPct} onChange={(event) => set('negotiationPct', event.target.value)} /></label>
        <label className="form-field"><span>諸費用率（%）</span><input type="number" min="0" max="100" step="0.5" value={values.closingCostPct} onChange={(event) => set('closingCostPct', event.target.value)} /></label>
        <p className="form-note form-grid__wide">一括で払う予定なら、予算には「諸費用込みで出せる手元資金」を入れてください。想定値引き率は、成約価格が交渉で売出価格より下がることを見込む比較用の値です。根拠のある数字が分かるまでは0%のままにしてください</p>

        <h3 className="form-grid__wide conditions-form__heading">ローンを使う場合の試算</h3>
        <label className="check-inline form-grid__wide"><input type="checkbox" checked={values.showLoan} onChange={(event) => set('showLoan', event.target.checked)} />物件ごとにローンの試算も表示する</label>
        <label className="form-field"><span>申込時の年齢（歳）</span><input type="number" min="18" max="120" step="1" value={values.ageYears} onChange={(event) => set('ageYears', event.target.value)} /></label>
        <label className="form-field"><span>年収（年金を含む・万円）</span><input type="number" min="0" step="10" value={values.incomeManYen} onChange={(event) => set('incomeManYen', event.target.value)} /></label>
        <label className="form-field"><span>金利（年・%）</span><input type="number" min="0" max="20" step="0.05" value={values.ratePct} onChange={(event) => set('ratePct', event.target.value)} /></label>
        <label className="form-field"><span>返済方法</span>
          <select value={values.method} onChange={(event) => set('method', event.target.value as LoanMethod)}>
            <option value="auto">年齢から選ぶ</option>
            <option value="interest_only">毎月は利息のみ（リ・バース60型）</option>
            <option value="amortizing">元利均等（毎月同じ額）</option>
          </select>
        </label>
        <label className="form-field"><span>返済期間（年・元利均等のとき）</span><input type="number" min="1" max="50" step="1" value={values.termYears} onChange={(event) => set('termYears', event.target.value)} placeholder="空欄＝80歳まで（最長35年）" /></label>
        <label className="form-field"><span>借入の上限（担保評価額の%・利息のみ型）</span><input type="number" min="0" max="100" step="5" value={values.loanToValuePct} onChange={(event) => set('loanToValuePct', event.target.value)} /></label>

        {error ? <p className="field-error form-grid__wide" role="alert">{error}</p> : null}
        <div className="form-actions form-grid__wide"><button type="submit" className="button button--primary">条件を保存</button>{saved ? <span role="status">保存しました</span> : null}</div>
      </form>
      <FinancingSummary settings={conditions.financing} />
    </section>
  );
}
