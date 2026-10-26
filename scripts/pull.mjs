// 正本（本番 Worker の D1・KV）を手元の data/ に写す（バックアップ・recovery の材料）。wrangler は使わない（Worker の同期 API を読む）。
// 使い方: node scripts/pull.mjs [<正本の URL>] [--files]
//   URL 省略時は data/remote.json の url か SHUHO_REMOTE。--files で歌詞・交読文・テンプレの中身（data/files/blobs/、約 40MB）も。
//   今の版の目次（index/）は JSON と一緒に写る（docs/file-store.md）
//   手元にしかないものは消さない。上書きしたものと、手元にしかないものを表示する
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2); const withFiles = args.includes('--files');
const url = args.find(a => !a.startsWith('--')) || process.env.SHUHO_REMOTE || (existsSync(resolve(root, 'data/remote.json')) ? JSON.parse(readFileSync(resolve(root, 'data/remote.json'), 'utf8')).url : null);
if (!url) { console.error('正本の URL を指定してください（引数 / data/remote.json / SHUHO_REMOTE）'); process.exit(1); }
const api = (p) => url.replace(/\/$/, '') + '/input-shuho/api/' + p;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const manifest = await (await fetch(api('sync/manifest'))).json();
let same = 0, written = 0;
for (const o of manifest.objects) {
  const f = resolve(root, 'data', o.key);
  if (existsSync(f) && sha(readFileSync(f)) === o.sha256) { same++; continue; }
  const r = await fetch(api('sync/object/' + o.key)); if (!r.ok) { console.error('取れません', o.key, r.status); continue; }
  mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, await r.text()); written++; console.log('wrote', o.key);
}
if (withFiles) for (const o of manifest.files) {
  const f = resolve(root, 'data/files', o.key);
  if (existsSync(f) && o.sha256 && sha(readFileSync(f)) === o.sha256) { same++; continue; }
  const r = await fetch(api('files/' + o.key)); if (!r.ok) { console.error('取れません', o.key, r.status); continue; }   // o.key は blobs/<指紋>
  mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, Buffer.from(await r.arrayBuffer())); written++; console.log('wrote files/' + o.key);
}
// 手元にしかないもの（消さない。知らせるだけ）
const remoteKeys = new Set(manifest.objects.map(o => o.key));
const walk = (dir, prefix, out) => { if (!existsSync(dir)) return out; for (const f of readdirSync(dir)) { const p = resolve(dir, f); if (statSync(p).isDirectory()) { if (!['examples', 'files', 'meta', 'history'].includes(f)) walk(p, prefix + f + '/', out); } else if (f.endsWith('.json') && !(prefix === '' && (f === 'config.json' || f === 'remote.json'))) out.push(prefix + f); } return out; };
const localOnly = walk(resolve(root, 'data'), '', []).filter(k => !remoteKeys.has(k));
writeFileSync(resolve(root, 'data/PULLED_AT'), new Date().toISOString() + '\n');
console.log(`一致 ${same}、上書き ${written}${localOnly.length ? `、手元にしかないもの ${localOnly.length}: ${localOnly.join(', ')}` : ''}`);
