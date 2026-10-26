// Cloudflare Worker：/input-shuho/（入力画面＝静的アセット）と /input-shuho/api/*（src/lib/api.mjs）。
// 保存先は D1、PDF は Browser Rendering。API の前で受付（Access）の証明を確かめる（src/lib/auth.mjs の accessGate）。
// データは api/ からだけ渡す。静的アセットにはデータを入れない（docs/ARCHITECTURE.md §10 の 7）
import { WorkerEntrypoint } from 'cloudflare:workers';
import { createApi } from '../src/lib/api.mjs';
import { d1Store } from '../src/lib/store-d1.mjs';
import { createFileStore } from '../src/lib/file-store.mjs';
import { renderPdfHtml, renderHealth, cloudflareVersion } from './pdf.mjs';
import { withAuth, accessGate } from '../src/lib/auth.mjs';
import { d1Bible } from '../src/lib/bible.mjs';
import { handleSlidesWindow, ACTOR_HEADER } from '../src/lib/slides-window.mjs';
import config from '../data/config.json';
import fit from '../src/template/fit-policy.json';

const BASE = '/input-shuho/';
const ASSETS = '/shuho-assets/';   // テンプレ・フォント（データは入っていない。PDF エンジンが読む）
const PUBLIC = ['public/'];        // 受付の証明なしで読める API（サイトのビルドが読む public/current。公開してよい情報）
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// 担当者用の窓口（docs/slides-role.md §4）。担当者用 Worker（samplechurch-slides）から内線（Service Binding）でだけ呼ばれ、
// 受付（Access）は通らない。通す仕事は src/lib/slides-window.mjs の許可の一覧だけ（週データを書く仕事は無い）
export class SlidesWindow extends WorkerEntrypoint {
  async fetch(request) {
    try {
      return await handleSlidesWindow(request, (req, path) => makeApi(this.env, req, (r) => ({ who: r.headers.get(ACTOR_HEADER), via: 'slides' }))(req, path), this.env.SHUHO_PUBLIC_ORIGIN);
    } catch (e) {
      console.error('SlidesWindow', request.method, new URL(request.url).pathname, e);
      return json({ error: String(e.message || e) }, 500);
    }
  }
}

/** ファイルの中身の置き場（KV。キーは blobs/<指紋>、今の版の目次は D1。docs/file-store.md）。API と毎朝の片付けで共用 */
function kvFiles(env) {
  return {
    get: async (key) => { const v = await env.FILES.get(key, 'arrayBuffer'); return v ? new Uint8Array(v) : null; },
    put: (key, bytes, metadata) => env.FILES.put(key, bytes, { metadata }),
    delete: (key) => env.FILES.delete(key),
    list: async () => {   // 付箋（size, sha256）だけ集める。本体は読まない（Worker の CPU 10ms）。同期の比較に使う
      const out = [];
      let cursor; do { const r = await env.FILES.list({ prefix: 'blobs/', cursor }); for (const k of r.keys) out.push({ key: k.name, size: k.metadata?.size ?? null, sha256: k.metadata?.sha256 ?? null }); cursor = r.list_complete ? null : r.cursor; } while (cursor);
      return out;
    },
  };
}

/**
 * 週報の API（src/lib/api.mjs）。牧師の画面の入口（下の fetch）と担当者用の窓口（SlidesWindow）で同じものを使う。
 * actor: 誰が・どの入口から（変更の記録。docs/slides-role.md §7）
 */
function makeApi(env, request, actor) {
  return createApi({
    actor,
    store: d1Store(env.DATA),
    config, fit,
    template: async () => {
      const r = await env.ASSETS.fetch(new Request(new URL(ASSETS + 'template/', request.url)));
      if (!r.ok) throw new Error('テンプレートが読めません: ' + r.status);
      return r.text();
    },
    renderPdf: (html) => renderPdfHtml(env, html),
    engineInfo: env.PDF_ENGINE === 'render' ? () => renderHealth(env) : null,   // Render のときは /health で版を聞く（Cloudflare は生成結果から学ぶ）
    productionVersion: () => cloudflareVersion(env),                            // 本番（Cloudflare）の Chromium の版。Render と比べるため
    // サイトの再ビルドを起こす。SITE_DEPLOY_TOKEN（API トークン: Workers Builds Configuration: Edit）があれば、
    // Workers Builds API でサイト Worker（SITE_BUILD_WORKER、既定 samplechurch）のビルドトリガーを探して「Start build」。
    // SITE_DEPLOY_HOOK（URL）だけの設定なら、そこへ POST（Pages の Deploy Hook 形式）
    deployHook: (env.SITE_DEPLOY_TOKEN || env.SITE_DEPLOY_HOOK) ? async () => {
      const auth = env.SITE_DEPLOY_TOKEN ? { authorization: `Bearer ${env.SITE_DEPLOY_TOKEN}`, 'content-type': 'application/json' } : {};
      let url = env.SITE_DEPLOY_HOOK;
      if (env.SITE_DEPLOY_TOKEN && !url) {
        if (!env.SITE_BUILD_WORKER) return { ok: false, status: 0, body: 'SITE_BUILD_WORKER（サイト Worker の tag）が未設定です' };
        const account = env.CF_ACCOUNT_ID || '<your-account-id>';
        const lr = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/builds/workers/${env.SITE_BUILD_WORKER}/triggers`, { headers: auth });   // SITE_BUILD_WORKER は Worker の tag（名前ではない）
        const lj = await lr.json().catch(() => ({}));
        // トリガーは 2 つある: 本番ブランチ用（deploy_command = wrangler deploy＝公開する）と、それ以外用（versions upload＝版を作るだけ）。
        // 公開する方を選ぶ（先頭を取ると版だけ作って終わることがある）
        const list = lj.result || [];
        const branch = env.SITE_BUILD_BRANCH || 'main';
        const pick = list.find(t => /wrangler\s+deploy/.test(t.deploy_command || '') && (t.branch_includes || []).some(b2 => b2 === branch || b2 === '*'))
                  || list.find(t => /wrangler\s+deploy/.test(t.deploy_command || ''))
                  || list[0];
        const trig = pick?.trigger_uuid || pick?.uuid || pick?.id;
        if (!lr.ok || !trig) {
          let hint = '';
          if (lr.status === 401 || lr.status === 403) {   // トークン自体が生きているか（アカウント API トークンの検査口）
            const v = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`, { headers: auth }).then(r => r.json()).catch(() => ({}));
            hint = ` / verify: ${v.result?.status || JSON.stringify(v.errors || v).slice(0, 120)}`;
          }
          return { ok: false, status: lr.status, body: 'ビルドトリガーが見つかりません: ' + JSON.stringify(lj.errors || lj).slice(0, 160) + hint };
        }
        url = `https://api.cloudflare.com/client/v4/accounts/${account}/builds/triggers/${trig}/builds`;
      }
      const r = await fetch(url, { method: 'POST', headers: auth, body: env.SITE_DEPLOY_TOKEN ? JSON.stringify({ branch: env.SITE_BUILD_BRANCH || 'main' }) : undefined });   // Start build は branch か commit_hash が必須
      return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 200) };
    } : null,
    // サイトのビルド状況（画面の「サイトに反映」の後に見る）。SITE_DEPLOY_TOKEN の権限で読む
    siteBuilds: env.SITE_DEPLOY_TOKEN && env.SITE_BUILD_WORKER ? async () => {
      const account = env.CF_ACCOUNT_ID || '<your-account-id>';
      const auth = { authorization: `Bearer ${env.SITE_DEPLOY_TOKEN}` };
      const tr = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/builds/workers/${env.SITE_BUILD_WORKER}/triggers`, { headers: auth })).json();

      const bs = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/builds/workers/${env.SITE_BUILD_WORKER}/builds?per_page=5`, { headers: auth })).json();   // Worker 単位で一覧する（トリガー配下の一覧は無い）
      return { triggers: (tr.result || []).map(t => ({ uuid: t.trigger_uuid, name: t.trigger_name, deploy: t.deploy_command, branches: t.branch_includes })),
               builds: (bs.result || []).map(b => ({ created: b.created_on, status: b.status, outcome: b.build_outcome, deploy: b.build_trigger_metadata?.deploy_command, branch: b.build_trigger_metadata?.branch, uuid: b.build_uuid })) };
    } : null,
    renderBase: (req) => new URL(ASSETS + 'template/', req.url).href,   // Browser Rendering から css/js/フォントを取りに来る先＝この Worker（Access の外）
    retainWeeks: Number(env.RETAIN_WEEKS || 2),   // 正本は wrangler.jsonc の vars（いま 5）。2 は設定が抜けたときの予備（少ない側に倒す）
    files: kvFiles(env),
    cache: {   // PDF の写し（KV、指紋がキー、期限付き）
      get: async (key) => { const r = await env.FILES.getWithMetadata(key, 'arrayBuffer'); return r && r.value ? { bytes: new Uint8Array(r.value), metadata: r.metadata || {} } : null; },
      put: (key, bytes, { metadata, ttl }) => env.FILES.put(key, bytes, { metadata, expirationTtl: ttl }),
    },
    templateVersion: async () => {   // build-assets が書く版（テンプレ・縮小規則・フォントの指紋）
      const r = await env.ASSETS.fetch(new Request(new URL(ASSETS + 'template/version.txt', request.url)));
      return r.ok ? (await r.text()).trim() : 'unknown';
    },
    bible: d1Bible(env.BIBLE),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(BASE)) return new Response('not found', { status: 404 });
    const rel = url.pathname.slice(BASE.length);
    if (!rel.startsWith('api/')) return env.ASSETS.fetch(request);   // 通常はアセットが先に返るのでここには来ない
    const path = rel.slice(4);
    try {
      // 受付の証明が無ければ断る（受付を外しても「誰も入れない」で止まる。docs/slides-role.md §6 の 2）。人ならメールを変更の記録に使う
      const gate = await accessGate(request, path, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, publicPaths: PUBLIC });
      if (!gate.ok) return gate.response;
      const api = withAuth(makeApi(env, request, () => ({ who: gate.email, via: 'input-shuho' })), { clientId: env.GOOGLE_CLIENT_ID, allowed: env.ALLOWED_EMAILS, secret: env.SESSION_SECRET, path: BASE.slice(0, -1), publicPaths: PUBLIC });
      return await api(request, path);
    } catch (e) {
      console.error(request.method, url.pathname, e);
      return json({ error: String(e.message || e) }, 500);
    }
  },
  // 毎朝 3:00（日本時間）の片付け（wrangler.jsonc の triggers.crons。docs/file-store.md §3）。14 日より前の控えと、使われなくなった中身を消す。
  // 失敗しても翌朝また同じことをするので、その場ではやり直さない。結果は D1 の meta/cleanup/last.json（管理画面に出す）と Workers Logs
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(createFileStore({ store: d1Store(env.DATA), files: kvFiles(env) }).cleanup()
      .then((r) => console.log('[片付け]', JSON.stringify(r)), (e) => console.error('[片付け] 失敗', e)));
  },
};
