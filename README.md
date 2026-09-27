# 京阪間 中古マンション相場マップ

## 概要

京都〜大阪間と兵庫県尼崎市の中古マンションについて、売出価格を国土交通省の成約事例と比べ、地図とグラフで確認する静的サイトです。駅別の成約相場と、洪水・高潮・津波・土砂災害の地点判定も表示します。

## 公開データと出典

| 出典 | 表示するクレジット | 用途 |
|---|---|---|
| [国土交通省 不動産情報ライブラリ（API）](https://www.reinfolib.mlit.go.jp/) | このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません | API利用規約 第7条で表示が必要なクレジット |
| [不動産価格（取引価格・成約価格）情報](https://www.reinfolib.mlit.go.jp/realEstatePrices/) | 出典：国土交通省 不動産情報ライブラリ「不動産価格（取引価格・成約価格）情報」を加工して作成 | 中古マンションの比較事例・価格指数・駅別相場 |
| [ハザードマップポータルサイト](https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html) | 出典：「ハザードマップポータルサイト」 | 地図に重ねる洪水・内水・高潮・津波・土砂災害のタイル（加工なし） |
| [ハザードマップポータルサイト（浸水想定区域）](https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/copyright_data.html) | 「ハザードマップポータルサイト」（同URL）を加工して作成 | 洪水・高潮・津波の地点判定用の格子（津波は一部非商用のデータを含む） |
| [国土数値情報（駅別乗降客数データ）](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-S12-2023.html) | 「国土数値情報（駅別乗降客数データ）」（国土交通省）（同URL）を加工して作成 | 駅の位置と乗降客数 |
| [国土数値情報（土砂災害警戒区域データ）](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A33-2024.html) | 「国土数値情報（土砂災害警戒区域データ）」（国土交通省）（同URL）を加工して作成 | 土砂災害の地点判定用の格子（一部非商用のデータを含む） |
| [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html) | 地理院タイル | 背景地図 |

## セットアップ

### データ処理

リポジトリのルートで実行します。

    python -m venv .venv
    .venv\Scripts\python -m pip install -r pipeline\requirements.txt

APIを使う場合は、ルートに .env を作成して REINFOLIB_API_KEY を設定してください。.env は Git 管理対象外です。

### Webサイト

Node.js 22 以上が必要です（古い版では `styleText` のエラーで起動しません）。

    cd web
    npm ci
    npm run dev      # 手元で表示
    npm run build    # 公開用のビルド（web/dist）

## データ更新

公開データはローカルで取得・加工し、変更を確認してコミットします。国交省のデータは四半期ごとに追加されるので、3か月に1回程度で十分です。

| やること | コマンド | 所要時間の目安 |
|---|---|---|
| 成約・取引事例（CSV と API）を取り込み、サイト用データを作る | `.venv\Scripts\python -m pipeline.update_all --api` | 数分（API キーが必要） |
| CSV だけで作る | `.venv\Scripts\python -m pipeline.update_all` | 1分 |
| 駅と駅別相場を作り直す | `.venv\Scripts\python -m pipeline.fetch_stations` | 5分（初回） |
| ハザードの格子を作り直す（対象路線の駅から2km） | `.venv\Scripts\python -m pipeline.fetch_hazard` | 20分（初回） |
| ハザードのコード表を作り直す | `.venv\Scripts\python -m pipeline.build_hazard_codes` | すぐ |

- CSV は国土交通省の価格検索でダウンロードし、`data/manual_csv/` に置きます（種類は「中古マンション等」、期間が重ならないように分けて取得）。同じ区分・府県・四半期が複数のファイルにあると取り込みが止まります。
- CSV がある期間は CSV を優先し、ない期間は API のデータを使います。API のデータには最寄駅と徒歩分数がありません。
- 取り込みの結果は `reports/quality_report.md` で確認できます。
- `web/public/local-data/` に手元専用の物件データがあると、手元の画面にだけ「掲載物件（手元）」タブが出ます。このフォルダは Git 管理対象外で、公開ビルドからも削除されます。

GitHub Actions はサイトのビルドと GitHub Pages への公開に使い、APIは呼び出しません。

## 公開

1. GitHub で公開リポジトリを作ります（このリポジトリは `Condominium_Market`）。
2. ブランチ名を `main` にして、確認済みの変更を push します（手元のブランチが `master` の場合は `git branch -m master main`。GitHub Actions は `main` への push で動きます）。
3. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定します。

`main` への push または Actions の手動実行で、Webテストとビルドが通ると GitHub Pages に公開されます。公開データはこのリポジトリの `web/public/data/` を使い、GitHub Actions から外部APIは呼び出しません。

## 注意

このサイトは購入・投資の助言ではありません。不動産ポータルサイトの掲載情報は含みません。利用者が登録した物件は各自のブラウザ内だけに保存され、サイトには送信されません。
