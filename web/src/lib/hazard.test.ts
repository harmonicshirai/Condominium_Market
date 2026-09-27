import { describe, expect, it } from 'vitest';
import { createHazardLookup, decodeDepth, decodeRle, lonLatToTile } from './hazard';

// 高槻付近ではなく、テスト用に尼崎駅付近のタイルを使う
const LAT = 34.7185;
const LON = 135.4177;

function loaderFor(files: Record<string, unknown>) {
  return async (path: string) => {
    if (!(path in files)) throw new Error(`404 ${path}`);
    return files[path];
  };
}

describe('tile math', () => {
  it('matches the Python values for Kyoto and Osaka stations', () => {
    expect(lonLatToTile(135.758767, 34.985849, 14)).toEqual({ x: 14370, y: 6490 });
    expect(lonLatToTile(135.495951, 34.702485, 14)).toEqual({ x: 14358, y: 6506 });
  });
});

describe('decoders', () => {
  it('decodes run-length grids and depth values', () => {
    expect(Array.from(decodeRle('0:2,3:1,0:1', 2))).toEqual([0, 0, 3, 0]);
    expect(() => decodeRle('0:3', 2)).toThrow();
    expect(decodeDepth(50030)).toEqual({ minM: 0.5, maxM: 3 });
    expect(decodeDepth(500999)).toEqual({ minM: 5, maxM: null });
  });
});

describe('lookupHazard', () => {
  const { x, y } = lonLatToTile(LON, LAT, 14);
  const key = `14/${x}/${y}`;
  const index = (withFeatures: string[], labels?: Record<string, string>) => ({ tiles: [key], withFeatures, size: 2, ...(labels ? { labels } : {}) });
  const filled = (value: number) => ({ size: 2, rle: `${value}:4` });

  it('returns values for every layer inside covered tiles', async () => {
    const lookup = createHazardLookup(loaderFor({
      'hazard_codes.json': { floodDepthRank: { codes: { '2': { label: '0.5～3.0m未満（床上から1階が浸水）', minM: 0.5, maxM: 3 } } } },
      'hazard/flood/index.json': index([key]), [`hazard/flood/${key}.json`]: filled(2),
      'hazard/storm_surge/index.json': index([key], { '300050': '3m以上5m未満' }), [`hazard/storm_surge/${key}.json`]: filled(300050),
      'hazard/tsunami/index.json': index([]),
      'hazard/landslide/index.json': index([key]), [`hazard/landslide/${key}.json`]: filled(2 | 8),
    }));
    const result = await lookup(LAT, LON);
    expect(result.flood).toMatchObject({ status: 'in', rank: 2, minM: 0.5, maxM: 3 });
    expect(result.stormSurge).toMatchObject({ status: 'in', label: '3m以上5m未満', minM: 3, maxM: 5 });
    expect(result.tsunami).toEqual({ status: 'none' });
    expect(result.landslide).toEqual({ status: 'in', zone: 'special', types: ['土石流'] });
  });

  it('distinguishes out of coverage and no location', async () => {
    const lookup = createHazardLookup(loaderFor({ 'hazard/flood/index.json': { tiles: [], withFeatures: [], size: 2 } }));
    const result = await lookup(LAT, LON);
    expect(result.flood).toEqual({ status: 'out_of_coverage' });
    expect(result.landslide).toEqual({ status: 'out_of_coverage' });
    expect((await lookup(null, null)).flood).toEqual({ status: 'no_location' });
  });

  it('reads the cell that contains the point', async () => {
    // 2×2 の格子の4マスに 1〜4 を入れ、点がどのマスに入るかをタイル内の位置から求めて確かめる
    const lookup = createHazardLookup(loaderFor({
      'hazard_codes.json': { floodDepthRank: { codes: {} } },
      'hazard/flood/index.json': index([key]), [`hazard/flood/${key}.json`]: { size: 2, rle: '1:1,2:1,3:1,4:1' },
    }));
    const n = 2 ** 14;
    const latRad = (LAT * Math.PI) / 180;
    const col = Math.floor((((LON + 180) / 360) * n - x) * 2);
    const row = Math.floor((((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - y) * 2);
    const result = await lookup(LAT, LON);
    expect(result.flood).toMatchObject({ status: 'in', rank: row * 2 + col + 1 });
  });
});
