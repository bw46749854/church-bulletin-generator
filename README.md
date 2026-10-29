# church-bulletin-generator

小さな教会の **週報（毎週の印刷物）と礼拝スライド** を、ブラウザの入力画面から作るシステムです。
それまで牧師が毎週 Word で手作りしていた A3 の週報を、入力画面に打ち込むだけで、原本と同じ紙面の PDF が出るようにしました。礼拝で映すスライド（pptx）も同じデータから作ります。

実際の教会で運用しているシステムを、公開用に教会名・アカウントの ID・URL などを架空の値に置き換えて写したものです（運用データは含みません）。

## 何ができるか

- **週報の入力と PDF 化**：司会・説教題・賛美の番号・報告などを入力すると、サーバーで PDF を組み、画面にそのまま表示する。プレビューと印刷物が同じ PDF なので「画面と紙が違う」が起きない
- **前の週からの引き継ぎ**：新しい週は、前の週の「次週の予定」欄から担当者・聖書箇所・説教題を自動で入れる。休会の暦（第何週は休み、など）も自動で反映
- **礼拝スライド（pptx）の生成**：賛美の番号から歌詞、聖書箇所から本文を引いて、背景・部品・式順のテンプレートに流し込む
- **役割ごとの入口**：週報を書く牧師と、スライドを担当する人で、触れる範囲を分けている（スライド担当は週報の中身を変えられない）
- **教会サイトへの反映**：ボタン 1 つで、ホームページの礼拝案内を最新の週に作り直す

## 構成

```
 牧師のブラウザ（入力画面）                  スライド担当のブラウザ
        │  Cloudflare Access（メールのワンタイム PIN）   │  Cloudflare Access（別の名簿）
        ▼                                                ▼
 Cloudflare Worker（週報）  ◀──── Service Binding ──── Cloudflare Worker（スライド担当用。データを持たない）
   ├─ API の門番（Access の JWT を検証。無ければ 403）
   ├─ D1   … 週データ・名簿・変更の記録・ファイルの目次
   ├─ D1   … 聖書本文（読み取り専用）
   ├─ KV   … 歌詞・テンプレートの中身（内容のハッシュ名）、PDF のキャッシュ
   └─ PDF エンジン … Render 上のコンテナ（Chromium）⇄ Cloudflare Browser Rendering を設定で切り替え
```

## 使った技術

| 分野 | 技術 |
|---|---|
| 実行環境 | Cloudflare Workers、D1（SQLite）、KV、Service Binding、Workers Builds、Cron Triggers |
| 認証 | Cloudflare Access（Worker 単位）＋ アプリ側での JWT 検証 |
| PDF | HTML/CSS のテンプレートを Chromium（Playwright / Puppeteer）で PDF 化。Render（Docker）と Browser Rendering の 2 系統 |
| 画面 | 素の JavaScript（ES Modules）。PDF.js で PDF を表示 |
| スライド | pptx（Office Open XML）を JSZip で組み立て（ブラウザ内でも生成） |
| テスト | Node.js 組み込みのテストランナー（97 件。Chromium で実際に紙面を組んで寸法を測る試験を含む） |
| データ整備 | Python（聖書本文・讃美歌・交読文の取り込み） |

## 工夫したところ

**1. 費用が「絶対に発生しない」作りにした**
教会に毎月の請求を確かめる担当はいません。そこで、どのサービスにもクレジットカードを登録しないことを原則にしました。Cloudflare と Render の無料枠だけで動かし、上限に当たったときは「止まる」で済んで「請求される」は起こらない構成です。カード登録が必要な R2 は使わず、D1 と KV で置き換えました。PDF エンジンは、無料枠を使い切ったときに備えて 2 系統を設定で切り替えられるようにしています。

**2. Word の原本と同じ紙面を HTML/CSS で再現した**
過去 14 部の原本と行ごとに比べて、欄ごとの字間や改行位置を合わせました。文字が欄に入らないときは、横幅 → 字間 → 文字サイズの順に縮める規則（`src/template/fit-policy.json`）を当てます。それでも入らない欄は PDF 上で赤枠にし、画面に「どの欄を・どう直せばよいか」を出します。

**3. 同じ入力からは PDF を作り直さない**
PDF の元になるデータ・フォント・テンプレートの版・Chromium の版からハッシュ（指紋）を作り、KV にキャッシュしています。曲名を 1 つ直しても、その曲を使う週だけが作り直しになります。無料枠の節約と、プレビューの速さのための仕組みです。

**4. 認証が外れたら「誰も入れない」側に倒れるようにした**
Cloudflare Access の手前の設定を誤っても個人情報が漏れないよう、Worker の中でも Access の証明（JWT）を検証し、無ければ API を断ります。画面の HTML・JS・CSS は門番を通らずに配信されるため、そこには一切データを入れません。これはビルド後の成果物を検査するテスト（`tests/assets-no-data.test.mjs`）で守っています。

**5. 権限を Worker の単位で分けた**
スライド担当用の入口は別の Worker にし、データを持たせていません。週報の Worker とは Service Binding でつなぎ、許可した操作（歌詞の差し替え、スライドの生成など）だけを受け付ける窓口クラスを置いています。担当者に何ができるかは、その許可の一覧そのものです。

**6. ファイルは上書きせず、版を残す**
歌詞やテンプレートのファイルは、内容のハッシュを名前にして KV に置き、「今の版」の目次だけを D1 に持ちます。差し替えても前の版は 14 日残り、毎朝 Cron で片付けます。誤って差し替えても戻せます。

**7. 実機で起きた問題を記録して設計に戻した**
iPad の Safari では、ダウンロードの確認が出ている間にページの通信が落ちる、PDF を iframe で 1 ページしか描かない、といった問題が実際に起きました。保存とダウンロードを分ける、PDF.js の Web Worker を使い回して表示を通信なしで終える、などで対処しています。経緯と原因は設計書に残しています。

**8. 個人情報を Git に入れない**
名簿・出席数・献金額などの運用データは Git の外（本番は D1）に置きます。リポジトリには仮名のサンプルデータ（`data/examples/`）だけを入れ、それで手元で一通り動くようにしています。

## 動かし方（手元）

Cloudflare のアカウントは要りません。D1・KV は wrangler の手元の模擬環境で動きます。

```bash
npm install
npx playwright install --with-deps chromium   # PDF の生成に使う
npm run demo       # 見本一式を手元の D1・KV と data/ に入れる（聖書は初回に口語訳を取得）
npm run dev        # http://localhost:8787/input-shuho/
npm test
```

Worker の形のまま試すときは、`npm run dev` を動かしたまま別の端末で `npm run dev:worker` を開きます（http://localhost:8788/input-shuho/。PDF は `npm run dev` を借ります）。
礼拝スライドはコマンドでも作れます: `node scripts/make-slides.mjs worship data/weeks/2026-07-26.json out/worship.pptx --prep 4`

### デモの素材について

- 教会・名簿・週の内容はすべて架空です（`data/examples/`）
- スライドのテンプレート（`data/examples/files/template/`）は、色（えんじ・クリーム・金）・フォント（BIZ UDPゴシック）・枠の絵をデモ用に差し替えたもの
- 歌詞（`data/examples/files/hymns/`）は、著作権の切れた英語の原詩（Amazing Grace など 5 曲と頌栄）から、このリポジトリのために新しく訳したもの
- 交読文と聖書本文は口語訳聖書（1954/1955 年版。著作権の保護期間が満了）。出典は [seven1m/open-bibles](https://github.com/seven1m/open-bibles)（Public Domain）

## 文書

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 設計と仕様の正本（データの置き場、画面の操作とサーバーで起きること、PDF、認証、既知の問題）
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — 運用の手順書（デプロイ、Access、同期、障害時の復旧）
- [docs/slides-role.md](docs/slides-role.md) — スライド担当の権限をどう分けたか（検討した案と判断の理由）
- [docs/file-store.md](docs/file-store.md) — 版を残すファイルの置き場の設計
- [docs/requirements-todo.md](docs/requirements-todo.md) — 要件の検討記録

## 開発について

要件の整理・設計の判断・実機での検証は自分で行い、実装には AI のコーディング支援（Claude Code）を使いました。
