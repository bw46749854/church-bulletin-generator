// KV にファイルの中身（data/files/blobs/<指紋>）を投入する。今の版の目次（data/index/）は D1 の行なので scripts/seed-d1.mjs で入れる（docs/file-store.md）。
// 手元の写しから本番を作り直すとき用。ふだんの差し替えは管理画面（テンプレ・讃頌歌・交読文）から。
// 使い方: node scripts/seed-kv.mjs [--remote]
//   KV にすでにある中身は送らない（名前が指紋なので、あれば同じ中身）。無料の KV は書き込みが 1 日 1,000 回まで
//   --remote が無ければ wrangler dev のローカル KV（.wrangler/state）に入る
import { readdirSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const where = process.argv.includes('--remote') ? '--remote' : '--local';
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'data/files/blobs');
if (!existsSync(dir)) { console.error('data/files/blobs がありません'); process.exit(1); }
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { cwd: root, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'] });
const have = new Set(JSON.parse(wrangler(['kv', 'key', 'list', '--binding', 'FILES', '--prefix', 'blobs/', where]).toString()).map(k => k.name));
mkdirSync(resolve(root, '.wrangler'), { recursive: true });
let chunk = [], size = 0, n = 0, put = 0;
const flush = () => {   // wrangler kv bulk put は JSON の [{key, value, base64, metadata}] を受ける。1 回 5MB ほどに分ける（20MB を 1 回で送ると通信が失敗した。2026-10-25）
  if (!chunk.length) return;
  const tmp = resolve(root, `.wrangler/kv-seed-${n++}.json`); writeFileSync(tmp, JSON.stringify(chunk));
  execFileSync('npx', ['wrangler', 'kv', 'bulk', 'put', tmp, '--binding', 'FILES', where], { cwd: root, stdio: 'inherit' });
  put += chunk.length; chunk = []; size = 0;
};
for (const f of readdirSync(dir).filter(f => /^[0-9a-f]{64}$/.test(f)).sort()) {
  if (have.has('blobs/' + f)) continue;
  const buf = readFileSync(resolve(dir, f)), sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== f) { console.error(`blobs/${f}: 中身の指紋が名前と違うので送りません`); continue; }
  chunk.push({ key: 'blobs/' + f, value: buf.toString('base64'), base64: true, metadata: { size: buf.length, sha256: sha } });   // 付箋: 同期の比較に使う（Worker が本体を読まずに済む）
  size += buf.length; if (size > 5e6) flush();
}
flush();
console.log(`置いた ${put}・すでにあった ${have.size}`);
