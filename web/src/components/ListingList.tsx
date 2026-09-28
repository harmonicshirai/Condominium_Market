import { useRef, useState } from 'react';
import type { Evaluation, Listing, Municipality, MyConditions } from '../types';
import { formatManYen, labelText, seismicText } from '../lib/format';
import { downloadExport, importedDuplicateIds, importExport, readImportFile } from '../lib/storage';
import { localIsoDate } from '../lib/format';
import { NARROW_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import ListingCard from './ListingCard';

interface ListingListProps {
  listings: Listing[];
  municipalities: Municipality[];
  conditions: MyConditions;
  onEdit: (listing: Listing) => void;
  onRemove: (id: string) => void;
  onImport: (listings: Listing[], conditions: MyConditions) => void;
  onSelect: (listing: Listing) => void;
  evaluations?: ReadonlyMap<string, Evaluation>;
}

export default function ListingList({ listings, municipalities, conditions, onEdit, onRemove, onImport, onSelect, evaluations = new Map() }: ListingListProps) {
  const [municipalityCode, setMunicipalityCode] = useState('');
  const [minimumPrice, setMinimumPrice] = useState('');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [minimumArea, setMinimumArea] = useState('');
  const [maximumArea, setMaximumArea] = useState('');
  const [maximumAge, setMaximumAge] = useState('');
  const [judgment, setJudgment] = useState('');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const narrow = useMediaQuery(NARROW_QUERY);
  const filtered = listings.filter((listing) => {
    const askingPrice = listing.priceHistory.at(-1)?.priceYen ?? 0;
    const age = listing.buildingYear === null ? null : new Date().getFullYear() - listing.buildingYear;
    const evaluation = evaluations.get(listing.id);
    return (!municipalityCode || listing.municipalityCode === municipalityCode)
      && (!minimumPrice || askingPrice >= Number(minimumPrice))
      && (!maximumPrice || askingPrice <= Number(maximumPrice))
      && (!minimumArea || listing.areaSqm >= Number(minimumArea))
      && (!maximumArea || listing.areaSqm <= Number(maximumArea))
      && (!maximumAge || age === null || age <= Number(maximumAge))
      && (!judgment || evaluation?.label === judgment);
  });

  async function handleImport(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const payload = await readImportFile(file);
      const duplicateIds = importedDuplicateIds(payload, listings);
      const overwrite = duplicateIds.length > 0 && window.confirm(`同じIDの物件が${duplicateIds.length}件あります。上書きしますか？`);
      const result = importExport(payload, listings, overwrite);
      onImport(result.listings, result.conditions);
      setMessage(`物件データを読み込みました（${result.listings.length}件）`);
    } catch (error) {
      setMessage(error instanceof Error ? `読み込みに失敗しました: ${error.message}` : '読み込みに失敗しました');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="listing-manager">
      <div className="listing-manager__toolbar">
        <p>{filtered.length}件</p>
        <div>
          <button type="button" className="button button--quiet" onClick={() => downloadExport(listings, conditions)}>書き出し</button>
          <button type="button" className="button button--quiet" onClick={() => inputRef.current?.click()}>読み込み</button>
          <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleImport(event.target.files?.[0])} />
        </div>
      </div>
      {message ? <p className="form-note" role="status">{message}</p> : null}
      <div className="filter-row" aria-label="物件を絞り込む">
        <label>市区町村<select value={municipalityCode} onChange={(event) => setMunicipalityCode(event.target.value)}><option value="">すべて</option>{municipalities.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <label>価格下限<input type="number" min="0" value={minimumPrice} onChange={(event) => setMinimumPrice(event.target.value)} /></label>
        <label>価格上限<input type="number" min="0" value={maximumPrice} onChange={(event) => setMaximumPrice(event.target.value)} /></label>
        <label>面積下限<input type="number" min="0" value={minimumArea} onChange={(event) => setMinimumArea(event.target.value)} /></label>
        <label>面積上限<input type="number" min="0" value={maximumArea} onChange={(event) => setMaximumArea(event.target.value)} /></label>
        <label>築年数上限<input type="number" min="0" value={maximumAge} onChange={(event) => setMaximumAge(event.target.value)} /></label>
        <label>判定<select value={judgment} onChange={(event) => setJudgment(event.target.value)}><option value="">すべて</option><option value="below">{labelText('below')}</option><option value="near">{labelText('near')}</option><option value="above">{labelText('above')}</option><option value="hold">判定保留</option></select></label>
      </div>
      {filtered.length === 0 ? <p className="empty-state">登録した物件はありません</p> : narrow ? (
        <div className="card-list">{filtered.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            municipalityName={municipalities.find((item) => item.code === listing.municipalityCode)?.name ?? '不明'}
            evaluation={evaluations.get(listing.id)}
            today={localIsoDate()}
            onOpen={() => onSelect(listing)}
            footer={<>
              <button type="button" className="text-button" onClick={() => onEdit(listing)}>編集</button>
              <button type="button" className="text-button text-button--danger" onClick={() => { if (window.confirm('この物件を削除しますか？')) onRemove(listing.id); }}>削除</button>
            </>}
          />
        ))}</div>
      ) : (
        <div className="table-wrap">
          <table className="listing-table">
            <thead><tr><th>物件名</th><th>市区町村</th><th>売出価格</th><th>面積</th><th>築年・耐震</th><th>徒歩分</th><th>判定</th><th>操作</th></tr></thead>
            <tbody>{filtered.map((listing) => {
              const latestPrice = listing.priceHistory.at(-1)?.priceYen ?? 0;
              const municipality = municipalities.find((item) => item.code === listing.municipalityCode)?.name ?? '不明';
              const seismic = listing.buildingYear === null ? 'unknown' : listing.buildingYear <= 1980 ? 'old' : listing.buildingYear <= 1982 ? 'unknown' : 'new';
              return (
                <tr key={listing.id} onClick={() => onSelect(listing)}>
                  <td>{listing.sourceUrl ? <a href={listing.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{listing.name || '名称未入力'}</a> : listing.name || '名称未入力'}</td>
                  <td>{municipality}</td><td>{formatManYen(latestPrice)}</td><td>{listing.areaSqm.toFixed(1)}㎡</td>
                  <td>{listing.buildingYear ?? '不明'}年<br /><small>{seismicText(seismic)}</small></td>
                  <td>{listing.walkMinutes === null ? '不明' : `${listing.walkMinutes}分`}</td><td>{labelText(evaluations.get(listing.id)?.label ?? 'hold')}<br /><small>信頼度 {evaluations.get(listing.id)?.confidence ?? '不明'}</small></td>
                  <td><button type="button" className="text-button" onClick={(event) => { event.stopPropagation(); onEdit(listing); }}>編集</button><button type="button" className="text-button text-button--danger" onClick={(event) => { event.stopPropagation(); if (window.confirm('この物件を削除しますか？')) onRemove(listing.id); }}>削除</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
