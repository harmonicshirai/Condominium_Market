import { useEffect, useState, type FormEvent } from 'react';
import type { Listing, Municipality, RenovationStatus } from '../types';
import { localIsoDate } from '../lib/format';
import { listingSchema } from '../lib/storage';

interface ListingFormProps {
  municipalities: Municipality[];
  listing: Listing | null;
  location: { lat: number; lon: number } | null;
  stationNames: string[];
  onSave: (listing: Listing) => void;
  onCancel: () => void;
  onRequestLocation: () => void;
  onMunicipalityChange?: (code: string) => void;
}

interface FormValues {
  name: string;
  sourceUrl: string;
  municipalityCode: string;
  addressText: string;
  station: string;
  walkMinutes: string;
  areaSqm: string;
  buildingYear: string;
  buildingMonth: string;
  floor: string;
  totalFloors: string;
  floorPlan: string;
  managementFeeYen: string;
  repairReserveYen: string;
  renovationStatus: RenovationStatus;
  renovationYear: string;
  renovationScope: string;
  renovationEvidence: string;
  priceYen: string;
  asOfDate: string;
  memo: string;
}

function toInput(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function toNullableNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

function defaultValues(listing: Listing | null): FormValues {
  const latest = listing?.priceHistory.at(-1);
  return {
    name: listing?.name ?? '',
    sourceUrl: listing?.sourceUrl ?? '',
    municipalityCode: listing?.municipalityCode ?? '',
    addressText: listing?.addressText ?? '',
    station: listing?.station ?? '',
    walkMinutes: toInput(listing?.walkMinutes),
    areaSqm: toInput(listing?.areaSqm),
    buildingYear: toInput(listing?.buildingYear),
    buildingMonth: toInput(listing?.buildingMonth),
    floor: toInput(listing?.floor),
    totalFloors: toInput(listing?.totalFloors),
    floorPlan: listing?.floorPlan ?? '',
    managementFeeYen: toInput(listing?.managementFeeYen),
    repairReserveYen: toInput(listing?.repairReserveYen),
    renovationStatus: listing?.renovation.status ?? 'unknown',
    renovationYear: toInput(listing?.renovation.year),
    renovationScope: listing?.renovation.scope ?? '',
    renovationEvidence: listing?.renovation.evidence ?? '',
    priceYen: toInput(latest?.priceYen),
    asOfDate: latest?.date ?? localIsoDate(),
    memo: listing?.memo ?? '',
  };
}

export default function ListingForm({ municipalities, listing, location, stationNames, onSave, onCancel, onRequestLocation, onMunicipalityChange }: ListingFormProps) {
  const [values, setValues] = useState(() => defaultValues(listing));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => setValues(defaultValues(listing)), [listing]);

  function change<K extends keyof FormValues>(key: K, value: FormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const now = new Date().toISOString();
    const priceYen = Number(values.priceYen);
    const observation = { date: values.asOfDate, priceYen, memo: '' };
    const priceHistory = [...(listing?.priceHistory ?? [])];
    const sameDateIndex = priceHistory.findIndex((item) => item.date === values.asOfDate);
    if (sameDateIndex >= 0) {
      if (priceHistory[sameDateIndex].priceYen !== priceYen && !window.confirm('同じ日付の価格記録を上書きしますか？')) return;
      priceHistory[sameDateIndex] = observation;
    } else {
      priceHistory.push(observation);
    }
    priceHistory.sort((left, right) => left.date.localeCompare(right.date));

    const candidate: Listing = {
      id: listing?.id ?? crypto.randomUUID(),
      name: values.name.trim(),
      sourceUrl: values.sourceUrl.trim(),
      municipalityCode: values.municipalityCode,
      addressText: values.addressText.trim(),
      lat: location?.lat ?? listing?.lat ?? null,
      lon: location?.lon ?? listing?.lon ?? null,
      station: values.station.trim(),
      walkMinutes: toNullableNumber(values.walkMinutes),
      areaSqm: Number(values.areaSqm),
      buildingYear: toNullableNumber(values.buildingYear),
      buildingMonth: toNullableNumber(values.buildingMonth),
      floor: toNullableNumber(values.floor),
      totalFloors: toNullableNumber(values.totalFloors),
      floorPlan: values.floorPlan.trim(),
      managementFeeYen: toNullableNumber(values.managementFeeYen),
      repairReserveYen: toNullableNumber(values.repairReserveYen),
      renovation: {
        status: values.renovationStatus,
        year: toNullableNumber(values.renovationYear),
        scope: values.renovationScope.trim(),
        evidence: values.renovationEvidence.trim(),
      },
      priceHistory,
      memo: values.memo.trim(),
      createdAt: listing?.createdAt ?? now,
      updatedAt: now,
    };
    const validation = listingSchema.safeParse(candidate);
    if (!validation.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        nextErrors[key] ??= issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    if (!municipalities.some((item) => item.code === candidate.municipalityCode)) {
      setErrors({ municipalityCode: '市区町村を選択してください' });
      return;
    }
    setErrors({});
    onSave(validation.data);
  }

  const field = (key: keyof FormValues, label: string, type = 'text', required = false, min?: number, max?: number) => (
    <label className="form-field" key={key}>
      <span>{label}{required ? <b aria-hidden="true"> *</b> : null}</span>
      <input type={type} required={required} min={min} max={max} value={values[key]} onChange={(event) => change(key, event.target.value)} />
      {errors[key] ? <small className="field-error">{errors[key]}</small> : null}
    </label>
  );

  return (
    <form className="listing-form" onSubmit={submit}>
      <div className="form-grid">
        {field('name', '物件名')}
        {field('sourceUrl', '掲載ページのURL', 'url')}
        <p className="form-note form-grid__wide">URLはリンクとして保存するだけで、ページの内容は取得しません</p>
        <label className="form-field">
          <span>市区町村 <b aria-hidden="true">*</b></span>
          <select required value={values.municipalityCode} onChange={(event) => { change('municipalityCode', event.target.value); onMunicipalityChange?.(event.target.value); }}>
            <option value="">選択してください</option>
            {municipalities.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
          {errors.municipalityCode ? <small className="field-error">{errors.municipalityCode}</small> : null}
        </label>
        {field('addressText', '住所')}
        <label className="form-field">
          <span>最寄駅</span>
          <input list="station-options" value={values.station} onChange={(event) => change('station', event.target.value)} />
          <datalist id="station-options">{stationNames.map((station) => <option key={station} value={station} />)}</datalist>
        </label>
        {field('walkMinutes', '徒歩分数', 'number', false, 0)}
        {field('areaSqm', '専有面積（㎡）', 'number', true, 10, 300)}
        {field('buildingYear', '築年', 'number', false, 1800, 2200)}
        {field('buildingMonth', '築月', 'number', false, 1, 12)}
        {field('floor', '所在階', 'number', false, 1)}
        {field('totalFloors', '総階数', 'number', false, 1)}
        {field('floorPlan', '間取り')}
        {field('managementFeeYen', '管理費（月額・円）', 'number', false, 0)}
        {field('repairReserveYen', '修繕積立金（月額・円）', 'number', false, 0)}
        <label className="form-field">
          <span>リフォーム状態</span>
          <select value={values.renovationStatus} onChange={(event) => change('renovationStatus', event.target.value as RenovationStatus)}>
            <option value="unknown">記載なし</option><option value="renovated">リフォーム済み</option><option value="not_renovated">未改装</option>
          </select>
        </label>
        {field('renovationYear', 'リフォーム実施年', 'number', false, 1800, 2200)}
        {field('renovationScope', 'リフォーム範囲')}
        {field('renovationEvidence', '根拠')}
        {field('priceYen', '売出価格（円）', 'number', true, 1)}
        {field('asOfDate', '確認日', 'date', true)}
        <label className="form-field form-grid__wide">
          <span>メモ</span>
          <textarea rows={3} value={values.memo} onChange={(event) => change('memo', event.target.value)} />
        </label>
      </div>
      <div className="form-location">
        <button type="button" className="button button--quiet" onClick={onRequestLocation}>地図で位置を指定</button>
        <span>{location ? `指定済み: ${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}` : listing?.lat !== null && listing?.lat !== undefined ? '位置を登録済み' : '位置は未指定でも保存できます'}</span>
        {errors.lat ? <small className="field-error">{errors.lat}</small> : null}
      </div>
      {errors.form ? <p role="alert" className="field-error">{errors.form}</p> : null}
      <div className="form-actions">
        <button type="submit" className="button button--primary">保存</button>
        <button type="button" className="button button--quiet" onClick={onCancel}>キャンセル</button>
      </div>
    </form>
  );
}
