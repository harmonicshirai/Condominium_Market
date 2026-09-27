import { useEffect, useState, type FormEvent } from 'react';
import type { MyConditions } from '../types';
import { formatManYen } from '../lib/format';
import { conditionsSchema } from '../lib/storage';

interface MyConditionsFormProps {
  conditions: MyConditions;
  onSave: (conditions: MyConditions) => void;
}

function inputNumber(value: number | null, divisor = 1): string {
  return value === null ? '' : String(value / divisor);
}

export default function MyConditionsForm({ conditions, onSave }: MyConditionsFormProps) {
  const [values, setValues] = useState(() => ({
    budgetManYen: inputNumber(conditions.budgetYen, 10_000),
    minAreaSqm: inputNumber(conditions.minAreaSqm),
    maxWalkMinutes: inputNumber(conditions.maxWalkMinutes),
    maxMonthlyFeesYen: inputNumber(conditions.maxMonthlyFeesYen),
    negotiationPct: String(conditions.negotiationRate * 100),
    closingCostPct: String(Math.round(conditions.closingCostRate * 1000) / 10),
  }));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValues({
      budgetManYen: inputNumber(conditions.budgetYen, 10_000),
      minAreaSqm: inputNumber(conditions.minAreaSqm),
      maxWalkMinutes: inputNumber(conditions.maxWalkMinutes),
      maxMonthlyFeesYen: inputNumber(conditions.maxMonthlyFeesYen),
      negotiationPct: String(conditions.negotiationRate * 100),
      closingCostPct: String(Math.round(conditions.closingCostRate * 1000) / 10),
    });
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
    });
    if (!validation.success || negotiationPct < 0 || negotiationPct > 20 || closingCostPct < 0 || closingCostPct > 100) {
      setError('数値と範囲を確認してください。想定値引き率は0〜20%、諸費用率は0〜100%です。');
      return;
    }
    setError(null);
    onSave(validation.data);
    setSaved(true);
  }

  const set = (key: keyof typeof values, value: string) => { setValues((current) => ({ ...current, [key]: value })); setSaved(false); setError(null); };
  return (
    <section className="content-section">
      <div className="section-heading section-heading--content"><h2>自分の条件</h2></div>
      <p className="form-note">条件はこのブラウザに保存され、登録物件の比較に使われます。</p>
      <form className="conditions-form" onSubmit={submit}>
        <label className="form-field"><span>予算（諸費用込み・万円）</span><input type="number" min="0" step="10" value={values.budgetManYen} onChange={(event) => set('budgetManYen', event.target.value)} placeholder="例: 5000" />{conditions.budgetYen !== null ? <small>{formatManYen(conditions.budgetYen)}</small> : null}</label>
        <label className="form-field"><span>最低面積（㎡）</span><input type="number" min="0" step="0.1" value={values.minAreaSqm} onChange={(event) => set('minAreaSqm', event.target.value)} /></label>
        <label className="form-field"><span>駅徒歩の上限（分）</span><input type="number" min="0" step="1" value={values.maxWalkMinutes} onChange={(event) => set('maxWalkMinutes', event.target.value)} /></label>
        <label className="form-field"><span>管理費＋修繕積立金の上限（月額・円）</span><input type="number" min="0" step="1000" value={values.maxMonthlyFeesYen} onChange={(event) => set('maxMonthlyFeesYen', event.target.value)} /></label>
        <label className="form-field"><span>想定値引き率（%・0〜20）</span><input type="number" min="0" max="20" step="0.5" value={values.negotiationPct} onChange={(event) => set('negotiationPct', event.target.value)} /></label>
        <label className="form-field"><span>諸費用率（%）</span><input type="number" min="0" max="100" step="0.5" value={values.closingCostPct} onChange={(event) => set('closingCostPct', event.target.value)} /></label>
        <p className="form-note form-grid__wide">成約価格は交渉で売出価格より下がることが多いため、比較用に想定する値引き率です。根拠のある数字が分かるまでは0%のままにしてください</p>
        {error ? <p className="field-error form-grid__wide" role="alert">{error}</p> : null}
        <div className="form-actions form-grid__wide"><button type="submit" className="button button--primary">条件を保存</button>{saved ? <span role="status">保存しました</span> : null}</div>
      </form>
    </section>
  );
}
