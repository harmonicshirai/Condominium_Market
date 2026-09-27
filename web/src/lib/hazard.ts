import type { FloodResult, HazardResult, LandslideResult } from '../types';

/**
 * ハザードの地点判定（LUNA_TASKS.md T17）。
 * pipeline/fetch_hazard.py が z=14 タイルごとに作った格子（既定128×128マス、1マス約16m）を引く。
 */
export const HAZARD_ZOOM = 14;
type Layer = 'flood' | 'storm_surge' | 'tsunami' | 'landslide';
const LAYERS: Layer[] = ['flood', 'storm_surge', 'tsunami', 'landslide'];
const LANDSLIDE_TYPES: [number, string][] = [[1, '急傾斜地の崩壊'], [2, '土石流'], [4, '地滑り']];
const LANDSLIDE_SPECIAL_BIT = 8;

interface HazardIndex { tiles: string[]; withFeatures: string[]; size: number; labels?: Record<string, string> }
interface HazardTile { size: number; rle: string }
interface HazardCodes { floodDepthRank: { codes: Record<string, { label: string; minM: number; maxM: number | null }> } }
type Loader = (path: string) => Promise<unknown>;

/** Python の pipeline/common/tiles.py と同じ計算 */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const { fx, fy } = lonLatToTileFraction(lon, lat, z);
  return { x: Math.floor(fx), y: Math.floor(fy) };
}

function lonLatToTileFraction(lon: number, lat: number, z: number): { fx: number; fy: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return { fx: ((lon + 180) / 360) * n, fy: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n };
}

/** 「値:個数」をカンマでつないだ行優先のランレングスを展開する */
export function decodeRle(text: string, size: number): Int32Array {
  const cells = new Int32Array(size * size);
  let offset = 0;
  for (const part of text.split(',')) {
    const [value, count] = part.split(':').map(Number);
    cells.fill(value, offset, offset + count);
    offset += count;
  }
  if (offset !== size * size) throw new Error('ハザードの格子の大きさが合いません');
  return cells;
}

/** 高潮・津波のマスの値（下限cm×1000＋上限0.1m、999は上限なし）を深さに戻す */
export function decodeDepth(value: number): { minM: number; maxM: number | null } {
  const upper = value % 1000;
  return { minM: Math.floor(value / 1000) / 100, maxM: upper === 999 ? null : upper / 10 };
}

const NO_LOCATION: HazardResult = {
  flood: { status: 'no_location' }, stormSurge: { status: 'no_location' },
  tsunami: { status: 'no_location' }, landslide: { status: 'no_location' },
};

async function defaultLoader(path: string): Promise<unknown> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

export function createHazardLookup(load: Loader = defaultLoader) {
  const cache = new Map<string, Promise<unknown>>();
  const grids = new Map<string, Int32Array>();
  const get = (path: string) => {
    let request = cache.get(path);
    if (!request) {
      request = load(path);
      cache.set(path, request);
      request.catch(() => cache.delete(path));
    }
    return request;
  };

  /** マスの値。範囲外なら 'out_of_coverage'、区域がなければ 0 */
  async function cellValue(layer: Layer, lat: number, lon: number): Promise<{ value: number; index: HazardIndex } | 'out_of_coverage'> {
    const index = await (get(`hazard/${layer}/index.json`) as Promise<HazardIndex>).catch(() => null);
    const { fx, fy } = lonLatToTileFraction(lon, lat, HAZARD_ZOOM);
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const key = `${HAZARD_ZOOM}/${x}/${y}`;
    if (!index || !index.tiles.includes(key)) return 'out_of_coverage';
    if (!index.withFeatures.includes(key)) return { value: 0, index };
    const path = `hazard/${layer}/${key}.json`;
    let grid = grids.get(path);
    if (!grid) {
      const tile = await get(path) as HazardTile;
      grid = decodeRle(tile.rle, tile.size);
      grids.set(path, grid);
    }
    const size = Math.round(Math.sqrt(grid.length));
    const col = Math.min(size - 1, Math.floor((fx - x) * size));
    const row = Math.min(size - 1, Math.floor((fy - y) * size));
    return { value: grid[row * size + col], index };
  }

  function depthResult(cell: { value: number; index: HazardIndex } | 'out_of_coverage'): FloodResult {
    if (cell === 'out_of_coverage') return { status: 'out_of_coverage' };
    if (cell.value === 0) return { status: 'none' };
    const { minM, maxM } = decodeDepth(cell.value);
    const label = cell.index.labels?.[String(cell.value)] ?? (maxM === null ? `${minM}m以上` : `${minM}〜${maxM}m`);
    return { status: 'in', rank: 0, label, minM, maxM, rivers: [] };
  }

  return async function lookupHazard(lat: number | null, lon: number | null): Promise<HazardResult> {
    if (lat === null || lon === null) return NO_LOCATION;
    const codes = await (get('hazard_codes.json') as Promise<HazardCodes>).catch(() => null);
    const [flood, stormSurge, tsunami, landslide] = await Promise.all(LAYERS.map((layer) => cellValue(layer, lat, lon)));

    let floodResult: FloodResult;
    if (flood === 'out_of_coverage') floodResult = { status: 'out_of_coverage' };
    else if (flood.value === 0) floodResult = { status: 'none' };
    else {
      const code = codes?.floodDepthRank.codes[String(flood.value)];
      floodResult = { status: 'in', rank: flood.value, label: code?.label ?? `ランク${flood.value}`, minM: code?.minM ?? 0, maxM: code?.maxM ?? null, rivers: [] };
    }

    let landslideResult: LandslideResult;
    if (landslide === 'out_of_coverage') landslideResult = { status: 'out_of_coverage' };
    else if (landslide.value === 0) landslideResult = { status: 'none' };
    else {
      landslideResult = {
        status: 'in',
        zone: landslide.value & LANDSLIDE_SPECIAL_BIT ? 'special' : 'warning',
        types: LANDSLIDE_TYPES.filter(([bit]) => landslide.value & bit).map(([, label]) => label),
      };
    }

    return { flood: floodResult, stormSurge: depthResult(stormSurge), tsunami: depthResult(tsunami), landslide: landslideResult };
  };
}

export const lookupHazard = createHazardLookup();
