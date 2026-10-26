// 本番用の保存先：Cloudflare D1（SQLite）。キーは store-fs と同じ（church.json, masters/*.json, prayer-list.json, weeks/<date>.json）。
// 表は objects(key, body, updated_at) の 1 枚だけ。R2 と違いカード登録なしで使える。
export const SCHEMA = 'CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL)';

export function d1Store(db) {
  return {
    async get(key) { const r = await db.prepare('SELECT body FROM objects WHERE key = ?').bind(key).first(); return r ? r.body : null; },
    async put(key, text) { await db.prepare('INSERT INTO objects (key, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at').bind(key, text, new Date().toISOString()).run(); },
    /** 最後に書いた時刻（ISO、UTC）。無ければ null */
    async stamp(key) { const r = await db.prepare('SELECT updated_at FROM objects WHERE key = ?').bind(key).first(); return r ? r.updated_at : null; },
    async delete(key) { await db.prepare('DELETE FROM objects WHERE key = ?').bind(key).run(); },
    async list(prefix) { const { results } = await db.prepare("SELECT key FROM objects WHERE key LIKE ? ESCAPE '\\' ORDER BY key").bind(prefix.replace(/[%_\\]/g, '\\$&') + '%').all(); return results.map(r => r.key); },
    /**
     * prefix で始まる行を本文つきで（1 回の問い合わせ。無料の D1 は 1 回の呼び出しで 50 回までなので、行ごとに読まない）。
     * before（ISO）を渡すと、それより前に書いた行だけを古い順に。limit で件数を区切る
     */
    async scan(prefix, { before = null, limit = null } = {}) {
      let sql = "SELECT key, body, updated_at FROM objects WHERE key LIKE ? ESCAPE '\\'"; const args = [prefix.replace(/[%_\\]/g, '\\$&') + '%'];
      if (before) { sql += ' AND updated_at < ?'; args.push(before); }
      sql += before ? ' ORDER BY updated_at, key' : ' ORDER BY key';
      if (limit) { sql += ' LIMIT ?'; args.push(limit); }
      const { results } = await db.prepare(sql).bind(...args).all(); return results;
    },
    /** まとめて消す（batch は 1 回の問い合わせに数えられる） */
    async removeMany(keys) { if (keys.length) await db.batch(keys.map(k => db.prepare('DELETE FROM objects WHERE key = ?').bind(k))); },
    /** 同期用：全オブジェクト（本文つき）。history/ と meta/ は正本の写しの対象外 */
    async entries() { const { results } = await db.prepare("SELECT key, body, updated_at FROM objects WHERE key NOT LIKE 'history/%' AND key NOT LIKE 'meta/%' ORDER BY key").all(); return results; },
  };
}
