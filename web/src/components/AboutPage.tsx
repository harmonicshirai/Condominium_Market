import type { Meta } from '../types';
import { formatPeriod } from '../lib/format';

export default function AboutPage({ meta }: { meta: Meta | null }) {
  if (!meta) return <section className="content-section"><h2>データと注意事項</h2><p>データ情報を読み込み中です。</p></section>;
  return (
    <section className="content-section about-page">
      <h2>データと注意事項</h2>
      <section className="detail-card">
        <h3>データの出典</h3>
        <ul className="source-list">{meta.sources.map((source) => (
          <li key={source.id}>
            <h4><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a></h4>
            <p>{source.credit}</p>
            <small>{source.usage}</small>
          </li>
        ))}</ul>
      </section>
      <section className="detail-card">
        <h3>データの時点</h3>
        <dl className="detail-grid">
          <div><dt>対象期間</dt><dd>{formatPeriod(meta.periodFrom)}〜{formatPeriod(meta.periodTo)}</dd></div>
          <div><dt>生成日時</dt><dd>{new Date(meta.generatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</dd></div>
          <div><dt>採用した事例</dt><dd>{meta.transactionCount.toLocaleString('ja-JP')}件</dd></div>
          <div><dt>駅情報</dt><dd>{meta.hasStations ? '取得済み' : '未取得'}</dd></div>
          <div><dt>ハザード判定データ</dt><dd>{meta.hasHazard ? '取得済み' : '未取得'}</dd></div>
        </dl>
      </section>
      <section className="detail-card">
        <h3>評価の方法</h3>
        <ul>
          <li>売出価格から設定した想定値引き率を引いた実効価格を、国土交通省の成約事例と比べます。</li>
          <li>事例は同じ市区町村を優先し、期間・築年数・面積・耐震区分をそろえます。件数が足りない場合は、徒歩条件、期間、築年数、面積、地域、価格情報の順に範囲を広げます。</li>
          <li>価格指数で過去の事例を評価時点に近づけてから、㎡単価の中央値と25〜75パーセンタイルを表示します。</li>
          <li>リフォーム状態は、同じ状態の事例が一定数ある場合にそろえます。足りない場合はそのまま比較し、注意として表示します。</li>
          <li>比較件数とばらつき、データの古さから信頼度を示します。比較件数が5件未満、築年が不明、または信頼度Dの場合は判定を保留します。</li>
          <li>想定値引き率は利用者が設定します。根拠がない場合は0%のままにしてください。</li>
        </ul>
      </section>
      <section className="detail-card">
        <h3>限界と注意点</h3>
        <ul>
          <li>国土交通省の取引データは個別の物件を特定できないよう加工されており、掲載物件や住所と直接突き合わせられません。</li>
          <li>売出価格と成約価格は性質が異なります。表示する比較は参考情報で、個別物件の査定ではありません。</li>
          <li>階数、向き、眺望、室内や管理の状態など、価格に影響する条件は比較に含まれていません。</li>
          <li>ハザード情報は未整備の地域があります。自治体の最新のハザードマップも確認してください。</li>
          <li>国交省の公開データは、価格が有効数字2桁、面積が5㎡刻みに丸められているため、1件ごとに数％の誤差があります。多数の事例の中央値で比べることで影響を小さくしています。</li>
          <li>成約価格情報の「改装」は「改装済み」か空欄のみで、空欄には未改装と不明の両方が含まれます。</li>
          <li>ハザードの地点判定は、区域を約16m四方のマスに置き換えて行っています。判定の範囲は駅の周辺など取得済みの場所だけで、それ以外は「未取得」と表示します。住所から推定したおおよその位置の物件は判定しません。</li>
        </ul>
      </section>
      <section className="detail-card">
        <h3>登録した物件について</h3>
        <p>物件情報と条件はこのブラウザ内に保存され、サイトには送信されません。ブラウザのデータを消すと登録内容も消えるため、定期的に書き出して保管してください。</p>
      </section>
      <p className="disclaimer">このサイトは購入・投資の助言ではありません。</p>
    </section>
  );
}
