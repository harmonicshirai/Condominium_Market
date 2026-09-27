import type { FloodResult, HazardResult, LandslideResult } from '../types';

interface HazardPanelProps {
  hazard: HazardResult | null;
  loading: boolean;
  /** false のときは判定しない理由を出す（位置がおおよその物件） */
  allowed: boolean;
}

function depthText(result: FloodResult): string {
  switch (result.status) {
    case 'in': return `区域内：${result.label}`;
    case 'none': return '区域外';
    case 'out_of_coverage': return 'この場所のデータは未取得';
    case 'no_location': return '位置が未登録';
  }
}

function landslideText(result: LandslideResult): string {
  switch (result.status) {
    case 'in': return `${result.zone === 'special' ? '土砂災害特別警戒区域' : '土砂災害警戒区域'}（${result.types.join('・')}）`;
    case 'none': return '区域外';
    case 'out_of_coverage': return 'この場所のデータは未取得';
    case 'no_location': return '位置が未登録';
  }
}

export default function HazardPanel({ hazard, loading, allowed }: HazardPanelProps) {
  return (
    <section className="detail-card">
      <h3>ハザード（地点判定）</h3>
      {!allowed ? (
        <p className="form-note">位置が住所から推定したおおよそのものなので、地点判定はしていません。詳細（掲載ページの地図の位置）を取得すると判定できます。地図の「ハザード表示」で周辺の区域は確認できます。</p>
      ) : loading || !hazard ? <p className="form-note">判定しています。</p> : (
        <dl className="detail-grid">
          <div><dt>洪水（想定最大規模）</dt><dd>{depthText(hazard.flood)}</dd></div>
          <div><dt>高潮（想定最大規模）</dt><dd>{depthText(hazard.stormSurge)}</dd></div>
          <div><dt>津波</dt><dd>{depthText(hazard.tsunami)}</dd></div>
          <div><dt>土砂災害</dt><dd>{landslideText(hazard.landslide)}</dd></div>
        </dl>
      )}
      <p className="form-note">
        区域外でも安全とは限りません。約16m四方のマス単位の判定で、区域の境目では結果が変わることがあります。自治体の最新のハザードマップで確認してください。
        {' '}<a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener noreferrer">ハザードマップポータルサイト</a>
      </p>
    </section>
  );
}
