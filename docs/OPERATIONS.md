# 運用の手順書（サンプル教会の週報）

週データ（JSON）→ テンプレート（HTML+CSS）→ PDF。
**設計・仕様・データの扱いの正本は [docs/ARCHITECTURE.md](ARCHITECTURE.md)。** この文書は手順書。最初の要件定義は非公開。

## 構成

```
data/config.json            固定文・式順・追加項目プリセット・集会時間・週次ルール（Git）
data/examples/              仮名化サンプル一式（Git）。下の運用データが無いときはこれで動く
src/template/index.html     テンプレート本体
src/template/bulletin.css   レイアウト（座標は原本 PDF から実測した mm 値）
src/template/render.js      JSON → DOM、自動計算、縮小（fit-policy）
src/template/fit-policy.json 縮小ルール
src/fonts/                  IPA P明朝/Pゴシック（既定。かなが詰まる＝原本の MS P明朝と同じ幅感）、IPAex明朝/ゴシック（等幅・比較用）、BIZ UDP明朝/ゴシック（候補）
src/lib/render.mjs          HTML 組み立てと Playwright（Chromium）での PDF 化（CLI と dev サーバで共用）
src/admin/                  入力画面
src/ui/                     入力画面と担当者ページで共通の部品（マスタと pptx・ファイルの差し替え・PDF の表示・スライド作成。docs/slides-role.md §5）
src/slides-page/            担当者ページ（/input-shuho/slides/。担当者用 Worker のアセット。見た目は src/admin/admin.css を共用）
slides/                     担当者用 Worker（samplechurch-slides）: worker.mjs（受付の証明から人を確かめる）・relay.mjs（窓口への中継）・wrangler.jsonc
scripts/render-pdf.mjs      CLI で PDF 化
scripts/dev-server.mjs      入力画面 + API のローカルサーバ
scripts/compare.py          原本との画像比較（重ね合わせ）
scripts/verify-text.py      原本の全行が生成側に含まれるか照合（欠落＝クリップの検出）
scripts/build-hymns.py      曲名マスタの初回作成（hymns.txt から）
scripts/build-readings.py   交読文マスタの初回作成（readings.txt から）
scripts/glyph-widths.mjs    紙面のフォントの字幅表（src/ui/glyph-widths.json。題の欄の「入るか」の表示。フォントを替えたら作り直す）
```

### Git に入れないもの（運用データ）

基準は「誰がどこで変えるか」。開発者がエディタで変えるもの（上の一覧）は Git、
運用者が入力画面から変えるものは Git に入れない（本番は Cloudflare D1、ローカルは下の場所）。

```
data/church.json            住所・口座・牧師連絡先
data/masters/people.json    名簿
data/masters/hymns.json     韓日讃頌歌 番号→曲名（画面の見出しの「マスタ」で登録できる）
data/masters/readings.json  交読文 番号→題
data/prayer-list.json       覚えて祈りましょう
data/weeks/YYYY-MM-DD.json  その週のデータ
```

clone 直後はこれらが無いので `data/examples/` の仮名化サンプルで動く（起動時に警告が出る）。
実データは上の場所に置けばそちらが使われる。

### 成果物の置き場

```
data/weeks/<日付>.json      入力＝保存物
out/<日付>.html             中間 HTML。ブラウザで開くと PDF と同じ紙面が描画される（CSS を直して再読込できる）
out/<日付>.pdf              最終
```

いずれも Git に入らない。JSON があれば HTML と PDF は再生成できる。

## 入力画面（ブラウザ）で試す

```bash
cd shuho
npm run dev
```

ブラウザで http://localhost:8787/input-shuho/ を開く（Windows 側のブラウザから WSL2 の localhost にそのまま届く）。

- ヘッダの日付を押して、週の一覧から既存の週を開く／「新しい週を作る…」の窓で、もとにする週・作る日付・写し方（新しい週として／丸ごと複製）を選んで作る（ARCHITECTURE.md §19）／「JSON を読み込む…」で保存しておいた控え（JSON）を初期値にする（未保存扱い。同じ日付がサーバーにあれば保存時に上書き）。日付は作成時に決まり、以後は「日付を変更…」でのみ変えられる（重複はその場で拒否）
- 各タブは週報の紙面と同じ配置。人物はプルダウン（名簿に無い人は「直接入力…」）。賛美は番号だけ
- 「プレビュー」タブを開くと、変更があれば PDF を作り直す（Ctrl+Enter でも）。溢れた欄は上に表示され、PDF 上は赤枠
- 「保存」で `data/weeks/日付.json` と `out/日付.pdf`、中間 HTML `out/日付.html` を書く。**保存ではダウンロードしない**。PDF と控え（JSON）は、保存の知らせのボタンか週の一覧の「この週の PDF を保存」「この週の控え（JSON）を保存」で受け取る（iOS の Safari の都合。ARCHITECTURE.md §4.8）。**保存を押すまで何も残らない**（下書きは持たない）
- 同じ日付を別のタブで開くと入力画面は出ない（そのタブを閉じれば自動で編集できる）。別の PC・別プロファイルで先に保存されていた場合は、保存時に「別の場所で保存されています」と出て、上書きするか選ぶ
- 讃頌歌・交読文・名簿などのマスタは、見出しの「週報｜マスタ」で開く（どの週にも共通。週の欄には置かない）。曲名が未登録の番号は、番号の横の「曲名が未登録（マスタで登録）」を押すと、その番号を入れたマスタの新規が開く。据え置きのデータ（聖句・標語・覚えて祈りましょう・牧師連絡先・住所・送金先）は紙面の印刷される位置にあり、「編集」を押したときだけ書き換えられる（更新が稀なので、ふだんは非活性）

API（`src/lib/api.mjs`。ローカルと本番 Worker で同じコード、`/input-shuho/api/` の下）：`GET bootstrap`、`GET week/:date`（`{week, version}`）、`GET week/:date/json`（ダウンロード）、`GET week/:date/new`、`GET week/:date/exists`、`POST week/:date/rename`、`POST preview`（PDF）、`POST save`（`base_version` が一致しなければ 409、`force` で上書き。成功時は PDF 本体を返し `x-version` / `x-overflow` / `x-pruned`（保持の上限で消した週）ヘッダを付ける）、`GET pdf/:date`（保存済み JSON から作り直す）、`POST masters/hymns`・`POST masters/readings`（`{"番号": "題"}` の追加・修正。上書きで控えは残さない）、`DELETE masters/hymns/:no`・`DELETE masters/readings/:no`、`POST masters/prayer-list`、`POST masters/church`、`GET export`（マスタ一式のバックアップ）、`GET changes?days=N`（変更の記録。`docs/ARCHITECTURE.md` §2.6）、`POST client-log`（画面で起きたエラーを Workers Logs に 1 行残す。週データは受け取らない）、`PUT files/(hymns|readings)/:no.pptx`（マスタに無い番号は 400。前の内容は `history/` へ）・`DELETE files/(hymns|readings)/:no.pptx`（`history/` へ写してから消す）

PDF と控え（JSON）は、保存の知らせのボタンか週の一覧から、押した分だけダウンロードする（ARCHITECTURE.md §4.8）。サーバーは PDF を保管しない（JSON から再生成できる）。

保存・表示・ダウンロードを iOS の Safari の特性（確認の間の通信が落ちる・続けたダウンロードは先のものが消える）の下で確かめる試験: 開発サーバを起動したまま `node scripts/e2e-ios-download.mjs http://localhost:8787/input-shuho/`。保持の場面（消える週の知らせ）は `RETAIN_WEEKS=2 npm run dev` で起動したサーバに `ONLY=prune` で流す。**試験は保存するので、`data/` の写しで起動したサーバに流す**（ARCHITECTURE.md §4.8）。
PDF の準備中・失敗・受付のログイン切れのときの保存の知らせ（ARCHITECTURE.md §14.2・§6.1）の試験: 同じく写しのサーバに `node scripts/e2e-engine-login.mjs http://localhost:8787/input-shuho/`（Render の眠り・時計を進めて裏に回したこと・受付の 401 を真似る）。

設計上の約束：識別子はファイル名の日付（中身の `date` はファイル名に従う）。編集権は同じブラウザプロファイル内で日付ごとに1タブ（Web Locks）。下書きは持たない（localStorage 等は使わない）。

## 本番（Cloudflare Worker）

`worker/` が本番の入口。`wrangler.jsonc` の通り、静的アセット（入力画面・テンプレ・フォント）＋ D1（データ）＋ Browser Rendering（PDF）。
URL はローカルと同じ `/input-shuho/`。守りは **Cloudflare Access（Worker 単位。カード不要）＋ API の門番**（下の「Access」）。
Google サインイン（下の「ログイン」）の部品も残っているが、使っていない。担当者ページは別の Worker（下の「担当者ページ」）。

```bash
npm run build                 # src/admin → dist/input-shuho/、src/ui → dist/input-shuho/ui/、src/template と src/fonts → dist/shuho-assets/（PDF エンジンが読む）、担当者ページ → dist-slides/。どれもデータは入れない
npm run dev:worker            # wrangler dev（ローカル D1）。PDF は別に動かした `npm run dev`（8787）の Playwright を借りる
npm run seed -- data/examples # ローカル D1 に初期データ（--remote を付けると本番 D1）
npm run deploy                # wrangler deploy（要 wrangler login）
npm test                      # tests/ の試験（担当者用の窓口の許可の一覧・中継・受付の証明と門番・変更の記録・配るファイルにデータが無いこと。node --test）
```

D1 のキーは `data/` と同じ配置（`church.json`, `masters/*.json`, `prayer-list.json`, `weeks/<日付>.json`）。
本番では週データを新しい方から `RETAIN_WEEKS` 週（いま 5。`wrangler.jsonc`）だけ残し、保存のたびに古い週を消す。マスタの正本も D1 だけなので、画面の「マスタ一式をダウンロード」で控えを取る。

### ログイン（Google サインイン。いまは使っていない）

API の門番は受付（Access）を前提にしているので、こちらに切り替えるなら門番を見直す（`docs/ARCHITECTURE.md` §6）。

1. Google Cloud Console で OAuth クライアント ID（ウェブ アプリケーション）を作り、承認済み JavaScript 生成元に Worker の URL を入れる
2. `wrangler.jsonc` の `GOOGLE_CLIENT_ID` にそのクライアント ID を書く（空ならログインなし＝ローカル用）
3. `wrangler secret put ALLOWED_EMAILS`（カンマ区切りの許可メール）、`wrangler secret put SESSION_SECRET`（長いランダム文字列）

流れ：画面の「Google でログイン」→ Google が ID トークンを発行 → `api/auth/google` で署名・発行元・宛先・期限・`email_verified` を検証し、許可メールなら Cookie（HMAC 署名、30 日、使うたびに延長、最初のログインから最長 1 年）を発行。
以後の API は Cookie で判定し、無ければ 401。`api/auth/me` で誰か分かる、`api/auth/logout` で消す。
`/shuho-assets/`（テンプレ・フォント）と入力画面の HTML 自体はログインなしで見えるが、データは全部 API の後ろにある。
ローカルで本番と同じ動きを試すには `GOOGLE_CLIENT_ID=... ALLOWED_EMAILS=... SESSION_SECRET=... npm run dev`。

## 礼拝スライド（pptx）の素材

| もの | 置き場 | 投入 |
|---|---|---|
| 歌詞 pptx（讃頌歌 259 番）・交読文 pptx（64 番）・テンプレ一式（`template/背景.pptx`・`背景.json`・`部品/`・`式順/`。`docs/pptx-template.md`） | 中身は KV `samplechurch-files` の `blobs/<指紋>`、今の版の目次は D1 の `index/<名前>.json`（`docs/file-store.md`。ローカルは `data/files/blobs/`・`data/index/`、Git 外） | マスタの「テンプレ」・「讃頌歌・交読文」から。手元の写しから作り直すときは `node scripts/seed-kv.mjs --remote`（中身）と `node scripts/seed-d1.mjs data/index --remote`（目次） |
| 聖書本文（新改訳 2017、BOOKS / VERSES / BOOK_ALIASES） | D1 `samplechurch-bible`（ローカルは `data/bible.sqlite`、Git 外） | `node scripts/import-bible.mjs ../SKY2017.db --remote` |

目次の行に「元のファイル名・更新日・枚数・比率」を持つ。前の版の控えは 14 日で、毎朝 3:00（日本時間）に Worker の定時実行（`wrangler.jsonc` の `triggers.crons`、`worker/index.mjs` の `scheduled`）が片付ける（preview の版では動かない。手で試すには `npx wrangler dev --test-scheduled` で `/__scheduled` を開く）。素材の選び方: 讃頌歌は 16:9 のうち更新日が最新の 1 本（16:9 が無い 9 番だけ 4:3）、交読文は番号ごとに最新。旧形式 .ppt は WPS（Windows 側、PowerShell から COM 自動操作）で pptx に変換した。

API: `GET api/files/hymns/48.pptx`（`readings/3.pptx`、`template/部品/賛美.pptx`（URL では日本語をエンコード））、`GET api/files/blobs/<指紋>`（版の中身そのもの。写し・同期用）、`GET api/templates`（テンプレ一式の一覧と最後の片付け）、`GET api/bible?ref=マタイ4:1-4`（「詩篇114篇」「ルカ8:5-9:2」「Ⅰコリント13:4-7」「１ヨハネ４：７」も可）。
歌詞・聖書本文は著作物。ほかの API と同じく、受付（Access）の証明が無ければ 403（API の門番。下の「Access」）。

## 担当者ページ（pptx 担当者）

`https://samplechurch-slides.example.workers.dev/input-shuho/slides/`。pptx 担当者が、スライドの作成・讃頌歌と交読文のマスタと pptx・ファイルの差し替え・保存済みの週の PDF の表示をする。
**週データ（週報に印刷される内容）は書けない。** 別の Worker（`samplechurch-slides`、`slides/`）で、データは持たず、内線（Service Binding）で週報 Worker の窓口 `SlidesWindow` に頼む。
窓口が通す仕事は `src/lib/slides-window.mjs` の許可の一覧だけ。仕組みは `docs/ARCHITECTURE.md` §20、判断の経緯は `docs/slides-role.md`。

```bash
npm run deploy:slides         # 担当者用 Worker を手で配置（ふだんは main への push で週報 Worker と一緒に配置される）
npm run preview:slides        # 担当者用 Worker のプレビュー版を手で出す（ふだんは preview への push で自動）
npm run dev:slides            # 担当者用 Worker ＋ 週報 Worker を手元で。担当者用は受付の証明が要るので、手元では API が 403 になる
```

- 担当者を足す・外す: Zero Trust のポリシー `shuho-slides` のメール一覧を直す（下の「Access」）。担当者に Cloudflare のアカウントは要らない。
- 担当者用のプレビュー版は、内線で**本番の**週報 Worker の窓口につながる。窓口・API の変更は手元か、牧師の画面のプレビューで確かめる。
- 担当者の書き込みは変更の記録（`api/changes`）に `via: "slides"` で残る（`docs/ARCHITECTURE.md` §2.6）。

## 礼拝スライド（pptx）の生成

入力画面の「スライド」タブ → 「スライドを作ってダウンロード」。**ブラウザの中で** テンプレ一式・歌詞・交読文（`api/files/…`）と聖句（`api/bible`）を集めて pptx を組み立てる（`src/lib/slides/` + JSZip。Worker の無料枠は CPU 10ms/リクエストなので、サーバー側では組まない）。
**仕組みとテンプレの約束は `docs/pptx-template.md`**（背景スライド＋部品＋礼拝ごとの式順。目印 `{{…}}`。背景色・文字色は `template/背景.json`）。テンプレはマスタの「テンプレ」で直す（ARCHITECTURE.md §14.9）。
説教中の引用聖句は同じタブに 1 行 1 箇所で入れる（週データの `slides.sermon_refs`）。準備賛美の番号は、作る直前に同じエリアの欄に入れる（保存しない。空なら題を空欄で残す。ARCHITECTURE.md §18）。

CLI（検証用）: `node scripts/make-slides.mjs <worship|afternoon|wednesday|other> data/weeks/2026-10-18.json [out/….pptx] [--prep 101]`（テンプレ一式は `data/files/template/` から読む。`--prep` は準備賛美の番号）。

## コマンドラインで実行（開発者向け）

```bash
npm install
npx playwright install chromium
# sudo が使えない環境では、不足ライブラリを .local-libs に展開して LD_LIBRARY_PATH で渡す
#   apt-get download libnspr4 libnss3 libasound2t64 && dpkg-deb -x ... .local-libs
export LD_LIBRARY_PATH=$PWD/.local-libs/usr/lib/x86_64-linux-gnu
node scripts/render-pdf.mjs data/weeks/2026-07-19.json          # → out/2026-07-19.pdf と out/2026-07-19.html（IPA P明朝）
node scripts/render-pdf.mjs data/examples/weeks/2026-07-26.json  # 実データが無くても動く確認用
SHUHO_FONT=biz node scripts/render-pdf.mjs data/weeks/2026-07-19.json   # → out/2026-07-19-biz.pdf（ipaex で等幅の IPAex明朝）
```

検証（Python venv に pymupdf, pillow）：

```bash
python scripts/verify-text.py ../週報20260719.pdf out/2026-07-19.pdf
python scripts/compare.py out/2026-07-19.pdf ../週報20260719.pdf out 110
```

## 縮小ルール（fit-policy）

`data-fit="役割名"` を持つ要素に対し、描画後に溢れを実測し、`fit-policy.json` の手順を上から順に適用する。
`scale:0.9` は文字幅倍率（Word の w:w 相当）、`font:9pt` は文字サイズ、`line-height:` は行送り、`wrap`（`wrap:inherit`）は倍率を戻して折り返す。
処理は文書の逆順（子孫→祖先）。次週奉仕予定は説教題が折り返して（`nextweek_title`）枠に収まらなくなったら、枠全体の行送りを詰める（`nextweek_body`）。
最後まで適用しても溢れる場合は赤枠（`.overflow-mark`）を付け、PDF 生成時に `OVERFLOW:` として報告する。

罫線は `border` ではなく `box-shadow`（inset 0.5pt）で引いている。Chromium は 1px 未満の border を 1px（0.26mm）に丸めるが、原本の罫線は全部 0.5pt（0.18mm）。

## プレビューと PDF

プレビューも保存も**サーバーで作った PDF**（本番は Cloudflare Browser Rendering、ローカルは Playwright）。表示は PDF.js（`vendor/pdfjs/`、自前配置）で
各ページを canvas に描く（iPad の Safari は iframe の PDF を 1 ページしか描かず、Android は inline 表示できないため）。

**PDF の写し（KV）**: 描く側に渡す JSON をその週に必要な分だけに絞り（`renderData`: 週＋使う番号の曲名・交読文＋自教会の牧師＋祈り課題＋教会情報＋据え置き文＋設定・縮小規則）、
指紋 `sha256(その JSON をキー順固定で文字列化 | フォント | テンプレ版 | エンジン/Chromium 版)` を KV のキー `pdf/<指紋>` にする。
同じ入力なら生成せず写しを返す（応答 `x-pdf-cache: hit`）。プレビューは 1 日、保存で 90 日。保存した週には `meta/pdf/<日付>.json` にしおり。
tmp/正式の旗は持たない（同じ元から同じ指紋になる、という性質だけで動く）。テンプレ版は build-assets が `shuho-assets/template/version.txt` に書く。
生成のたびに `meta/pdf-log/<日付>.json` に記録し、`api/pdf-stats` で今日の回数・秒数（無料枠 10 分/日の実測）。

**据え置きの文（texts.json）**: 主日礼拝の下の聖句 `cover_verse` と表紙の標語 `motto` はマスタ。週の JSON には入らない（古い週の `verses` は読まない）。
入力画面では印刷位置に鍵付きで置き、「編集」→「保存」でマスタへ（祈り課題と同じ）。

## 据え置きのデータ（聖句・標語・祈り課題・牧師連絡先・住所）

全部の週に効くマスタ（`texts.json`・`prayer-list.json`・`church.json`）。どれも紙面の印刷される位置に置き、ふだんは非活性（`fieldset.rare.lock`）。
「編集」→ その場の「保存」で、週の保存とは別にすぐサーバーに書く（全週に効く）。牧師連絡先は報告の末尾、住所・連絡先・送金先は表紙の下。
教会名・教団名は紙面に印字されない（教会の絵の中）ので画面には出さない。直すときは「ファイルの差し替え」で `church.json`。

## 人物欄の候補

人物欄は `data-filter` で候補を絞る（index.html）。`title:長老`（肩書）、`name:〇〇,△△`（名簿の名前、書いた順）、`flag:cs_teacher`（名簿のフラグ）。
司会・祈祷＝長老、説教＝自教会の牧師フラグ（pastor）、献金・受付案内＝執事、奏楽（主日・午後・水曜）＝奏楽フラグ、JJS の司会・お話し＝CS 教師フラグ。どの欄も「（未定）」と「直接入力…」は常にある。
名簿（people.json）は `{id, name, title, flags}`。肩書 `title` は 1 つ（牧師・長老・執事・兄・姉…）、`flags` は複数可（pastor 自教会の牧師 / organist 奏楽 / cs_teacher CS教師 / prayer_list 祈り課題 / elderly_or_ill ご年配・療養中、表示名は `flag_labels`）。
名簿の編集画面はまだ無い：`data/masters/people.json` を直して `node scripts/seed-d1.mjs data/masters/people.json --remote`。
候補外の人が入っている週を開くと「直接入力」として印刷どおりの文字が出る。献金後の祈祷・祝祷は「説教者に同じ／「説教者」と印字／「司会者」と印字／直接入力」。

## PDF エンジンの切り替え（Cloudflare Browser Rendering ⇄ Render）

本番は Cloudflare（眠らない・部品が少ない）。テスト・リハーサルで大量に作るときは Render Free のコンテナ（上限なし。カード不要）。
どちらも同じビルドの Chromium にする（Cloudflare は `browser.version()` で分かる。2026-09-22 時点 **128.0.6613.137**）。

- Worker の設定: `PDF_ENGINE`（`cloudflare` 既定 / `render`）、`PDF_RENDER_URL`（例 `https://your-pdf-service.onrender.com`）、secret `PDF_RENDER_SECRET`
  ```bash
  npx wrangler secret put PDF_RENDER_SECRET          # Render 側の PDF_SECRET と同じ値
  # wrangler.jsonc の vars に PDF_ENGINE / PDF_RENDER_URL を書く（または --var で一時的に）
  ```
- Render 側: ダッシュボード New → **Blueprint** でこのリポジトリを選ぶ（`render.yaml`）。Web Service（Docker、Free）が 1 つ作られ、`PDF_SECRET` が自動生成される。
  その値を Worker の `PDF_RENDER_SECRET` に入れる。Dockerfile は `render/Dockerfile`、コンテキストはリポジトリのルート
- コンテナの中身: `scripts/pdf-server.mjs`（`POST /pdf` 合言葉必須、`GET /health`）＋ Chrome for Testing（`ARG CHROME=128.0.6613.137`）＋ フォント焼き込み
- 版が違うとき: 入力画面の上部に赤で「本番 Cloudflare は x.y.z。版が違う」と出る（`api/engine`。Cloudflare の版は 1 日 1 回だけ起こして確認）。
  `render/Dockerfile` の `ARG CHROME` を合わせて push すると Render が再ビルドする。Chrome for Testing に同じビルドが無ければ最も近い版
- 眠り: Free は 15 分で眠る。入力画面を開いた時点で `/health` を叩いて起こす（30〜60 秒）。応答が無ければエラー表示（Cloudflare に自動で切り替えない）
- PDF の写しの指紋には Chromium の**版だけ**入れる（エンジン名は入れない）ので、同じビルドなら Cloudflare で作った写しを Render 使用時にも使える

ローカルで PDF サーバだけ動かす: `CHROME_PATH=<Chromium> PDF_SECRET=test node scripts/pdf-server.mjs`（Playwright の Chromium でよい）。
Docker で試す: `docker build -f render/Dockerfile -t shuho-pdf . && docker run -p 10000:10000 -e PDF_SECRET=test shuho-pdf`。

## recovery（障害対策：手元／教会 PC で一式を動かす）

Cloudflare が落ちても、インターネット無しで週報 PDF を作れる一式。Docker は使わない（Node ＋ Playwright の Chromium）。

1. 開発者: `git archive -o shuho-code.zip HEAD`（コードだけ。データは入らない）を渡す（または対象 PC で `git clone`）
2. 対象 PC（Node 22 が要る）: 展開したフォルダで `node scripts/make-recovery.mjs [--remote <正本 URL>] [--no-files]`
   → `npm ci`、Chromium をフォルダ内 `browsers/` に取得、正本のデータを `data/` に写す（pull）、`start.bat` / `start.sh` / `RECOVERY.md` を書く
3. 以後は `start.bat` で起動 → `http://localhost:8787/input-shuho/`。ふだんと同じ画面、保存先はフォルダ内、PDF はその PC の Chromium
4. 復旧後は「同期」タブの「送る」で、手元で作った週を正本へ。正本が正、recovery は写し
5. 年に 1 回は実際に起動して PDF を出す（試していない逃げ道は無いのと同じ）。コードを更新したら 1〜2 をやり直す

Linux で Chromium の依存ライブラリが無いときは `sudo npx playwright install-deps chromium`（sudo が無ければ `.local-libs` の手順）。

## Access（受付）

サイト（`samplechurch`）・入力画面（`samplechurch-shuho`）・担当者ページ（`samplechurch-slides`）の Worker に Cloudflare Access を掛けている。
Worker 単位でしか掛けられない（パスで分けるにはカードが要る）ので、**人はログイン、機械はサービストークン**で分け、役割は Worker を分けて分ける。
設定は Workers & Pages → Worker →「Access」タブ、名簿の中身は Zero Trust の「ポリシー」画面（`/one/access-controls/policies`）。どちらもカード不要。

- 人（メール一覧＋One-time PIN。相手は Cloudflare アカウント不要）:
  週報 `samplechurch-shuho` は `shuho-editors`（牧師）と `Cloudflare account members`（開発者）、担当者用 `samplechurch-slides` は `shuho-slides`（担当者と牧師）、サイト `samplechurch` は `rehearsal-viewers`。
  **名簿を他の受付と共用しない**（名簿に「Everyone」などを書くと、門番も防げない）
- 機械: サービストークン `shuho-server-jobs` ＋ ポリシー `shuho-server-jobs-auth`（アクション **サービス認証**）
  - PDF エンジン: Worker が `CF-Access-Client-Id/Secret` を Chromium の追加ヘッダに入れる（Cloudflare は `page.setExtraHTTPHeaders`、
    Render へは `x-page-headers` で渡して同じことをする）。これで紙面の CSS・JS・フォント（`/shuho-assets/`）を取りに行ける
  - サイトのビルド: `index.astro` が同じヘッダを付けて `api/public/current` を読む
- 設定: `samplechurch-shuho` のランタイム変数に `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`（シークレット）、
  `samplechurch` の**ビルド**変数にも同じ 2 つ（シークレット）
- **API の門番**（2026-10-23）: 週報 Worker のコードも、API の前で受付の証明（`Cf-Access-Jwt-Assertion`）を確かめ、無ければ 403。
  受付を外しても「誰でも入れる」にならず「誰も入れない」で止まる。人でも機械（サービストークン）でも、この受付の正しい証明なら通す。
  例外は `api/public/` の GET と手元（localhost）。確かめる値は `wrangler.jsonc` の `ACCESS_TEAM_DOMAIN`・`ACCESS_AUD`。
  **受付を作り直すと AUD が変わり、直すまで API は全部 403**（`docs/ARCHITECTURE.md` §6）
- 担当者用 Worker も受付の証明を自分で確かめ、**人（メール）の証明が無ければ 403**（`slides/worker.mjs`）。AUD は担当者用の受付のもの（`slides/wrangler.jsonc`。週報とは違う）
- 本番（教会アカウント）でも Worker 単位の Access を使う予定（カードなしで使える。`docs/slides-role.md` §8・§9）。ホームページは公開なので受付なし

### 私（Claude）からリハーサル環境を見る

Access を掛けた結果、開発中の確認（保存済みデータ、エンジンの版、反映の結果）が手元からできなくなった。
サービストークン `claude-dev` で入口を作る。合言葉は **root 所有のファイルに置き、開発者アカウント（＝AI の実行権限）からは読めない**ようにする。
「規律で守る」のではなく「読む経路が存在しない」状態にするのが狙い。

```
/etc/shuho/access.env        合言葉                 root:root 600   ← 作業ユーザーからは読めない
/usr/local/bin/shuho-access  入口（GET のみ）        root:root 755   ← 実行はできるが改造できない
/etc/sudoers.d/shuho-access  この 1 本だけ NOPASSWD  root:root 440
/usr/local/bin/shuho-guard   PreToolUse フック       root:root 755   ← 触れようとした時点で止める
../.claude/settings.json    フックの登録            root:<user> 640
```

原本は `ops/shuho-access` と `ops/shuho-guard`（Git 管理）。設置だけ root で行う。
`shuho-access` は root で動くため、引数は「/ で始まるパス 1 つ」に限定し `--get` で GET に固定している（`-o` で root としてファイルを壊されないように）。
`shuho-guard` は禁止語だけを見て止める。正規の入口を「許可」として列挙しない（例外を書くとそこが抜け道になる）。
ただし合言葉を隔離した時点で `shuho-guard` の値打ちはほとんど無い（読む経路が既に存在しないため）。任意。

合言葉を隠しても、その先の実データが読めては意味が薄い。そこで `shuho-access` は**取れるパスも絞る**:
既定で通すのは `engine` / `pdf-stats` / `site-builds` / `sync/manifest`（本文を含まない）/ `public/current` と `--site` 配下だけ。
名簿・出席・献金額を含む `bootstrap` / `week/*` / `export` / `files/*` / `sync/object/*` は既定で拒否する。
一時的に開けるときは運用者が `sudo touch /etc/shuho/allow-all`（終わったら `sudo rm`）。sudo は環境変数を引き継がないので呼ぶ側からは開けられない。

使い方:

```
npm run see -- /input-shuho/api/engine            # PDF エンジンと版（Cloudflare と Render の一致）
npm run see -- /input-shuho/api/sync/manifest     # 正本の一覧（指紋・更新時刻）
npm run see -- /input-shuho/api/public/current    # サイトに出ている礼拝案内
npm run see -- --site /                           # サイト側の HTML
```

リハーサルが終わったら Zero Trust で `claude-dev` を削除する（他の合言葉に影響しない）。

## 同期（正本 ＝ 本番の D1・KV、手元 ＝ data/）

- Worker: `GET api/sync/manifest`（全 JSON の指紋・更新時刻、全ファイルの中身 `blobs/` の付箋 size/sha256）、`GET/PUT api/sync/object/<key>`（JSON 1 件。PUT は置換前を `history/<key>/<時刻>` に残す）。
  ファイルの中身は `api/files/blobs/<指紋>`（名前が指紋なので、同じ名前なら同じ中身）。今の版の目次（`index/…`）は JSON と一緒に写る（送ることはできない）
- 手元（開発サーバ／recovery）だけの機能: 「同期」タブ（`api/sync/status | pull | push` は dev-server にある）。正本の URL は `data/remote.json` の `url` か `SHUHO_REMOTE`。
  「同期状態を確認」→ 一致／違う／正本にだけ／手元にだけ を表示 → 「取り込む」（正本→手元、上書き）／「送る」（手元→正本、JSON のみ）。手元にしかないものは消さない
- CLI: `node scripts/pull.mjs [<正本の URL>] [--files]` — 全 JSON（と --files でファイルの中身 約 40MB）を data/ に写す。wrangler 不要。`data/PULLED_AT` に時刻
- 聖書 D1 は同期の対象外（変わらない。`import-bible.mjs` の例外作業）

## ファイルの差し替え（マスタ）

歌詞・交読文の pptx（マスタの「讃頌歌・交読文」）、テンプレ一式（マスタの「テンプレ」）、名簿などの JSON（「ファイルの差し替え」）を、画面から正本に置き換える。
- pptx: ブラウザ側で zip として開き、`sldSz` から比率、枚数、SHA-256 を計算して付箋（`x-file-meta`、URL エンコード）で送る（Worker の CPU 10ms を避ける）。
  `PUT api/files/<key>` が中身を KV の `blobs/<指紋>` に置き、D1 の目次の行（元のファイル名、歌詞・交読文は枚数・比率も）を書く。すぐ反映し、前の行は `history/` に残る（14 日）
- JSON: `PUT api/sync/object/<key>`。形を検査（名簿・曲名・交読文の題・教会情報・祈り課題・据え置き文・週）、置換前は `history/` へ
- 置換先はファイル名から自動判定（`123….pptx` → `hymns/123.pptx`、`people.json` → `masters/people.json`）し、人が確認して確定。削除は無い（開発者作業）

## サイトへの反映（トップページの礼拝案内）

ヘッダの「サイトに反映」→ `POST api/publish`（保存済みの週だけ。未保存なら先に保存）→ `public/current.json` を D1 に置く
（date, date_ja, time, presider, preacher, scripture, sermon_title, published_at）→ サイトの再ビルドを起こす。
- `GET api/public/current` は誰でも読める（CORS `*`、キャッシュ 5 分）。ログインを有効にしても `publicPaths` で開いたまま
- サイト（`samplechurch-website`）の `src/pages/index.astro` が**ビルド時に**この JSON を取って HTML に焼き込む。取れなければ `src/data/current-fallback.json`。
  サイトのリポジトリにコミットは発生しない（ビルドだけ走る）。日曜を過ぎてもそのまま。午後・水曜は出さない
- 再ビルドの起こし方: Workers Builds には Deploy Hook が無いので、**Workers Builds API の「Start build」**を叩く
  `POST https://api.cloudflare.com/client/v4/accounts/<account_id>/builds/triggers/<trigger_uuid>/builds`（Bearer: API トークン、権限 Workers Builds Configuration: Edit）。
  Worker の設定: secret `SITE_DEPLOY_TOKEN`（**ユーザー** API トークン。権限「Workers Builds 構成: 編集」1 つ。アカウント API トークンは
  この API が受け付けない＝「Invalid token」になる。2026-09-22 確認）と var `SITE_BUILD_WORKER`（サイト Worker の **tag**、名前ではない）。
  Worker が tag からビルドトリガーを探して Start build を叩く。tag の取り方:
  `curl -H "Authorization: Bearer <wrangler の OAuth token>" https://api.cloudflare.com/client/v4/accounts/<account_id>/workers/scripts | jq '.result[] | {id, tag}'`
  （`wrangler` でログインした PC で。~/.config/.wrangler/config/default.toml の oauth_token）。
  教会アカウントへ移すとき: 管理者ユーザーがトークンを作り直し、サイト Worker の tag を入れ直す。担当者が代われば同じ手順で作り直す。
  代替: `SITE_DEPLOY_HOOK`（URL）があればそこへ POST（Pages の Deploy Hook 形式）。未設定なら JSON を置くだけ（次の push のビルドで反映）

## 聖書箇所の入力

招詞・聖書朗読・聖書（次週・JJS も）は文字入力ではなく、書名を一覧から選び（打って絞り込める）、章・節を選ぶ。
値は従来どおり文字列（`マタイ28:16-20` / `詩篇90篇` / `エステル5:1-8:17`）で保存されるので、紙面・スライド側は変わらない。節の初期値は空白（未選択）で、未選択は `マタイ28:`、章全体は「章全体」を選ぶと `マタイ28章`（ARCHITECTURE.md §17）。
書名の一覧・章数・節数は `api/bible/books`（D1 samplechurch-bible の BOOKS/VERSES から作る）。略称が無い書は正式名（ヨシュア記・レビ記）。
ページ `(2017新約p.64)` は新約/旧約の二択＋数字だけ。書名を選ぶと新約/旧約が合う。

## 式順の編集

主日礼拝・午後礼拝・水曜祈祷会とも、標準の式順は `config.json`。入力画面の「式の編集」で足す・並べ替える・外すと、その週の
`<section>.program` に式順が固定され（以後この週はそれが正）、「標準の式順に戻す」で消える。午後礼拝のワーシップ曲は入れた曲数ぶんの行だけ印刷する
（休みの週は骨組みとして `worship_song_slots` 行の空行）。
