# Cloudflare の設定を、ゼロから作り直す手順

2026-10-29 作成。今のリハーサル環境（個人アカウント）の設定を Cloudflare の API で読み出し（読み取り専用トークン）、それを作り直す順番に並べた。教会のアカウントへ移すときの手順書を兼ねる。

- 設定の**意味**（なぜそうしたか）は `docs/ARCHITECTURE.md`（§6 認証、§9 設定値、§20 担当者用 Worker）と `docs/slides-role.md`。この文書は**手順と順番**だけを書く。
- 名前は今のリハーサル環境のもの（`samplechurch-shuho` など）。移すときは同じ名前で作るのがいちばん楽（コードと設定に名前が書いてあるため）。
- トークン・シークレットの**値**は書かない（作った人が控えておく前提）。
- 【未確認】と書いた所は、今のアカウントでは確かめられていないこと。教会のアカウントで作るときに確かめて、この文書を直す。

## 0. 全体の形と、作る順番

```
GitHub（samplechurch-shuho・samplechurch-website）
   │ Workers Builds（push で配置）
   ▼
Worker samplechurch-shuho ── D1 samplechurch-shuho / D1 samplechurch-bible / KV samplechurch-files / Browser Rendering
   ▲ Service Binding（SlidesWindow）          └─ PDF は Render のコンテナ（samplechurch-shuho-pdf）にも頼める
Worker samplechurch-slides
Worker samplechurch（サイト。ビルドのときに週報の api/public/current を読む）
   全部の手前に Cloudflare Access（Worker 単位）
```

順番が大事な所が 3 つある。

1. **Worker は先に一度配置する**。Access は「配置済みの Worker」の設定画面から付けるので、Worker が無いと付けられない。
2. **週報の Worker を、担当者用より先に配置する**。担当者用の Service Binding は、週報 Worker の名前付きエントリーポイント `SlidesWindow` を指すので、相手が無いと配置に失敗する。
3. **AUD は Access を付けた後にしか分からない**。それを `wrangler.jsonc` に書いて配置し直すまで、API は全部 403 になる（門番は「誰も入れない」側に倒れる作り。§6）。牧師に触ってもらうのは、6 章まで終わってから。

| 章 | すること | 主な場所 |
|---|---|---|
| 1 | アカウントと手元の道具 | Cloudflare・GitHub・Render |
| 2 | D1・KV を作る | `wrangler` |
| 3 | PDF エンジン（Render） | Render の Blueprint |
| 4 | Worker を配置し、Workers Builds をつなぐ | ダッシュボード＋API |
| 5 | Zero Trust と Access | Zero Trust のダッシュボード |
| 6 | AUD・シークレットを入れて配置し直す | `wrangler.jsonc`・`wrangler secret` |
| 7 | サイトの Worker | `samplechurch-website` |
| 8 | データを入れる（移すとき） | `wrangler d1`・`scripts/` |
| 9 | 確かめる | ブラウザ・`curl` |
| 10 | 開発用の権限（任意） | API トークン・`ops/` |

## 1. アカウントと手元の道具

- **Cloudflare**（無料プラン）・**GitHub**（2 つのリポジトリ）・**Render**（Free）。**どれにもカードを登録しない**（`docs/ARCHITECTURE.md` §10 の 1）。
- 手元: Node.js（22 以上）、このリポジトリを clone して `npm ci`。`wrangler` は `npx wrangler` で使う（開発用の依存に入っている）。
- `npx wrangler login`（ブラウザで許可）。複数のアカウントに入れる人は、`wrangler.jsonc` に `account_id` が無いので、操作のたびに聞かれるか、`CLOUDFLARE_ACCOUNT_ID` で指定する。

カードが要る機能（使わない）: R2、Workers Paid、Access の「1 つの Worker の中をパスで分けて保護する」設定。

## 2. D1・KV を作る

```bash
npx wrangler d1 create samplechurch-shuho        # 週データ・マスタ・記録・ファイルの目次（表 objects 1 枚）
npx wrangler d1 create samplechurch-bible        # 聖書本文（読み取り専用）
npx wrangler kv namespace create samplechurch-files   # 素材の中身（blobs/<指紋>）と PDF のキャッシュ
```

出てきた ID を `wrangler.jsonc` の `d1_databases[].database_id`（`DATA`・`BIBLE`）と `kv_namespaces[].id`（`FILES`）に書く。担当者用（`slides/wrangler.jsonc`）は D1・KV を持たないので書かない。

表は 8 章でデータを入れるときにできる（`scripts/seed-d1.mjs` が `CREATE TABLE IF NOT EXISTS objects …` を先に流す。聖書は `scripts/import-bible.mjs` が表ごと作る）。

## 3. PDF エンジン（Render）

1. Render のダッシュボード → New → **Blueprint** → このリポジトリを選ぶ。`render.yaml` のとおり Web Service `samplechurch-shuho-pdf`（Docker、Free、ヘルスチェック `/health`）ができる。
2. 環境変数 `PDF_SECRET` は Blueprint が生成する（`generateValue: true`）。**その値を控える**（6 章で Worker のシークレット `PDF_RENDER_SECRET` に同じ値を入れる）。
3. サービスの URL（`https://your-pdf-service.onrender.com` の形）を `wrangler.jsonc` の `PDF_RENDER_URL` に書く。
4. Chromium の版は `render/Dockerfile` の `ARG CHROME`（今は 128.0.6613.137）。Cloudflare の Browser Rendering の版と合わせる（画面に食い違いが出る。§5）。

Render を使わず Cloudflare だけで動かすなら `PDF_ENGINE` を `cloudflare` にする（無料枠は 1 日 10 分。§5）。

## 4. Worker を配置し、Workers Builds をつなぐ

### 4.1 最初の配置（手元から）

`wrangler.jsonc` の `ACCESS_TEAM_DOMAIN`・`ACCESS_AUD` はまだ空でよい（API は 403 になるが、配置はできる）。`SHUHO_PUBLIC_ORIGIN` には、この Worker の公開アドレス（`https://samplechurch-shuho.<サブドメイン>.workers.dev`）を書く。

```bash
npm run deploy           # 週報 Worker（npm run build → wrangler deploy）。先にこちら
npm run deploy:slides    # 担当者用 Worker（Service Binding で SlidesWindow を指す）
```

`workers.dev` のサブドメインは、アカウントで最初の Worker を作るときに決める（今は `example`）。Worker ごとの `workers.dev` とバージョンのプレビュー URL は既定で有効のままにする。Cron（`0 18 * * *`）と Workers Logs（`observability`）は `wrangler.jsonc` に書いてあるので、配置すれば付く。

### 4.2 Workers Builds（GitHub の push で配置）

今の形: 3 つの Worker とも、トリガーが 2 本ずつ（`docs/ARCHITECTURE.md` §9）。

| Worker | リポジトリ | トリガー | ブランチ | ビルド | 配置 |
|---|---|---|---|---|---|
| `samplechurch-shuho` | `samplechurch-shuho` | 本番 | `main` | `npm run build` | `npx wrangler deploy` |
| | | Deploy non-production branches | `*`（`main` を除く） | `npm run build` | `npx wrangler versions upload` |
| `samplechurch-slides` | `samplechurch-shuho` | 本番 | `main` | `npm run build` | `npx wrangler deploy -c slides/wrangler.jsonc` |
| | | Deploy non-production branches | `*`（`main` を除く） | `npm run build` | `npx wrangler versions upload -c slides/wrangler.jsonc` |
| `samplechurch` | `samplechurch-website` | 本番 | `main` | `npm run build` | `npx wrangler deploy` |
| | | Deploy non-production branches | `*`（`main` を除く） | `npm run build` | `npx wrangler versions upload` |

どれもルートディレクトリは `/`、パスの条件は `*`。ビルドのキャッシュはサイトだけ有効。

手順:

1. Worker の設定 → ビルド → **Git リポジトリを接続**（GitHub の Cloudflare アプリにリポジトリを許可する）。本番ブランチ `main`、ビルドと配置のコマンドは上の表。ビルド用の API トークン（「<アカウント名> build token」）は Cloudflare が作る。
2. Worker の名前と、設定ファイルの `name` を必ずそろえる（違うと別の Worker に配置される）。
3. 新しいプレビューの方式（Worker Previews）は有効のまま、**「プレビューブランチのビルド」はオフ**にする（オンにしても設定が作られない症状があった。`docs/slides-role.md`「プレビューの作り方」）。
4. **本番以外のトリガーを API で足す**（ダッシュボードからは足せない）。権限「Workers CI: 編集」のある API トークンを一時的に作り、終わったら消す。`repo_connection_uuid` は本番のトリガーを `GET` して取る。

```bash
ACC=<アカウント ID>; TAG=<Worker の tag>   # tag は GET /accounts/$ACC/workers/scripts の result[].tag（名前ではない）
curl -s -H "Authorization: Bearer $TOKEN" https://api.cloudflare.com/client/v4/accounts/$ACC/builds/workers/$TAG/triggers   # 本番トリガーの repo_connection.repo_connection_uuid を見る
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  https://api.cloudflare.com/client/v4/accounts/$ACC/builds/triggers -d '{
    "external_script_id": "'$TAG'", "repo_connection_uuid": "<上で見た値>",
    "trigger_name": "Deploy non-production branches",
    "branch_includes": ["*"], "branch_excludes": ["main"], "path_includes": ["*"], "path_excludes": [],
    "build_command": "npm run build", "deploy_command": "npx wrangler versions upload",
    "root_directory": "/", "build_caching_enabled": false }'
```

担当者用は `deploy_command` を `npx wrangler versions upload -c slides/wrangler.jsonc` にする。【未確認】送る項目は、今のトリガーを `GET` した結果の項目名から書いた。足した後に `GET` で同じ形になったかを確かめる。

**ビルドの設定画面で「プレビューブランチのビルド」をオンにしたり、Git の接続を解除したりすると、API で足した 1 本が消える**。触ったら足し直す。

## 5. Zero Trust と Access

### 5.1 Zero Trust の組織（最初の 1 回）

1. ダッシュボードの Zero Trust を開き、**チーム名**を決める。ログインの入口（チームのドメイン）が `https://<チーム名>.cloudflareaccess.com` になる。組織名は「<名前> - Cloudflare Access」の形になる。【未確認】教会のアカウントで、カードの登録なしで組織を作れるか（今のアカウントでは Worker 単位の Access がカードなしで動いている。`docs/slides-role.md` §8・§9）。
2. 設定 → 認証 → ログイン方法で **One-time PIN**（ワンタイム PIN）を有効にする。利用者は Cloudflare のアカウント不要で、メールに届く暗証番号で入る。
3. ログイン方法には「Cloudflare account members」（アカウントのメンバー＝開発者）もある（Worker の Access を使うと出てくる。今のアカウントでは `restrict_to_account_members: true`）。
4. 組織全体のセッションの長さは既定（24 時間）のまま。

### 5.2 サービストークン

Zero Trust → アクセス → サービス認証 → サービストークン → 作成。**Client Secret は作った直後の 1 回しか表示されない**ので、その場で控える（控え損ねたら消して作り直す。他には影響しない）。

| 名前 | 期限 | 使う所 | 値を入れる所 |
|---|---|---|---|
| `shuho-server-jobs` | 無期限 | PDF エンジンが `/shuho-assets/` を読む・サイトのビルドが `api/public/current` を読む | 週報 Worker のシークレット `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`（6 章）、サイトのビルド変数（7 章） |
| `claude-dev` | 無期限 | 開発中に AI が診断用の API を読む（任意。10 章） | この PC の `/etc/shuho/access.env`（root のみ） |

### 5.3 ポリシー（再利用できる形で作る）

Zero Trust → アクセス → ポリシー（`/one/access-controls/policies`）で作る。メールの一覧はここで直す（担当者の入れ替えもここ）。

| ポリシー | アクション | Include | 使う受付 |
|---|---|---|---|
| `Cloudflare account members` | Allow | ログイン方法: Cloudflare account members | 3 つとも |
| `shuho-editors` | Allow | メール（牧師） | 週報 |
| `shuho-slides` | Allow | メール（担当者と牧師） | 担当者用 |
| `rehearsal-viewers` | Allow | メール（リハーサルの確認者） | サイト（リハーサルの間だけ） |
| `shuho-server-jobs-auth` | Service Auth | サービストークン `shuho-server-jobs` | 週報 |
| `claude-dev-auth` | Service Auth | サービストークン `claude-dev` | 3 つとも（任意） |

**人のメール一覧の名簿は受付どうしで使い回さない**。「Everyone」のような誰でも通る条件は書かない（門番も防げない。§6）。

### 5.4 Worker に Access を付ける

Workers & Pages → Worker → **「Access」タブ → アクセスを管理**で有効にする。種類 self-hosted、宛先がその Worker の Access アプリ「<Worker 名> - Cloudflare Workers」ができる（セッション 24 時間、Cookie は HttpOnly。どれも既定のまま）。そこに 5.3 のポリシーを、次の順で付ける（上から評価される）。

| 受付 | ポリシー（評価順） |
|---|---|
| `samplechurch-shuho` | `Cloudflare account members` → `shuho-server-jobs-auth` → `claude-dev-auth` → `shuho-editors` |
| `samplechurch-slides` | `shuho-slides` → `claude-dev-auth` → `Cloudflare account members` |
| `samplechurch`（サイト） | `Cloudflare account members` → `rehearsal-viewers` → `claude-dev-auth` |

本番でサイトを公開するときは、サイトの受付を外す（週報・担当者用は外さない）。

## 6. AUD・シークレットを入れて配置し直す

1. **AUD を見る**: Zero Trust → アクセス → アプリケーション → 「samplechurch-shuho - Cloudflare Workers」→ 概要の「アプリケーション オーディエンス（AUD）タグ」。担当者用も同じように見る（**AUD は受付ごとに違う**）。
2. 書く: `wrangler.jsonc` の `ACCESS_TEAM_DOMAIN`（`<チーム名>.cloudflareaccess.com`、`https://` なし）と `ACCESS_AUD`。`slides/wrangler.jsonc` にも、担当者用の受付の AUD で同じ 2 つ。
3. シークレットを入れる（週報 Worker だけ。担当者用はシークレットを持たない）。

```bash
npx wrangler secret put CF_ACCESS_CLIENT_ID       # shuho-server-jobs の Client ID（末尾の .access まで）
npx wrangler secret put CF_ACCESS_CLIENT_SECRET   # 同じトークンの Client Secret
npx wrangler secret put PDF_RENDER_SECRET         # Render の PDF_SECRET と同じ値（3 章）
npx wrangler secret put SITE_DEPLOY_TOKEN         # 7 章で作る API トークン（サイトへの反映を使うとき）
```

4. 変数: `SITE_BUILD_WORKER` にサイト Worker の **tag**（名前ではない。4.2 の取り方）、`SHUHO_PUBLIC_ORIGIN` に週報 Worker の公開アドレス、`PDF_ENGINE`（`render`）と `PDF_RENDER_URL`。
5. コミットして `main` に push（Workers Builds が配置する）。

**受付を作り直すと AUD が変わり、書き直すまで API は全部 403**（牧師も入れない）。断った理由は返事の `reason` と Workers Logs の `[受付なし]` に出る。

## 7. サイトの Worker（`samplechurch-website`）

- 設定はそのリポジトリの `wrangler.jsonc`（静的アセットだけ。名前 `samplechurch`）。Workers Builds は 4.2 の表のとおり。
- **ビルド変数**（Worker の設定 → ビルド → 変数。本番と本番以外の両方のトリガーに、シークレットとして）: `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`（`shuho-server-jobs` の値）。`src/pages/index.astro` がビルドのときに、このヘッダを付けて週報の `api/public/current` を読む（読めなければ `src/data/current-fallback.json`）。読む先は `SHUHO_API`（ビルド変数。無ければコードに書いた週報の URL）。
- **「サイトに反映」用の API トークン** `SITE_DEPLOY_TOKEN`: **ユーザー** API トークン（マイ プロフィール → API トークン）。権限は「アカウント → Workers Builds 構成: 編集」の 1 つだけ。アカウント API トークンはこの API に受け付けられない（「Invalid token」）。週報 Worker のシークレットに入れる（6 章）。週報 Worker はサイト Worker の tag からトリガーを探し、`POST /accounts/<ID>/builds/triggers/<トリガー>/builds` でビルドを起こし、結果も読む。

## 8. データを入れる（移すとき）

新しく始めるなら見本で足りる。

```bash
node scripts/seed-d1.mjs data/examples --remote        # 表を作り、仮名の見本を入れる
node scripts/import-bible.mjs <聖書の SQLite> --remote # 聖書（D1 samplechurch-bible の表ごと作る）
```

今の環境から移すとき（【未確認】一通りは通していない。移すときに確かめて直す）:

1. **D1**: 古いアカウントで `npx wrangler d1 export samplechurch-shuho --remote --output shuho.sql` → 新しいアカウントで `npx wrangler d1 execute samplechurch-shuho --remote --file shuho.sql`。聖書は `import-bible.mjs` で入れ直す方が早い。
2. **KV の中身**（`blobs/<指紋>`、約 360 個・40MB）: 古いアカウントで `npx wrangler kv key list --binding FILES --remote --prefix blobs/` の名前ごとに `npx wrangler kv key get --binding FILES --remote <名前>` で `data/files/blobs/` に取り、新しいアカウントで `node scripts/seed-kv.mjs --remote`。今の版の目次（`index/…`）は D1 の行なので 1 で一緒に移る。PDF のキャッシュ（`pdf/…`）は移さなくてよい（作り直せる）。
3. `scripts/pull.mjs`（同期 API で写す）は Access の後ろでは使えない（サービストークンのヘッダを付けていない）。

## 9. 確かめる

| 確かめること | やり方 | 期待 |
|---|---|---|
| 受付が効いている | 別のブラウザ（ログインしていない）で `/input-shuho/` | Access のログイン画面 |
| 牧師が入れる | 牧師のメールで PIN | 入力画面が開き、週の一覧が出る（403 なら AUD・チームのドメインを見直す） |
| 担当者が牧師の画面に入れない | 担当者のメールで `samplechurch-shuho` を開く | 名簿に無いので入れない |
| 担当者が週データを書けない | `npm test`（`tests/slides-window.test.mjs`） | 通る |
| 門番が倒れる側 | `npm test`（`tests/access-jwt.test.mjs`。証明が無い・宛先が違う・期限切れを断ること）。本番で受付を外して試さない（受付は Worker 単位なので、本番の版も一緒に開く） | 通る |
| PDF | 入力画面の「プレビュー」 | PDF が出る（Render が寝ていれば 30〜60 秒） |
| サイトへの反映 | 「サイトに反映」 | サイトのビルドが走り、礼拝案内が変わる |
| ビルド | `preview` に push | 本番は変わらず、`preview-<Worker 名>.<サブドメイン>.workers.dev` が新しくなる |
| 定時の片付け | Worker の設定 → トリガー | Cron `0 18 * * *` がある |

## 10. 開発用の権限（任意）

- **調査用の読み取り専用トークン**（ユーザー API トークン）: 障害の調査で Workers Logs と Access のログイン記録を突き合わせるのに使う（`wrangler login` の権限では Workers Logs が読めない）。最低限は「Workers Observability: 読み取り」「Access: 監査ログ 読み取り」「Access: アプリとポリシー 読み取り」。今のトークンは、アカウント・ゾーンの読み取り権限を広く付けてある（書き込みは無い）。値は PC の自分だけが読めるファイルに置き、リポジトリには入れない。
- **AI 用の入口**: サービストークン `claude-dev`＋root 所有の入口 `shuho-access`。設置と仕組みは `docs/OPERATIONS.md`「私（Claude）からリハーサル環境を見る」。移すときは、入口の中の URL（`ops/shuho-access` の `SHUHO`・`SITE`）を新しいアドレスに直して入れ直す。

## 11. 移したあとに直す所（URL・アカウントが変わるもの）

| 場所 | 中身 |
|---|---|
| `wrangler.jsonc` | D1・KV の ID、`ACCESS_TEAM_DOMAIN`・`ACCESS_AUD`、`PDF_RENDER_URL`、`SITE_BUILD_WORKER`、`SHUHO_PUBLIC_ORIGIN` |
| `slides/wrangler.jsonc` | `ACCESS_TEAM_DOMAIN`・`ACCESS_AUD` |
| `worker/index.mjs` | `CF_ACCOUNT_ID` が無いときに使うアカウント ID（2 か所）。変数 `CF_ACCOUNT_ID` を入れるか、コードを直す |
| サイトのリポジトリ | ビルド変数、`SHUHO_API`（または `index.astro` の既定の URL） |
| `ops/shuho-access` | 週報とサイトの URL |
| `data/remote.json` | 同期の相手の URL（手元） |
| 文書 | `docs/ARCHITECTURE.md` §1（環境の表）・§9、この文書の「今は」の値 |

古いアカウントは、新しい方で 9 章が全部通ってから止める（Access のアプリ・サービストークン・API トークンを消し、Worker を消す）。
