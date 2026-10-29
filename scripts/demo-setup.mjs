// clone 直後のデモ一式を手元に入れる（Cloudflare のアカウントは要らない。wrangler dev のローカル D1・KV と data/ に入る）。
//   1. 見本の週を data/weeks/ に写す（npm run dev の週の一覧に出す。すでにある週は上書きしない）
//   2. 見本の素材（data/examples/files/: スライドのテンプレ・歌詞・交読文）を、版を持つ置き場の形（data/files/blobs/ と data/index/）にする
//   3. 見本の名簿・マスタ・週と、素材の目次をローカル D1 に、素材の中身をローカル KV に入れる（scripts/seed-d1.mjs・seed-kv.mjs）
//   4. 口語訳聖書を取ってきて、ローカル D1 と data/bible.sqlite に入れる（scripts/kougo-to-sqlite.mjs・import-bible.mjs。初回だけ約 13MB を取得）
// 使い方: npm run demo   （何度流しても同じ結果になる）
import { readdirSync, statSync, readFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { fsStore, fsFiles } from '../src/lib/store-fs.mjs';
import { createFileStore } from '../src/lib/file-store.mjs';

const root = resolve(import.meta.dirname, '..');
const node = (...args) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
mkdirSync(resolve(root, '.wrangler'), { recursive: true });

// 1. 見本の週
const weeks = resolve(root, 'data/weeks');
mkdirSync(weeks, { recursive: true });
for (const f of readdirSync(resolve(root, 'data/examples/weeks'))) {
  if (!existsSync(resolve(weeks, f))) { copyFileSync(resolve(root, 'data/examples/weeks', f), resolve(weeks, f)); console.log('week', f); }
}

// 2. 素材を版を持つ置き場の形に（目次の行は、画面から差し替えたときと同じ項目。src/lib/api.mjs の files/ の PUT）
const store = fsStore(root);
const fileStore = createFileStore({ store, files: fsFiles(root), writeObject: async (_req, key, text) => { await store.put(key, text); return false; } });
const src = resolve(root, 'data/examples/files');
for (const file of walk(src)) {
  const name = relative(src, file).split('\\').join('/');
  const bytes = new Uint8Array(readFileSync(file));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if ((await fileStore.stat(name))?.sha256 === sha256) continue;
  const row = { sha256, size: bytes.length, uploaded: new Date().toISOString(), source: name.split('/').pop() };
  if (/^(hymns|readings)\/\d+\.pptx$/.test(name)) {
    const zip = await JSZip.loadAsync(bytes);
    const size = (await zip.file('ppt/presentation.xml').async('string')).match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
    Object.assign(row, { modified: row.uploaded.slice(0, 10), slides: Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length, ratio: size ? Math.round(size[1] / size[2] * 100) / 100 : null });
  }
  await fileStore.put(null, name, bytes, row);
  console.log('file', name);
}

// 3. ローカル D1・KV
node('scripts/seed-d1.mjs', 'data/examples');
node('scripts/seed-d1.mjs', 'data/index');
node('scripts/seed-kv.mjs');

// 4. 聖書（口語訳）
if (!existsSync(resolve(root, 'data/kougo.db'))) node('scripts/kougo-to-sqlite.mjs');
node('scripts/import-bible.mjs', 'data/kougo.db');
console.log('\nデモの準備ができました。npm run dev（手元のサーバ）か、npm run dev:worker（wrangler dev。PDF は npm run dev を借りる）で開いてください');
