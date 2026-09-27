import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import AboutPage from './components/AboutPage';
import LocalListingsPanel from './components/LocalListingsPanel';
const MarketTrends = lazy(() => import('./components/MarketTrends'));
const ListingDetail = lazy(() => import('./components/ListingDetail'));
import ListingForm from './components/ListingForm';
import ListingList from './components/ListingList';
const MapView = lazy(() => import('./components/MapView'));
import MyConditionsForm from './components/MyConditionsForm';
import valuationJson from './config/valuation.json';
import { fetchJson, loadSiteData, loadTransactionsForCodes } from './lib/data';
import { labelText, localIsoDate } from './lib/format';
import { loadLocalData, readStarred, saveStarred, toMyListing, type LocalData } from './lib/localListings';
import { makeTimeAdjuster } from './lib/regionIndex';
import { useEvaluations } from './lib/useEvaluations';
import { useListings } from './lib/useListings';
import type { Listing, LocalListing, Meta, Municipality, PriceIndex, RegionIndex, Station, ValuationConfig } from './types';

type Tab = 'map' | 'local' | 'trends' | 'listings' | 'conditions' | 'about';

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: '地図' },
  { id: 'local', label: '掲載物件（手元）' },
  { id: 'trends', label: '地域の動き' },
  { id: 'listings', label: '自分の物件' },
  { id: 'conditions', label: '自分の条件' },
  { id: 'about', label: 'データと注意事項' },
];
const valuationConfig = valuationJson as ValuationConfig;
const EMPTY_LOCAL: LocalListing[] = [];

export default function App() {
  const [tab, setTab] = useState<Tab>('map');
  const [siteData, setSiteData] = useState<{ meta: Meta; municipalities: Municipality[]; priceIndex: PriceIndex } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [activeListingId, setActiveListingId] = useState<string | null>(null);
  const [returnToDetail, setReturnToDetail] = useState(false);
  const [locationMapOpen, setLocationMapOpen] = useState(false);
  const [pickRequestId, setPickRequestId] = useState(0);
  const [pickedLocation, setPickedLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [stationNames, setStationNames] = useState<string[]>([]);
  const { listings, conditions, storageError, upsertListing, removeListing, setConditions, setListings } = useListings();
  const [localData, setLocalData] = useState<LocalData | null>(null);
  const [stations, setStations] = useState<Station[] | null>(null);
  const [regionIndex, setRegionIndex] = useState<RegionIndex | null>(null);
  const [trendBasePos, setTrendBasePos] = useState(0);
  const [activeLocalId, setActiveLocalId] = useState<string | null>(null);
  const [starred, setStarred] = useState<Set<string>>(() => readStarred());
  const [addedMessage, setAddedMessage] = useState('');

  useEffect(() => {
    loadSiteData().then((data) => {
      setSiteData(data);
      if (data.meta.hasStations) void fetchJson<Station[]>('stations.json').then(setStations).catch(() => setStations(null));
      void fetchJson<RegionIndex>('region_index.json').then((index) => {
        setRegionIndex(index);
        setTrendBasePos(Math.max(0, index.periods.indexOf(index.defaultBase)));
      }).catch(() => setRegionIndex(null));
    }).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : 'データを読み込めませんでした');
    });
    void loadLocalData().then(setLocalData);
  }, []);

  const toggleStar = useCallback((id: string) => {
    setStarred((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveStarred(next);
      return next;
    });
  }, []);

  const openLocal = useCallback((id: string) => {
    setActiveLocalId(id);
    setAddedMessage('');
    setTab('local');
  }, []);

  function addLocalToMine(local: LocalListing): void {
    upsertListing(toMyListing(local));
    setAddedMessage('自分の物件に追加しました。「自分の物件」タブで編集や価格の記録ができます');
  }

  const municipalities = siteData?.municipalities ?? [];
  const contractDataEmpty = siteData?.meta.transactionCount === 0;

  async function loadStationNames(code: string): Promise<void> {
    setStationNames([]);
    if (!code) return;
    const target = municipalities.find((municipality) => municipality.code === code);
    const codes = target ? municipalities.filter((municipality) => municipality.group === target.group).map((municipality) => municipality.code) : [code];
    try {
      const transactions = await loadTransactionsForCodes([...new Set([...codes, code])]);
      setStationNames([...new Set(transactions.map((transaction) => transaction.nearestStation).filter((name): name is string => Boolean(name)))].sort((left, right) => left.localeCompare(right, 'ja')));
    } catch {
      setStationNames([]);
    }
  }

  useEffect(() => {
    if (showForm && editingListing) void loadStationNames(editingListing.municipalityCode);
  }, [showForm, editingListing?.id, siteData]);

  const timeAdjust = useMemo(
    () => (regionIndex && siteData ? makeTimeAdjuster(regionIndex, siteData.municipalities, siteData.meta.periodTo) : undefined),
    [regionIndex, siteData],
  );
  const { evaluations, loading: evaluationsLoading, error: evaluationsError } = useEvaluations({
    timeAdjust,
    listings,
    municipalities,
    priceIndex: siteData?.priceIndex ?? null,
    meta: siteData?.meta ?? null,
    conditions,
    config: valuationConfig,
  });
  const localListings = localData?.listings;
  const { evaluations: localEvaluations, loading: localEvaluationsLoading } = useEvaluations({
    timeAdjust,
    listings: localListings ?? EMPTY_LOCAL,
    municipalities,
    priceIndex: siteData?.priceIndex ?? null,
    meta: siteData?.meta ?? null,
    conditions,
    config: valuationConfig,
  });
  const activeLocal = localData?.listings.find((item) => item.id === activeLocalId) ?? null;

  function openDetail(listing: Listing): void {
    setActiveListingId(listing.id);
    setEditingListing(null);
    setShowForm(false);
    setTab('listings');
  }

  function beginCreate(): void {
    setActiveListingId(null);
    setReturnToDetail(false);
    setEditingListing(null);
    setPickedLocation(null);
    setShowForm(true);
    setTab('listings');
  }

  function beginEdit(listing: Listing, fromDetail = false): void {
    setActiveListingId(null);
    setReturnToDetail(fromDetail);
    setEditingListing(listing);
    setPickedLocation(null);
    setShowForm(true);
    setTab('listings');
  }

  function saveListing(listing: Listing): void {
    upsertListing(listing);
    setShowForm(false);
    setLocationMapOpen(false);
    setPickedLocation(null);
    setActiveListingId(returnToDetail ? listing.id : null);
    setReturnToDetail(false);
  }

  function cancelForm(): void {
    setShowForm(false);
    setLocationMapOpen(false);
    setActiveListingId(returnToDetail ? editingListing?.id ?? null : null);
    setReturnToDetail(false);
  }

  function setTabAndClose(nextTab: Tab): void {
    setTab(nextTab);
    if (nextTab !== 'listings') {
      setShowForm(false);
      setLocationMapOpen(false);
      if (returnToDetail) setActiveListingId(editingListing?.id ?? null);
      setReturnToDetail(false);
    }
  }

  const listingForm = showForm ? (
    <div className="editor-layout">
      <section className="content-section">
        <div className="section-heading section-heading--content"><h2>{editingListing ? '物件を編集' : '物件を登録'}</h2></div>
        <ListingForm
          municipalities={municipalities}
          listing={editingListing}
          location={pickedLocation}
          stationNames={stationNames}
          onSave={saveListing}
          onCancel={cancelForm}
          onRequestLocation={() => { setLocationMapOpen(true); setPickRequestId((current) => current + 1); }}
          onMunicipalityChange={(code) => void loadStationNames(code)}
        />
      </section>
      {locationMapOpen ? <Suspense fallback={<p>地図を読み込み中です。</p>}><MapView pickRequestId={pickRequestId} onLocationPick={(lat, lon) => { setPickedLocation({ lat, lon }); setLocationMapOpen(false); }} /></Suspense> : null}
    </div>
  ) : null;
  const activeListing = listings.find((listing) => listing.id === activeListingId) ?? null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <h1>京阪間 中古マンション相場マップ</h1>
        <nav aria-label="メインメニュー" className="tab-nav">
          {TABS.filter((item) => (item.id !== 'local' || localData) && (item.id !== 'trends' || regionIndex)).map((item) => (
            <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTabAndClose(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {loadError ? <p className="inline-error" role="alert">{loadError}</p> : null}
        {storageError ? <p className="inline-error" role="alert">ブラウザに保存できませんでした。空き容量やプライベートブラウズ設定を確認してください。</p> : null}
        {tab === 'map' ? (
          <div className="map-layout">
            <section className="map-main">
              <div className="section-heading"><h2>地図</h2></div>
              <Suspense fallback={<div className="map-section"><p className="empty-state">地図を読み込み中です。</p></div>}><MapView listings={listings} evaluations={evaluations} onSelectListing={setActiveListingId} localListings={localListings} localEvaluations={localEvaluations} onSelectLocal={openLocal} stations={stations ?? undefined} /></Suspense>
            </section>
            <aside className="side-panel">
              <div className="section-heading"><h2>登録物件</h2><span className="count-note">{listings.length}件</span></div>
              {listings.length === 0 ? <p className="empty-state">登録した物件はありません</p> : (
                <ul className="side-list">{listings.slice(0, 8).map((listing) => {
                  const label = evaluations.get(listing.id)?.label;
                  const text = labelText(label ?? 'hold');
                  return <li key={listing.id}><button type="button" aria-current={activeListingId === listing.id ? 'true' : undefined} onClick={() => openDetail(listing)}>{listing.name || '名称未入力'}<span>{municipalities.find((item) => item.code === listing.municipalityCode)?.name ?? '不明'} ・ {text}</span></button></li>;
                })}</ul>
              )}
              <button type="button" className="button button--primary" onClick={beginCreate}>物件を登録</button>
              {evaluationsLoading ? <p className="data-empty-note">登録物件の相場比較を計算しています。</p> : null}
              {evaluationsError ? <p className="inline-error" role="alert">{evaluationsError}</p> : null}
              {contractDataEmpty ? <p className="data-empty-note">成約事例データは未取得です。物件情報だけでは相場比較を行えません。</p> : null}
            </aside>
          </div>
        ) : null}
        {tab === 'listings' ? listingForm ?? (activeListing ? (
          <Suspense fallback={<section className="content-section"><p>物件詳細を読み込み中です。</p></section>}><ListingDetail
            listing={activeListing}
            municipalities={municipalities}
            priceIndex={siteData?.priceIndex ?? null}
            meta={siteData?.meta ?? null}
            conditions={conditions}
            onBack={() => setActiveListingId(null)}
            onEdit={() => beginEdit(activeListing, true)}
            onUpdate={upsertListing}
            timeAdjust={timeAdjust}
            regionIndex={regionIndex}
            trendBasePos={trendBasePos}
          /></Suspense>
        ) : (
          <section className="content-section">
            <div className="section-heading section-heading--content">
              <h2>物件</h2>
              <button type="button" className="button button--primary" onClick={beginCreate}>物件を登録</button>
            </div>
            {evaluationsError ? <p className="inline-error" role="alert">相場比較を読み込めませんでした: {evaluationsError}</p> : null}
            <ListingList
              listings={listings}
              municipalities={municipalities}
              conditions={conditions}
              onEdit={(listing) => beginEdit(listing)}
              onRemove={removeListing}
              onImport={(nextListings, nextConditions) => { setListings(nextListings); setConditions(nextConditions); }}
              onSelect={openDetail}
              evaluations={evaluations}
            />
            {contractDataEmpty ? <p className="data-empty-note">成約事例データは未取得のため、相場の判定は保留です。</p> : null}
          </section>
        )) : null}
        {tab === 'local' && localData ? (activeLocal ? (
          <Suspense fallback={<section className="content-section"><p>物件詳細を読み込み中です。</p></section>}><ListingDetail
            listing={activeLocal}
            municipalities={municipalities}
            priceIndex={siteData?.priceIndex ?? null}
            meta={siteData?.meta ?? null}
            conditions={conditions}
            onBack={() => setActiveLocalId(null)}
            backLabel="← 掲載物件の一覧へ"
            landRights={activeLocal.landRights}
            allowHazard={activeLocal.locationPrecision === 'exact'}
            timeAdjust={timeAdjust}
            regionIndex={regionIndex}
            trendBasePos={trendBasePos}
            actions={<>
              <button type="button" className="button button--quiet" aria-pressed={starred.has(activeLocal.id)} onClick={() => toggleStar(activeLocal.id)}>{starred.has(activeLocal.id) ? '★ 星を外す' : '☆ 星を付ける'}</button>
              <button type="button" className="button button--quiet" onClick={() => addLocalToMine(activeLocal)}>自分の物件に追加</button>
            </>}
            notes={<>
              {addedMessage ? <p className="form-note" role="status">{addedMessage}</p> : null}
              <p className="form-note">
                {activeLocal.sourceName}の掲載情報（初回 {activeLocal.firstSeen}・最終確認 {activeLocal.lastSeen}{activeLocal.status === 'removed' ? '・掲載終了' : ''}）。
                位置: {activeLocal.locationPrecision === 'exact' ? '掲載ページの地図' : activeLocal.locationPrecision === 'approx' ? '住所から推定したおおよその位置' : '不明'}。
                {activeLocal.detailFetchedAt ? `詳細は ${activeLocal.detailFetchedAt} に取得。` : '詳細（管理費・修繕積立金・階・リフォームなど）は未取得。星を付けて一覧の「詳細取得コマンドをコピー」から取得できます。'}
                {activeLocal.landRights ? ` 土地の権利: ${activeLocal.landRights}。` : ''}{activeLocal.totalUnits ? ` 総戸数: ${activeLocal.totalUnits}戸。` : ''}{activeLocal.direction ? ` 向き: ${activeLocal.direction}。` : ''}
              </p>
            </>}
          /></Suspense>
        ) : (
          <LocalListingsPanel
            data={localData}
            evaluations={localEvaluations}
            evaluationsLoading={localEvaluationsLoading}
            municipalities={municipalities}
            conditions={conditions}
            starred={starred}
            onToggleStar={toggleStar}
            onOpen={(listing) => openLocal(listing.id)}
            today={localIsoDate()}
          />
        )) : null}
        {tab === 'trends' && regionIndex ? (
          <Suspense fallback={<section className="content-section"><p>読み込み中です。</p></section>}>
            <MarketTrends
              index={regionIndex}
              basePos={trendBasePos}
              onBaseChange={setTrendBasePos}
              municipalities={municipalities}
              listings={[
                ...(localListings ?? []).map((listing) => ({ kind: 'local' as const, listing, evaluation: localEvaluations.get(listing.id) })),
                ...listings.map((listing) => ({ kind: 'mine' as const, listing, evaluation: evaluations.get(listing.id) })),
              ]}
              onOpen={(kind, id) => {
                if (kind === 'local') openLocal(id);
                else { const found = listings.find((item) => item.id === id); if (found) openDetail(found); }
              }}
            />
          </Suspense>
        ) : null}
        {tab === 'conditions' ? <MyConditionsForm conditions={conditions} onSave={setConditions} /> : null}
        {tab === 'about' ? <AboutPage meta={siteData?.meta ?? null} /> : null}
      </main>

      <footer className="site-footer">
        <p>{siteData?.meta.sources.find((source) => source.id === 'reinfolib_api')?.credit ?? 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません'}</p>
      </footer>
    </div>
  );
}
