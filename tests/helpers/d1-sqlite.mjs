// 試験用: Cloudflare D1 の形（prepare → bind → first / all / run、batch）を node:sqlite で真似る（store-d1.mjs の SQL をそのまま試す）
import { DatabaseSync } from 'node:sqlite';
export function d1Sqlite() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
    _run: () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql), batch: async (stmts) => { for (const s of stmts) s._run(); }, exec: (sql) => db.exec(sql), raw: db };
}
