// ファイルの置き場（docs/file-store.md）。歌詞・交読文・テンプレのファイルの中身は KV に指紋（sha256）の名前 blobs/<指紋> で置いて
// 上書きせず、「今の版はどれか」の目次を D1 の index/<名前>.json（1 ファイル 1 行）に持つ。
// KV は書いた内容が行き渡るまで最大 1 分ほどかかるが、版の名前と中身は必ず一致し、今の版は D1（書いた瞬間から最新）が決めるので、
// 差し替えた直後でも古い中身を掴まない。目次の行を書く・消すのは API の共通部品（前の行を history/ に残し、変更の記録を付ける）
export const indexKey = (name) => `index/${name}.json`;
export const blobKey = (sha256) => `blobs/${sha256}`;
const INDEX = 'index/', HISTORY = 'history/', INDEX_HISTORY = 'history/index/';
const nameOf = (key) => key.slice(INDEX.length, -'.json'.length);
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

/** 中身がまだ届いていない（置いた直後）。少し待てば読める */
export class NotYetError extends Error { constructor(message) { super(message); this.name = 'NotYetError'; } }

/**
 * @param {object} o
 * @param {{get, put, scan, removeMany}} o.store  D1（store-d1.mjs）か手元（store-fs.mjs）
 * @param {{get, put, delete}} o.files  KV（手元はファイル）
 * @param {(request, key, text, what) => Promise<boolean>} o.writeObject  行を書く（前の行を history/ に残し、変更の記録を付ける。前があったかを返す）
 * @param {(request, key, what) => Promise<boolean>} o.removeObject  行を消す（同じく前の行を history/ に残す）
 * @param {(ms: number) => Promise<void>} [o.sleep]
 */
export function createFileStore(o) {
  const sleep = o.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const self = {
    /** 今の版の目次の行（{sha256, size, uploaded, …}）。無ければ null */
    async stat(name) { const t = await o.store.get(indexKey(name)); return t ? parse(t) : null; },
    /** 版の中身。置いた直後でまだ届いていなければ 1 秒おきに 5 回まで読み直す */
    async read(row, name) {
      for (let i = 0; ; i++) {
        const bytes = await o.files.get(blobKey(row.sha256));
        if (bytes) return bytes;
        if (i === 5) throw new NotYetError(`${name} の中身がまだ届いていません。少し待ってからやり直してください`);
        await sleep(1000);
      }
    },
    async get(name) { const row = await self.stat(name); return row ? { row, bytes: await self.read(row, name) } : null; },
    /** 置く・差し替える。中身を指紋の名前で置いてから目次の行を書く（行を書いた瞬間から全員が新しい版を使う）。前の版があったかを返す */
    async put(request, name, bytes, row) {
      await o.files.put(blobKey(row.sha256), bytes, { size: bytes.length, sha256: row.sha256 });
      return o.writeObject(request, indexKey(name), JSON.stringify(row), { key: `files/${name}`, size: bytes.length });
    },
    /** 消す（目次の行だけ。中身は控えが指しているので、片付けで消える） */
    async remove(request, name) { return o.removeObject(request, indexKey(name), { key: `files/${name}` }); },
    /** prefix（例 'template/'・'hymns/'）の下のファイルの一覧（1 回の問い合わせ） */
    async list(prefix = '') { return (await o.store.scan(INDEX + prefix)).map(r => ({ key: nameOf(r.key), ...parse(r.body) })); },
    /**
     * 控えの片付け（毎朝の定時実行。docs/file-store.md §3）。days 日より前の history/ の行を消し、
     * それが指していた中身を、今の目次も残っている控えも使っていなければ KV から消す。1 回 limit 件まで（残りは次の回）。
     * 何度動いても結果は同じ。結果は meta/cleanup/last.json に残す
     */
    async cleanup({ now = Date.now(), days = 14, limit = 40 } = {}) {
      const before = new Date(now - days * 864e5).toISOString();
      const old = await o.store.scan(HISTORY, { before, limit });
      const shas = new Set(old.filter(r => r.key.startsWith(INDEX_HISTORY)).map(r => parse(r.body)?.sha256).filter(Boolean));
      await o.store.removeMany(old.map(r => r.key));
      let blobs = 0;
      if (shas.size) {
        const live = new Set([...await o.store.scan(INDEX), ...await o.store.scan(INDEX_HISTORY)].map(r => parse(r.body)?.sha256));
        for (const s of shas) if (!live.has(s)) { await o.files.delete(blobKey(s)); blobs++; }
      }
      const result = { at: new Date(now).toISOString(), before, history: old.length, blobs, more: old.length === limit };
      await o.store.put('meta/cleanup/last.json', JSON.stringify(result));
      return result;
    },
  };
  return self;
}
