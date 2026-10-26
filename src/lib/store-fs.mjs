// ローカル用の保存先：data/ 直下のファイル。キーは D1 と同じ（church.json, masters/*.json, prayer-list.json, weeks/<date>.json）。
// 運用データが無ければ data/examples/ の仮名化サンプルを読む（clone 直後の動作確認用。書き込みは常に data/ 側）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function fsStore(root) {
  const real = (key) => resolve(root, 'data', key);
  const example = (key) => resolve(root, 'data/examples', key);
  const warned = new Set();
  return {
    async get(key) {
      if (existsSync(real(key))) return readFileSync(real(key), 'utf8');
      if (existsSync(example(key))) {
        if (!warned.has(key)) { warned.add(key); console.warn(`data/${key} が無いので data/examples/${key} を使います`); }
        return readFileSync(example(key), 'utf8');
      }
      return null;
    },
    async put(key, text) { mkdirSync(dirname(real(key)), { recursive: true }); writeFileSync(real(key), text); },
    /** 最後に書いた時刻（ファイルの更新時刻）。data/ 側に無ければ null */
    async stamp(key) { return existsSync(real(key)) ? statSync(real(key)).mtime.toISOString() : null; },
    async delete(key) { if (existsSync(real(key))) unlinkSync(real(key)); },
    /** prefix 配下のキー一覧（data/ 側のみ。サンプルの週は一覧に出さない） */
    async list(prefix) {
      const dir = real(prefix);
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => prefix + f).sort();
    },
    /** D1 の scan と同じ: prefix（「/」で終わるフォルダの形）の下の行を本文つきで。updated_at はファイルの更新時刻 */
    async scan(prefix, { before = null, limit = null } = {}) {
      const out = [];
      const walk = (dir, key) => { if (!existsSync(dir)) return; for (const f of readdirSync(dir)) { const p = resolve(dir, f); if (statSync(p).isDirectory()) walk(p, key + f + '/'); else out.push({ key: key + f, body: readFileSync(p, 'utf8'), updated_at: statSync(p).mtime.toISOString() }); } };
      walk(real(prefix), prefix);
      const rows = (before ? out.filter(r => r.updated_at < before).sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.key.localeCompare(b.key)) : out.sort((a, b) => a.key.localeCompare(b.key)));
      return limit ? rows.slice(0, limit) : rows;
    },
    async removeMany(keys) { for (const k of keys) if (existsSync(real(k))) unlinkSync(real(k)); },
    /** 同期用：data/ 直下の JSON（examples・files・bible・meta・history・config.json は除く）。updated_at はファイルの更新時刻 */
    async entries() {
      const out = []; const dataDir = resolve(root, 'data');
      const walk = (dir, prefix) => { if (!existsSync(dir)) return; for (const f of readdirSync(dir).sort()) { const p = resolve(dir, f); if (statSync(p).isDirectory()) { if (!['examples', 'files', 'meta', 'history'].includes(f)) walk(p, prefix + f + '/'); } else if (f.endsWith('.json') && !(prefix === '' && (f === 'config.json' || f === 'remote.json'))) out.push({ key: prefix + f, body: readFileSync(p, 'utf8'), updated_at: statSync(p).mtime.toISOString() }); } };
      walk(dataDir, ''); return out;
    },
  };
}

/** ファイルの中身の置き場（本番の KV の代わり）: data/files/<キー>。キーは blobs/<指紋>、今の版の目次は fsStore の index/（docs/file-store.md） */
export function fsFiles(root) {
  const real = (key) => resolve(root, 'data/files', key);
  return {
    async get(key) { return existsSync(real(key)) ? new Uint8Array(readFileSync(real(key))) : null; },
    async put(key, bytes) { mkdirSync(dirname(real(key)), { recursive: true }); writeFileSync(real(key), bytes); },
    async delete(key) { if (existsSync(real(key))) unlinkSync(real(key)); },
    /** 同期の比較用（名前が指紋なので中身は読まない） */
    async list() {
      const dir = real('blobs'); if (!existsSync(dir)) return [];
      return readdirSync(dir).filter(f => /^[0-9a-f]{64}$/.test(f)).sort().map(f => ({ key: 'blobs/' + f, size: statSync(resolve(dir, f)).size, sha256: f }));
    },
  };
}
