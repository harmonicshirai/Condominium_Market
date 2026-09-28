import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Map as MapLibreMap, MapMouseEvent, Marker } from 'maplibre-gl';
import type { Evaluation, Listing, LocalListing, Station } from '../types';
import { formatPeriod, formatPpsqm } from '../lib/format';
import { labelText } from '../lib/format';

maplibregl.setWorkerUrl(workerUrl);

const HAZARDS = [
  ['洪水（想定最大規模）', 'flood', 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png'],
  ['内水', 'inland-water', 'https://disaportaldata.gsi.go.jp/raster/02_naisui_data/{z}/{x}/{y}.png'],
  ['土石流', 'debris-flow', 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png'],
  ['急傾斜地の崩壊', 'steep-slope', 'https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png'],
  ['地すべり', 'landslide', 'https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png'],
  ['高潮（想定最大規模）', 'storm-surge', 'https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png'],
  ['津波', 'tsunami', 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png'],
] as const;

interface MapViewProps {
  listings?: Listing[];
  evaluations?: ReadonlyMap<string, Evaluation>;
  /** 手元の掲載物件（T20）。公開サイトでは渡されない */
  localListings?: LocalListing[];
  localEvaluations?: ReadonlyMap<string, Evaluation>;
  onSelectLocal?: (id: string) => void;
  /** 駅と駅別の成約相場（T16） */
  stations?: Station[];
  pickRequestId?: number;
  onSelectListing?: (id: string) => void;
  onLocationPick?: (lat: number, lon: number) => void;
}

export default function MapView({ listings = [], evaluations = new Map(), localListings, localEvaluations, onSelectLocal, stations, pickRequestId = 0, onSelectListing, onLocationPick }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [enabledHazards, setEnabledHazards] = useState<string[]>([]);
  const [pickingLocation, setPickingLocation] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [135.63, 34.85],
      zoom: 10,
      style: {
        version: 8,
        sources: {
          gsi: {
            type: 'raster',
            tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 18,
            attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
          },
        },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
      },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.on('load', () => {
      for (const [label, id, tiles] of HAZARDS) {
        map.addSource(id, { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: 17, attribution: '出典：「ハザードマップポータルサイト」' });
        map.addLayer({ id: `${id}-layer`, type: 'raster', source: id, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.6 } });
        void label;
      }
      setMapReady(true);
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (pickRequestId > 0) setPickingLocation(true);
  }, [pickRequestId]);

  const [showLocal, setShowLocal] = useState(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !localListings) return;
    const color = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    const colors = { below: color('--color-ok', '#2e7b58'), near: color('--color-accent', '#137d78'), above: color('--color-warn', '#b46a17'), hold: '#6b7780' };
    const data = {
      type: 'FeatureCollection' as const,
      features: localListings.filter((item) => item.status === 'active' && item.lat !== null && item.lon !== null).map((item) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [item.lon as number, item.lat as number] },
        properties: { id: item.id, label: localEvaluations?.get(item.id)?.label ?? 'hold', precision: item.locationPrecision },
      })),
    };
    const source = map.getSource('local-listings') as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource('local-listings', { type: 'geojson', data });
    // 初回だけ、手元の物件が収まる範囲に寄せる
    if (data.features.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const feature of data.features) bounds.extend(feature.geometry.coordinates as [number, number]);
      map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 0 });
    }
    const labelColor: maplibregl.ExpressionSpecification = ['match', ['get', 'label'], 'below', colors.below, 'near', colors.near, 'above', colors.above, colors.hold];
    map.addLayer({ id: 'local-exact', type: 'circle', source: 'local-listings', filter: ['==', ['get', 'precision'], 'exact'],
      paint: { 'circle-radius': 6, 'circle-color': labelColor, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'local-approx', type: 'circle', source: 'local-listings', filter: ['==', ['get', 'precision'], 'approx'],
      paint: { 'circle-radius': 5, 'circle-opacity': 0, 'circle-stroke-color': labelColor, 'circle-stroke-width': 2 } });
    for (const layer of ['local-exact', 'local-approx']) {
      map.on('click', layer, (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') onSelectLocal?.(id);
      });
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
  }, [localListings, localEvaluations, mapReady, onSelectLocal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const layer of ['local-exact', 'local-approx']) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', showLocal ? 'visible' : 'none');
    }
  }, [showLocal, mapReady, localListings]);

  const [showStations, setShowStations] = useState(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !stations || map.getSource('stations')) return;
    map.addSource('stations', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: stations.map((station) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [station.lon, station.lat] },
          properties: {
            name: station.name, line: station.line, target: station.isTargetLine,
            median: station.market?.medianPricePerSqm ?? -1, n: station.market?.n ?? 0,
            period: station.market ? `${formatPeriod(station.market.periodFrom)}〜${formatPeriod(station.market.periodTo)}` : '',
          },
        })),
      },
    });
    map.addLayer({ id: 'stations-other', type: 'circle', source: 'stations', filter: ['!', ['get', 'target']],
      paint: { 'circle-radius': 2.5, 'circle-color': '#8a979f', 'circle-opacity': 0.7 } });
    // 対象路線の駅: 色は㎡単価の中央値（1色の濃淡）、大きさは件数。相場がない駅は白抜き
    map.addLayer({ id: 'stations-target', type: 'circle', source: 'stations', filter: ['get', 'target'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 0, 4, 30, 6, 150, 10],
        'circle-color': ['case', ['<', ['get', 'median'], 0], '#ffffff',
          ['interpolate', ['linear'], ['get', 'median'], 200000, '#d6ece9', 450000, '#5aa9a3', 800000, '#0b4f4b']],
        'circle-stroke-color': '#0e625e', 'circle-stroke-width': 1.5,
      } });
    const popup = new maplibregl.Popup({ closeButton: false, offset: 10 });
    map.on('mouseenter', 'stations-target', (event) => {
      const props = event.features?.[0]?.properties;
      if (!props) return;
      map.getCanvas().style.cursor = 'pointer';
      const text = Number(props.median) >= 0
        ? `${props.name}（${props.line}）
成約㎡単価の中央値 ${formatPpsqm(Number(props.median))}・${props.n}件
${props.period}`
        : `${props.name}（${props.line}）
駅別の成約データなし`;
      popup.setLngLat(event.lngLat).setText(text).addTo(map);
    });
    map.on('mouseleave', 'stations-target', () => { map.getCanvas().style.cursor = ''; popup.remove(); });
  }, [stations, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const layer of ['stations-other', 'stations-target']) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', showStations ? 'visible' : 'none');
    }
  }, [showStations, mapReady, stations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const [, id] of HAZARDS) {
      const layerId = `${id}-layer`;
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', enabledHazards.includes(id) ? 'visible' : 'none');
    }
  }, [enabledHazards, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = listings.filter((listing) => listing.lat !== null && listing.lon !== null).map((listing) => {
      const element = document.createElement('button');
      element.type = 'button';
      const label = evaluations.get(listing.id)?.label ?? 'hold';
      const text = labelText(label);
      element.className = `listing-marker listing-marker--${label}`;
      element.setAttribute('aria-label', `${listing.name || '登録物件'}、${text}`);
      element.title = element.getAttribute('aria-label') ?? '';
      element.addEventListener('click', () => onSelectListing?.(listing.id));
      const popupText = `${listing.name || '登録物件'}\n${text}`;
      return new maplibregl.Marker({ element })
        .setLngLat([listing.lon as number, listing.lat as number])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText(popupText))
        .addTo(map);
    });
  }, [listings, evaluations, mapReady, onSelectListing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handlePick = (event: MapMouseEvent) => {
      if (!pickingLocation) return;
      onLocationPick?.(event.lngLat.lat, event.lngLat.lng);
      setPickingLocation(false);
    };
    map.on('click', handlePick);
    return () => { map.off('click', handlePick); };
  }, [onLocationPick, pickingLocation]);

  return (
    <section className="map-section" aria-label="物件位置とハザードの地図">
      <div ref={containerRef} className={`map-canvas${pickingLocation ? ' map-canvas--picking' : ''}`} />
      <div className="map-tools">
        {onLocationPick ? (
          <button type="button" className={pickingLocation ? 'button button--primary' : 'button button--quiet'} onClick={() => setPickingLocation((value) => !value)}>
            {pickingLocation ? '地図をクリックして位置を指定' : '地図で位置を指定'}
          </button>
        ) : null}
        <details className="hazard-toggle">
          <summary>ハザード表示</summary>
          <div className="hazard-toggle__items">
            {HAZARDS.map(([label, id]) => (
              <label key={id}>
                <input type="checkbox" checked={enabledHazards.includes(id)} onChange={(event) => setEnabledHazards((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />
                {label}
              </label>
            ))}
            <a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html" target="_blank" rel="noopener noreferrer">凡例はハザードマップポータルサイトで確認</a>
          </div>
        </details>
        {stations || localListings ? (
          <div className="local-legend">
            {stations ? <label><input type="checkbox" checked={showStations} onChange={(event) => setShowStations(event.target.checked)} />駅別の成約相場</label> : null}
            {localListings ? <label><input type="checkbox" checked={showLocal} onChange={(event) => setShowLocal(event.target.checked)} />掲載物件</label> : null}
          </div>
        ) : null}
        {stations || localListings ? (
          <details className="hazard-toggle legend-help">
            <summary>凡例</summary>
            <div className="hazard-toggle__items">
              {stations ? <small>駅：対象路線の駅の色は成約㎡単価の中央値（濃いほど高い）、大きさは件数（直近8四半期）。白は駅別データなし</small> : null}
              {localListings ? <small>掲載物件：塗りつぶし＝正確な位置、縁だけ＝おおよその位置（住所から推定）。色は判定（緑＝相場より低い、青緑＝近い、橙＝高い、灰＝保留）</small> : null}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
