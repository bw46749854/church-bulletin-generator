// ローカル開発サーバ：/input-shuho/（入力画面）、/input-shuho/api/*（src/lib/api.mjs）、/shuho-assets/（テンプレ・フォント）。
// URL の形は本番の Worker と同じ。保存先はローカル FS（data/）、PDF は Playwright。保存時は out/ に PDF と中間 HTML も書く。
// 使い方: node scripts/dev-server.mjs [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { root, store, config, fitPolicy, readTemplate, renderPdfHtml, buildHtmlFor, closeBrowser, getBrowser } from '../src/lib/render.mjs';
import { createApi } from '../src/lib/api.mjs';
import { fsFiles } from '../src/lib/store-fs.mjs';
import { blobKey } from '../src/lib/file-store.mjs';
import { withAuth } from '../src/lib/auth.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';

const port = Number(process.argv[2] || 8787);
const BASE = '/input-shuho/';
const outDir = resolve(root, 'out');
const staticDirs = { '/input-shuho/vendor/pdfjs/': resolve(root, 'node_modules/pdfjs-dist/build'), '/input-shuho/vendor/': resolve(root, 'node_modules/jszip/dist'), '/input-shuho/lib/': resolve(root, 'src/lib'), '/input-shuho/ui/': resolve(root, 'src/ui'), '/input-shuho/': resolve(root, 'src/admin'), '/shuho-assets/template/': resolve(root, 'src/template'), '/shuho-assets/fonts/': resolve(root, 'src/fonts') };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ttf': 'font/ttf' };

// ログインは既定でなし。GOOGLE_CLIENT_ID / ALLOWED_EMAILS / SESSION_SECRET を環境変数で渡すと本番と同じ動きになる
const files = fsFiles(root);
const api = withAuth(createApi({
  store, config: config(), fit: fitPolicy(), template: async () => readTemplate(), renderPdf: renderPdfHtml,
  actor: () => ({ who: null, via: 'local' }),   // 変更の記録（data/meta/changes/）。手元（開発サーバ・recovery）は誰かを確かめない
  rawPdf: true,   // wrangler dev から Playwright を借りる用（POST /input-shuho/api/_pdf）
  retainWeeks: process.env.RETAIN_WEEKS ? Number(process.env.RETAIN_WEEKS) : undefined,   // 既定は無制限。本番と同じ「新しい方から n 週だけ残す」を試すときに RETAIN_WEEKS=2
  cache: (() => { const m = new Map(); return { get: async (k) => m.get(k) || null, put: async (k, bytes, { metadata }) => { m.set(k, { bytes, metadata }); } }; })(),   // 開発中はメモリだけ
  templateVersion: async () => templateVersionOf(resolve(root, 'src/template'), resolve(root, 'src/fonts')),
  files,   // ファイルの中身は data/files/blobs/、今の版の目次は data/index/（docs/file-store.md）
  bible: existsSync(resolve(root, 'data/bible.sqlite')) ? (() => { const db = new DatabaseSync(resolve(root, 'data/bible.sqlite'), { readOnly: true }); return { all: async (sql, params) => db.prepare(sql).all(...params) }; })() : null,
  afterSave: async ({ week, pdf, data, font }) => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, `${week.date}.pdf`), pdf);
    writeFileSync(resolve(outDir, `${week.date}.html`), buildHtmlFor(data, outDir, { font }));   // 中間 HTML（PDF と同じ紙面をブラウザで開ける）
  },
  afterRename: async (from, to) => { for (const ext of ['pdf', 'html']) { const f = resolve(outDir, `${from}.${ext}`); if (existsSync(f)) renameSync(f, resolve(outDir, `${to}.${ext}`)); } },
}), { clientId: process.env.GOOGLE_CLIENT_ID, allowed: process.env.ALLOWED_EMAILS, secret: process.env.SESSION_SECRET, path: BASE.slice(0, -1), certsUrl: process.env.GOOGLE_CERTS_URL });


// テンプレの版：template/ の全ファイルと fonts/ のファイル名・サイズの指紋（build-assets と同じ計算）
export function templateVersionOf(tplDir, fontDir) {
  const h = createHash('sha256');
  for (const f of readdirSync(tplDir).filter(f => !f.startsWith('.')).sort()) { h.update(f); h.update(readFileSync(resolve(tplDir, f))); }
  for (const f of readdirSync(fontDir).sort()) { h.update(f); h.update(readFileSync(resolve(fontDir, f))); }   // 中身まで見る（build-assets と同じ計算）
  return h.digest('hex').slice(0, 16);
}
// ---------- 同期（正本 = 本番 Worker の D1・KV、手元 = data/）。この開発サーバ／recovery でだけ動く ----------
const remoteUrl = process.env.SHUHO_REMOTE || (existsSync(resolve(root, 'data/remote.json')) ? JSON.parse(readFileSync(resolve(root, 'data/remote.json'), 'utf8')).url : null);
const remoteApi = (p) => remoteUrl.replace(/\/$/, '') + '/input-shuho/api/' + p;
async function syncStatus() {
  const [local, remote] = await Promise.all([api(new Request('http://local/input-shuho/api/sync/manifest'), 'sync/manifest').then(r => r.json()), fetch(remoteApi('sync/manifest')).then(r => { if (!r.ok) throw new Error('正本の一覧が取れません: ' + r.status); return r.json(); })]);
  const diff = (ls, rs) => {
    const L = new Map(ls.map(x => [x.key, x])), R = new Map(rs.map(x => [x.key, x])); const rows = [];
    for (const key of new Set([...L.keys(), ...R.keys()].sort())) {
      const l = L.get(key), r = R.get(key);
      const state = !l ? 'remote-only' : !r ? 'local-only' : (l.sha256 && r.sha256 && l.sha256 === r.sha256) ? 'same' : 'differs';
      rows.push({ key, state, local: l ? { size: l.size, updated_at: l.updated_at } : null, remote: r ? { size: r.size, updated_at: r.updated_at } : null });
    }
    return rows;
  };
  return { remote: remoteUrl, at: remote.at, objects: diff(local.objects, remote.objects), files: diff(local.files, remote.files) };
}
const pullBlob = async (key) => {   // key は blobs/<指紋>
  const r = await fetch(remoteApi('files/' + key)); if (!r.ok) throw new Error(`${key}: ${r.status}`);
  await files.put(key, new Uint8Array(await r.arrayBuffer()));
};
async function syncPull({ objects = [], files: blobs = [] }) {   // 正本 → 手元（上書き。手元にしかないものには触らない）
  const done = [];
  for (const key of objects) {
    const r = await fetch(remoteApi('sync/object/' + key)); if (!r.ok) throw new Error(`${key}: ${r.status}`);
    const text = await r.text();
    if (key.startsWith('index/')) { const b = blobKey(JSON.parse(text).sha256); if (!(await files.get(b))) await pullBlob(b); }   // 目次の行は、指す中身を先に取り込む（行だけ写ると読めない）
    const f = resolve(root, 'data', key); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); done.push(key);
  }
  for (const key of blobs) { await pullBlob(key); done.push(key); }
  writeFileSync(resolve(root, 'data/PULLED_AT'), new Date().toISOString() + '\n');
  return done;
}
async function syncPush(keys) {   // 手元 → 正本（JSON だけ。置換前は正本側の history/ に残る）
  const done = [];
  for (const key of keys) {
    const f = resolve(root, 'data', key); if (!existsSync(f)) throw new Error(`${key}: 手元にありません`);
    const r = await fetch(remoteApi('sync/object/' + key), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: readFileSync(f, 'utf8') });
    if (!r.ok) throw new Error(`${key}: ${(await r.text()).slice(0, 200)}`);
    done.push(key);
  }
  return done;
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const reply = (code, body, type = 'text/plain', headers = {}) => { res.writeHead(code, { 'content-type': type, ...headers }); res.end(body); };
  try {
    if (p === '/' || p === '/admin' || p === '/admin/' || p === BASE.slice(0, -1)) return reply(302, '', 'text/plain', { location: BASE });
    if (p.startsWith(BASE + 'api/sync/status') || p.startsWith(BASE + 'api/sync/pull') || p.startsWith(BASE + 'api/sync/push')) {   // 同期（手元にだけある機能）
      if (!remoteUrl) return reply(404, JSON.stringify({ error: '正本の URL が未設定（data/remote.json か SHUHO_REMOTE）' }), 'application/json; charset=utf-8');
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      const out = p.endsWith('status') ? await syncStatus() : p.endsWith('pull') ? { pulled: await syncPull(body) } : { pushed: await syncPush(body.keys || []) };
      return reply(200, JSON.stringify(out), 'application/json; charset=utf-8');
    }
    if (p.startsWith(BASE + 'api/')) {
      const rel = p.slice(BASE.length);
      const chunks = []; for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const response = await api(request, rel.slice(4));
      if (rel === 'api/bootstrap' && response.ok) {   // 手元だけの機能（同期タブ）を知らせる
        const j = await response.json(); j.sync = !!remoteUrl;
        return reply(200, JSON.stringify(j), 'application/json; charset=utf-8');
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    for (const [prefix, dir] of Object.entries(staticDirs)) {
      if (!p.startsWith(prefix)) continue;
      const file = resolve(dir, p.slice(prefix.length) || 'index.html');
      if (!file.startsWith(dir) || !existsSync(file)) return reply(404, 'not found');
      return reply(200, readFileSync(file), mime[extname(file)] || 'application/octet-stream');
    }
    return reply(404, 'not found');
  } catch (e) {
    console.error(new Date().toISOString(), req.method, p, '\n', e);
    return reply(500, JSON.stringify({ error: String(e.message || e) }), 'application/json; charset=utf-8');
  }
});
server.listen(port, async () => {
  console.log(`週報 入力画面: http://localhost:${port}${BASE}`);
  try { const b = await getBrowser(); console.log(`PDF エンジン: Chromium ${b.version()} 起動OK`); }
  catch (e) { console.error('PDF エンジンの起動に失敗:', e.message); }
});
process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
