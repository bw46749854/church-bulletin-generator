// 一度きり: ファイルの置き場を「名前のまま上書き」から「中身は blobs/<指紋>、今の版の目次は D1 の index/」へ移す（docs/file-store.md §4）。
// 使い方:
//   node scripts/migrate-files.mjs --local [--dry-run]     手元の data/files（hymns/・readings/・template/・manifest.json・history/）→ data/files/blobs/ と data/index/
//   node scripts/migrate-files.mjs --remote [--dry-run]    本番の KV の今のキー → KV の blobs/、D1 の index/・history/index/（wrangler）
//   node scripts/migrate-files.mjs --remote --drop-old     新しいコードを反映して確かめた後、古い名前のキーを消す（--local も同じ）
//   --dry-run は読むだけで、することを表示する。
// 何度流しても同じ結果になる（すでにある中身は置かない。目次の行は、古い置き場の方が新しいときだけ書き換える）。
// 変更の記録（meta/changes/<日付>.json）に op: "migrate"・via: "wrangler"（手元は "local"）で残す。古い控え（history/）は元の時刻のまま移すので、14 日たてば毎朝の片付けで消える
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, utimesSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writableFile } from '../src/lib/file-keys.mjs';
import { indexKey, blobKey } from '../src/lib/file-store.mjs';
import { fsStore, fsFiles } from '../src/lib/store-fs.mjs';

const args = process.argv.slice(2);
const remote = args.includes('--remote'), local = args.includes('--local'), dry = args.includes('--dry-run'), dropOld = args.includes('--drop-old');
if (remote === local) { console.error('使い方: node scripts/migrate-files.mjs --local|--remote [--dry-run] [--drop-old]'); process.exit(1); }
const root = resolve(import.meta.dirname, '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const OLD = /^(?:hymns|readings|template|history)\/|^manifest\.json$/;   // 古い置き場のキー
const MB = (n) => (n / 1e6).toFixed(1) + ' MB';

// ---------- 置き場（本番＝wrangler、手元＝data/）。読む・書くの形をそろえ、下の計画と確かめは同じものを通す ----------
const wrangler = (a, opts = {}) => {   // Cloudflare への通信がときどき途切れる（2026-10-25）ので 3 回まで試す。どの呼び出しも、やり直して結果が変わらない
  for (let i = 1; ; i++) {
    try { return execFileSync('npx', ['wrangler', ...a], { cwd: root, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'], ...opts }); }
    catch (e) { if (i === 3) throw e; console.error(`wrangler ${a.slice(0, 3).join(' ')} が失敗しました。10 秒後にやり直します（${i}/3）`); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); }
  }
};
const work = resolve(root, '.wrangler/migrate-files'); mkdirSync(work, { recursive: true });
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const d1 = (sql) => JSON.parse(wrangler(['d1', 'execute', 'DATA', '--remote', '--json', '--command', sql]).toString())[0].results;

const remoteSide = {
  /** KV の全キー（付箋つき） */
  list: () => JSON.parse(wrangler(['kv', 'key', 'list', '--binding', 'FILES', '--remote']).toString()).map(k => ({ key: k.name, metadata: k.metadata || {} })),
  /** 古い置き場の中身。手元の data/files に同じ指紋のものがあればそれを使い、無ければ KV から取る */
  async bytes(k) {
    const f = resolve(root, 'data/files', k.key);
    if (k.metadata.sha256 && existsSync(f)) { const b = readFileSync(f); if (sha256(b) === k.metadata.sha256) return b; }
    const b = wrangler(['kv', 'key', 'get', k.key, '--binding', 'FILES', '--remote']);
    if (k.metadata.sha256 ? sha256(b) !== k.metadata.sha256 : (k.metadata.size != null && b.length !== k.metadata.size)) throw new Error(`${k.key}: 取り出した中身が付箋と合いません`);
    process.stdout.write('.');
    return b;
  },
  rows: (prefix) => d1(`SELECT key, body, updated_at FROM objects WHERE key LIKE ${q(prefix + '%')}`),
  getText: async (key) => d1(`SELECT body FROM objects WHERE key = ${q(key)}`)[0]?.body ?? null,
  async putBlobs(blobs) {   // まとめて置く（1 回 5MB ほどに分ける。20MB を 1 回で送ると通信が失敗した。2026-10-25）
    let chunk = [], size = 0, n = 0;
    const flush = () => { if (!chunk.length) return; const f = resolve(work, `blobs-${n++}.json`); writeFileSync(f, JSON.stringify(chunk)); wrangler(['kv', 'bulk', 'put', f, '--binding', 'FILES', '--remote'], { stdio: ['ignore', 'inherit', 'inherit'] }); chunk = []; size = 0; };
    for (const [sha, b] of blobs) { chunk.push({ key: blobKey(sha), value: b.toString('base64'), base64: true, metadata: { size: b.length, sha256: sha } }); size += b.length; if (size > 5e6) flush(); }
    flush();
  },
  async putRows(rows) {   // 目次の行は上書き、控えの行はすでにあれば触らない
    const sql = rows.map(r => `INSERT INTO objects (key, body, updated_at) VALUES (${q(r.key)}, ${q(r.body)}, ${q(r.updated_at)}) ON CONFLICT(key) DO ${r.keep ? 'NOTHING' : 'UPDATE SET body = excluded.body, updated_at = excluded.updated_at'};`);
    const f = resolve(work, 'rows.sql'); writeFileSync(f, sql.join('\n'));
    wrangler(['d1', 'execute', 'DATA', '--remote', '--file', f, '-y'], { stdio: ['ignore', 'inherit', 'inherit'] });
  },
  async dropOld(keys) { const f = resolve(work, 'drop.json'); writeFileSync(f, JSON.stringify(keys)); wrangler(['kv', 'bulk', 'delete', f, '--binding', 'FILES', '--remote', '--force'], { stdio: ['ignore', 'inherit', 'inherit'] }); },
};

const store = fsStore(root), files = fsFiles(root), dataFiles = resolve(root, 'data/files');
const localSide = {
  list() {   // data/files の古い置き場（控えの時刻の「:」は手元では「-」）と blobs/
    const out = [];
    const walk = (dir) => { if (!existsSync(dir)) return; for (const f of readdirSync(dir).sort()) { const p = resolve(dir, f); if (statSync(p).isDirectory()) walk(p); else if (!f.startsWith('~$')) out.push({ key: relative(dataFiles, p).split('\\').join('/'), metadata: { uploaded: statSync(p).mtime.toISOString(), size: statSync(p).size } }); } };
    walk(dataFiles);
    return out.map(k => k.key.startsWith('history/') ? { ...k, path: k.key, key: k.key.replace(/T(\d\d)-(\d\d)-(\d\d)(\.\d+Z)$/, 'T$1:$2:$3$4') } : k);
  },
  bytes: async (k) => readFileSync(resolve(dataFiles, k.path || k.key)),
  rows: (prefix) => store.scan(prefix),
  getText: (key) => store.get(key),
  async putBlobs(blobs) { for (const [sha, b] of blobs) await files.put(blobKey(sha), b); },
  async putRows(rows) {
    for (const r of rows) {
      if (r.keep && (await store.get(r.key)) != null) continue;
      await store.put(r.key, r.body);
      const t = new Date(r.updated_at); utimesSync(resolve(root, 'data', r.key), t, t);   // 控えの時刻＝ファイルの更新時刻（片付けが見る）
    }
  },
  async dropOld(keys) { for (const k of keys) rmSync(resolve(dataFiles, k.path || k.key), { force: true }); for (const d of ['hymns', 'readings', 'template', 'history']) rmSync(resolve(dataFiles, d), { recursive: true, force: true }); },
};
const side = remote ? remoteSide : localSide;
const where = remote ? '本番' : '手元';

// ---------- 計画: 古い置き場 → 置く中身・書く行 ----------
const all = await side.list();
const old = all.filter(k => OLD.test(k.key));
const haveBlobs = new Set(all.filter(k => k.key.startsWith('blobs/')).map(k => k.key.slice(6)));
const index = new Map((await side.rows('index/')).map(r => [r.key, JSON.parse(r.body)]));

if (dropOld) {
  // 消す前に: 今の名前の古いキーはどれも目次に行があり、目次と控えが指す中身はすべて blobs/ にある
  const hist = await side.rows('history/index/');
  const missing = old.filter(k => !k.key.startsWith('history/') && writableFile(k.key) && !index.has(indexKey(k.key))).map(k => k.key);
  const noBlob = [...index.values(), ...hist.map(r => JSON.parse(r.body))].filter(r => !haveBlobs.has(r.sha256)).map(r => r.sha256);
  if (missing.length || noBlob.length) { console.error(`${where}: まだ消せません。目次に無い: ${missing.join(', ') || 'なし'} / 中身が無い指紋: ${noBlob.join(', ') || 'なし'}`); process.exit(1); }
  console.log(`${where}: 古い名前のキー ${old.length} 件を消します（目次 ${index.size} 行・控え ${hist.length} 行・中身 ${haveBlobs.size} 個は確かめ済み）`);
  if (!dry) { await side.dropOld(old); console.log('消しました'); }
  process.exit(0);
}

const manifestKey = old.find(k => k.key === 'manifest.json');
const manifest = manifestKey ? JSON.parse((await side.bytes(manifestKey)).toString('utf8')) : {};
const now = new Date().toISOString();
const blobs = new Map(), rows = [], changes = [], skipped = [];
let same = 0, newer = 0, total = 0;
for (const k of old) {
  if (k.key === 'manifest.json') continue;
  const h = k.key.match(/^history\/(.+)\/([^/]+)$/);
  if (h) {   // 古い控え → 控えの行（元の時刻のまま。名前が今は使わないものでも、14 日の約束どおり残す）
    const b = await side.bytes(k), sha = sha256(b);
    if (!haveBlobs.has(sha)) blobs.set(sha, b);
    rows.push({ key: `history/${indexKey(h[1])}/${h[2]}`, body: JSON.stringify({ sha256: sha, size: b.length }), updated_at: h[2], keep: true });
    continue;
  }
  if (!writableFile(k.key)) { skipped.push(k.key); continue; }   // 今は使わない名前（古いテンプレ）
  total++;
  const b = await side.bytes(k), sha = sha256(b), uploaded = k.metadata.uploaded || now;
  const mm = k.key.match(/^(hymns|readings)\/(\d+)\.pptx$/), m = mm && manifest[mm[1]]?.[mm[2]];
  const row = mm ? { sha256: sha, size: b.length, uploaded, source: m?.source || `${mm[2]}.pptx`, modified: m?.modified || uploaded.slice(0, 10), slides: m?.slides ?? null, ratio: m?.ratio ?? null }
                 : { sha256: sha, size: b.length, uploaded, source: null };   // 形は API の置く（src/lib/api.mjs）と同じ
  const cur = index.get(indexKey(k.key));
  if (cur && cur.sha256 === sha) { same++; continue; }
  if (cur && cur.uploaded >= uploaded) { newer++; continue; }   // 新しいコードで置き直したもの（古い置き場の方が古い）
  if (!haveBlobs.has(sha)) blobs.set(sha, b);
  rows.push({ key: indexKey(k.key), body: JSON.stringify(row), updated_at: now });
  changes.push({ at: now, who: null, via: remote ? 'wrangler' : 'local', op: 'migrate', key: `files/${k.key}`, size: b.length });
}
if (remote) console.log();
const histRows = rows.filter(r => r.keep).length;
console.log(`${where}: 今のファイル ${total} 件（目次に書く ${rows.length - histRows}・同じ ${same}・目次の方が新しい ${newer}）、控え ${histRows} 件、置く中身 ${blobs.size} 個（${MB([...blobs.values()].reduce((s, b) => s + b.length, 0))}）`);
if (skipped.length) console.log(`今は使わない名前なので移さない: ${skipped.join(', ')}`);
if (dry) process.exit(0);

// ---------- 実行: 中身を先に置き、それから目次（目次が無い中身を指すことが無いように） ----------
await side.putBlobs(blobs);
if (changes.length) {
  const key = `meta/changes/${now.slice(0, 10)}.json`;
  rows.push({ key, body: JSON.stringify([...JSON.parse((await side.getText(key)) || '[]'), ...changes]), updated_at: now });
}
if (rows.length) await side.putRows(rows);

// ---------- 確かめ: 目次と控えの行が指す中身が、すべて置き場にある ----------
const after = new Set((await side.list()).filter(k => k.key.startsWith('blobs/')).map(k => k.key.slice(6)));
const pointed = [...await side.rows('index/'), ...await side.rows('history/index/')].map(r => JSON.parse(r.body).sha256);
const lost = pointed.filter(s => !after.has(s));
console.log(lost.length ? `中身が無い指紋が ${lost.length} 個あります: ${lost.join(', ')}` : `確かめました: 目次と控えの ${pointed.length} 行が指す中身は、すべて置き場にあります（中身 ${after.size} 個）`);
process.exit(lost.length ? 1 : 0);
