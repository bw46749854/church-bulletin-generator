// ファイルの置き場（src/lib/file-store.mjs。docs/file-store.md）: 目次（D1）と、上書きしない中身（KV）、控えの片付け
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileStore, indexKey, blobKey, NotYetError } from '../src/lib/file-store.mjs';

/** D1 の代わり（時刻は手で進める） */
function memStore(clock) {
  const m = new Map();
  return {
    m, get: async (k) => m.get(k)?.body ?? null, put: async (k, body) => { m.set(k, { body, updated_at: clock.iso() }); }, delete: async (k) => { m.delete(k); },
    scan: async (p, { before = null, limit = null } = {}) => { let r = [...m].filter(([k]) => k.startsWith(p)).map(([key, v]) => ({ key, ...v })); if (before) r = r.filter(x => x.updated_at < before).sort((a, b) => a.updated_at.localeCompare(b.updated_at)); else r.sort((a, b) => a.key.localeCompare(b.key)); return limit ? r.slice(0, limit) : r; },
    removeMany: async (ks) => { for (const k of ks) m.delete(k); },
  };
}
function memFiles() { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, b) => { m.set(k, b); }, delete: async (k) => { m.delete(k); } }; }
function setup() {
  const clock = { t: Date.parse('2026-10-01T00:00:00Z'), iso() { return new Date(this.t).toISOString(); }, days(n) { this.t += n * 864e5; } };
  const store = memStore(clock), files = memFiles(), log = [];
  // API の共通部品と同じ: 前の行を history/ に残し、記録を付ける
  const writeObject = async (req, key, text, what) => { const prev = await store.get(key); if (prev != null && prev !== text) await store.put(`history/${key}/${clock.iso()}`, prev); await store.put(key, text); log.push({ op: 'put', key, ...what }); return prev != null; };
  const removeObject = async (req, key, what) => { const prev = await store.get(key); if (prev == null) return false; await store.put(`history/${key}/${clock.iso()}`, prev); await store.delete(key); log.push({ op: 'delete', key, ...what }); return true; };
  const fs = createFileStore({ store, files, writeObject, removeObject, sleep: async () => {} });
  const row = (sha, extra = {}) => ({ sha256: sha, size: 3, uploaded: clock.iso(), ...extra });
  return { clock, store, files, log, fs, row };
}
const b = (s) => new TextEncoder().encode(s);

test('置く → 目次の行と、指紋の名前の中身。読むと今の版。記録の key は files/<名前>', async () => {
  const t = setup();
  assert.equal(await t.fs.put(null, 'hymns/48.pptx', b('v1'), t.row('aaa', { source: '48.pptx' })), false);
  assert.deepEqual(JSON.parse(await t.store.get(indexKey('hymns/48.pptx'))), { sha256: 'aaa', size: 3, uploaded: '2026-10-01T00:00:00.000Z', source: '48.pptx' });
  assert.equal(new TextDecoder().decode(t.files.m.get(blobKey('aaa'))), 'v1');
  const got = await t.fs.get('hymns/48.pptx');
  assert.equal(got.row.sha256, 'aaa'); assert.equal(new TextDecoder().decode(got.bytes), 'v1');
  assert.deepEqual(t.log.map(l => [l.op, l.key]), [['put', 'files/hymns/48.pptx']]);
});
test('差し替え → 目次は新しい版を指し、古い中身は消えずに残る。前の行は history/ に（前があったと返す）', async () => {
  const t = setup();
  await t.fs.put(null, 'template/部品/賛美.pptx', b('v1'), t.row('aaa'));
  t.clock.days(1);
  assert.equal(await t.fs.put(null, 'template/部品/賛美.pptx', b('v2'), t.row('bbb')), true);
  assert.equal((await t.fs.stat('template/部品/賛美.pptx')).sha256, 'bbb');
  assert.ok(t.files.m.has(blobKey('aaa')) && t.files.m.has(blobKey('bbb')));
  assert.deepEqual([...t.store.m.keys()].filter(k => k.startsWith('history/')), ['history/index/template/部品/賛美.pptx.json/2026-10-02T00:00:00.000Z']);
});
test('消す → 目次の行だけ消え、中身は残る（控えが指している）。一覧は目次から（1 回で）', async () => {
  const t = setup();
  await t.fs.put(null, 'template/部品/前奏.pptx', b('v1'), t.row('aaa')); await t.fs.put(null, 'template/背景.json', b('{}'), t.row('ccc')); await t.fs.put(null, 'hymns/1.pptx', b('h'), t.row('ddd'));
  assert.equal(await t.fs.remove(null, 'template/部品/前奏.pptx'), true);
  assert.equal(await t.fs.stat('template/部品/前奏.pptx'), null);
  assert.ok(t.files.m.has(blobKey('aaa')));
  assert.deepEqual((await t.fs.list('template/')).map(f => [f.key, f.sha256]), [['template/背景.json', 'ccc']]);
  assert.equal(await t.fs.remove(null, 'template/部品/無い.pptx'), false);
});
test('中身がまだ届いていなければ読み直し、5 回で届かなければ「少し待って」', async () => {
  const t = setup();
  await t.store.put(indexKey('hymns/2.pptx'), JSON.stringify(t.row('eee')));
  let n = 0; const get = t.files.get; t.files.get = async (k) => (++n < 3 ? null : get(k));
  t.files.m.set(blobKey('eee'), b('late'));
  assert.equal(new TextDecoder().decode((await t.fs.get('hymns/2.pptx')).bytes), 'late');
  t.files.get = async () => null;
  await assert.rejects(t.fs.get('hymns/2.pptx'), (e) => e instanceof NotYetError && /まだ届いていません/.test(e.message));
});
test('片付け: 14 日より前の控えを消し、どこからも使われなくなった中身だけを KV から消す', async () => {
  const t = setup();
  await t.fs.put(null, 'template/部品/賛美.pptx', b('v1'), t.row('aaa'));
  await t.fs.put(null, 'template/部品/黙祷.pptx', b('same'), t.row('sss'));
  t.clock.days(1); await t.fs.put(null, 'template/部品/賛美.pptx', b('v2'), t.row('bbb'));       // aaa は控えだけが指す
  await t.fs.put(null, 'template/部品/前奏.pptx', b('same'), t.row('sss'));                        // 同じ中身を 2 つの名前で
  await t.fs.remove(null, 'template/部品/黙祷.pptx');                                              // sss の控え（前奏は今も sss）
  await t.store.put('history/masters/hymns.json/x', '{}');                                         // マスタの控えも同じ決まりで片付く
  t.clock.days(10);
  let r = await t.fs.cleanup({ now: t.clock.t });
  assert.deepEqual([r.history, r.blobs], [0, 0], '14 日たっていない');
  t.clock.days(5);
  r = await t.fs.cleanup({ now: t.clock.t });
  assert.deepEqual([r.history, r.blobs, r.more], [3, 1, false]);
  assert.ok(!t.files.m.has(blobKey('aaa')), '使われなくなった中身は消える');
  assert.ok(t.files.m.has(blobKey('sss')) && t.files.m.has(blobKey('bbb')), '今の目次が使う中身は残る（同じ中身を共有していても）');
  assert.deepEqual([...t.store.m.keys()].filter(k => k.startsWith('history/')), []);
  assert.deepEqual(JSON.parse(await t.store.get('meta/cleanup/last.json')), { ...r });
  assert.deepEqual([(await t.fs.cleanup({ now: t.clock.t })).history], [0], '何度動いても同じ');
});
test('片付けは 1 回 limit 件まで。残りがあれば more', async () => {
  const t = setup();
  for (let i = 0; i < 5; i++) await t.store.put(`history/masters/hymns.json/${i}`, '{}');
  t.clock.days(20);
  const r = await t.fs.cleanup({ now: t.clock.t, limit: 3 });
  assert.deepEqual([r.history, r.more], [3, true]);
  assert.equal((await t.fs.cleanup({ now: t.clock.t, limit: 3 })).history, 2);
});
