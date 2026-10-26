// テンプレ一式の置き場（src/lib/api.mjs の files/template/… と templates。docs/pptx-template.md §1.1・docs/file-store.md）。
// 部品の名前は日本語で、URL ではエンコードされて届く。中身は KV の blobs/<指紋>、今の版の目次は D1。前の目次の行は history/ に残り、記録が付く
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApi } from '../src/lib/api.mjs';
import { TEMPLATE_KEY } from '../src/lib/file-keys.mjs';
import { validPartName } from '../src/lib/slides/check.mjs';

function memStore() {
  const m = new Map(); const stamp = () => new Date().toISOString();
  return { m, get: async (k) => m.get(k)?.body ?? null, put: async (k, body) => { m.set(k, { body, updated_at: stamp() }); }, delete: async (k) => { m.delete(k); },
    list: async (p) => [...m.keys()].filter(k => k.startsWith(p)), entries: async () => [],
    scan: async (p) => [...m].filter(([k]) => k.startsWith(p)).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, ...v })), removeMany: async (ks) => { for (const k of ks) m.delete(k); } };
}
function memFiles() { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, b) => { m.set(k, b); }, delete: async (k) => { m.delete(k); }, list: async () => [...m.keys()].map(key => ({ key })) }; }
const setup = () => {
  const store = memStore(), files = memFiles();
  const api = createApi({ store, files, config: {}, fit: {}, actor: () => ({ who: 'tanto@example.com', via: 'slides' }) });
  const url = (key) => 'files/' + key.split('/').map(encodeURIComponent).join('/');   // 画面と同じエンコード
  const call = (method, path, body, headers = {}) => api(new Request(`https://x/input-shuho/api/${path}`, { method, body, headers }), path);
  const row = (name) => JSON.parse(store.m.get(`index/${name}.json`)?.body ?? 'null');
  return { store, files, url, call, row };
};
const pptx = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);
const sha = (b) => createHash('sha256').update(b).digest('hex');

test('日本語の名前の部品を置いて読める（エンコードされたパスでも）。中身は blobs/<指紋>、目次の行に元のファイル名など', async () => {
  const t = setup();
  assert.equal((await t.call('PUT', t.url('template/部品/賛美.pptx'), pptx, { 'x-file-meta': encodeURIComponent(JSON.stringify({ source: '賛美の部品.pptx' })) })).status, 200);
  assert.deepEqual([t.row('template/部品/賛美.pptx').sha256, t.row('template/部品/賛美.pptx').source], [sha(pptx), '賛美の部品.pptx']);
  assert.ok(t.files.m.has(`blobs/${sha(pptx)}`));
  const got = await t.call('GET', t.url('template/部品/賛美.pptx'));
  assert.equal(got.status, 200); assert.equal(got.headers.get('etag'), `"${sha(pptx)}"`); assert.deepEqual(new Uint8Array(await got.arrayBuffer()), pptx);
  assert.equal((await t.call('GET', t.url('template/部品/賛美.pptx'), undefined, { 'if-none-match': `"${sha(pptx)}"` })).status, 304);   // 指紋が同じなら本文を送らない
});
test('差し替えると、すぐ新しい版を返す（古い中身は残る）。前の目次の行は history/ に残り、記録が付く', async () => {
  const t = setup();
  const v2 = new Uint8Array([0x50, 0x4b, 9]);
  await t.call('PUT', t.url('template/部品/賛美.pptx'), pptx);
  await t.call('PUT', t.url('template/部品/賛美.pptx'), v2);
  assert.deepEqual(new Uint8Array(await (await t.call('GET', t.url('template/部品/賛美.pptx'))).arrayBuffer()), v2);
  assert.ok(t.files.m.has(`blobs/${sha(pptx)}`) && t.files.m.has(`blobs/${sha(v2)}`));
  assert.equal([...t.store.m.keys()].filter(k => k.startsWith('history/index/template/部品/賛美.pptx.json/')).length, 1);
  const changes = [...t.store.m.entries()].filter(([k]) => k.startsWith('meta/changes/')).flatMap(([, v]) => JSON.parse(v.body));
  assert.deepEqual(changes.map(c => [c.op, c.key, c.via]), [['put', 'files/template/部品/賛美.pptx', 'slides'], ['put', 'files/template/部品/賛美.pptx', 'slides']]);
});
test('JSON（背景.json・式順）は JSON として読めなければ断る。pptx は zip でなければ断る', async () => {
  const t = setup();
  assert.equal((await t.call('PUT', t.url('template/背景.json'), '{"背景色": "0000FF", "文字色": {"基本": "FFFFFF", "強調": "FFFF00"}}')).status, 200);
  assert.equal((await t.call('PUT', t.url('template/式順/worship.json'), '{ 壊れた')).status, 400);
  assert.equal((await t.call('PUT', t.url('template/背景.pptx'), 'not a zip')).status, 400);
});
test('消せるのは部品だけ。消すと目次から消え（すぐ 404）、中身は残る。背景・背景.json・式順は差し替えるだけ', async () => {
  const t = setup();
  for (const k of ['template/部品/前奏.pptx', 'template/背景.pptx']) await t.call('PUT', t.url(k), pptx);
  await t.call('PUT', t.url('template/背景.json'), '{}');
  assert.equal((await t.call('DELETE', t.url('template/部品/前奏.pptx'))).status, 200);
  assert.equal(t.row('template/部品/前奏.pptx'), null);
  assert.equal((await t.call('GET', t.url('template/部品/前奏.pptx'))).status, 404);
  assert.ok(t.files.m.has(`blobs/${sha(pptx)}`), '中身は控えが指しているので残る');
  assert.ok([...t.store.m.keys()].some(k => k.startsWith('history/index/template/部品/前奏.pptx.json/')));
  assert.equal((await t.call('DELETE', t.url('template/部品/前奏.pptx'))).status, 404);
  assert.notEqual((await t.call('DELETE', t.url('template/背景.pptx'))).status, 200);
  assert.notEqual((await t.call('DELETE', t.url('template/背景.json'))).status, 200);
  assert.ok(t.row('template/背景.pptx') && t.row('template/背景.json'));
});
test('決まりに無い名前は置けない（式順の名前・部品の字・入れ子・古いテンプレの置き場）', async () => {
  const t = setup();
  for (const k of ['template/式順/sunday.json', 'template/部品/a b.pptx', 'template/部品/x/y.pptx', 'template/他.pptx', 'template/worship.pptx', 'template/verse-spTree.xml']) assert.notEqual((await t.call('PUT', t.url(k), pptx)).status, 200, k);
});
test('一覧（templates）はテンプレ一式だけ（目次から）。置いた時刻つき。最後の片付けも返す', async () => {
  const t = setup();
  await t.call('PUT', t.url('template/部品/賛美.pptx'), pptx);
  await t.store.put('masters/hymns.json', '{"1":"一"}'); await t.call('PUT', 'files/hymns/1.pptx', pptx);
  await t.store.put('meta/cleanup/last.json', '{"at":"2026-10-26T18:00:00.000Z","history":2,"blobs":1}');
  const r = await (await t.call('GET', 'templates')).json();
  assert.deepEqual(r.files.map(f => f.key), ['template/部品/賛美.pptx']);
  assert.ok(Date.parse(r.files[0].uploaded));
  assert.deepEqual(r.cleanup, { at: '2026-10-26T18:00:00.000Z', history: 2, blobs: 1 });
});
test('歌詞の pptx の有無（bootstrap の files）は目次から。元のファイル名・枚数・比率つき', async () => {
  const t = setup();
  await t.store.put('masters/hymns.json', '{"48":"イエスきみは"}'); await t.store.put('masters/readings.json', '{}');
  for (const [k, v] of [['church.json', '{"name":"x"}'], ['masters/people.json', '{"people":[]}'], ['prayer-list.json', '{"items":[]}'], ['texts.json', '{}']]) await t.store.put(k, v);   // bootstrap に要る最小のデータ
  await t.call('PUT', 'files/hymns/48.pptx', pptx, { 'x-file-meta': encodeURIComponent(JSON.stringify({ source: '48イエスきみは16.9.pptx', slides: 7, ratio: 1.78 })) });
  const r = await (await t.call('GET', 'bootstrap')).json();
  assert.deepEqual(Object.keys(r.files.hymns), ['48']);
  assert.deepEqual({ ...r.files.hymns['48'], modified: 'x' }, { source: '48イエスきみは16.9.pptx', modified: 'x', slides: 7, ratio: 1.78 });
  assert.deepEqual(r.files.readings, {});
});
test('版の中身そのもの（files/blobs/<指紋>）は写し用にそのまま返す', async () => {
  const t = setup();
  await t.call('PUT', t.url('template/部品/賛美.pptx'), pptx);
  const r = await t.call('GET', `files/blobs/${sha(pptx)}`);
  assert.equal(r.status, 200); assert.deepEqual(new Uint8Array(await r.arrayBuffer()), pptx);
  assert.equal((await t.call('GET', `files/blobs/${'0'.repeat(64)}`)).status, 404);
});
test('部品名の決まりは API とスライド生成の確かめで同じ', () => {
  for (const n of ['賛美', 'ご年配', '聖句_2', 'x-1', 'a b', '賛美（1）', 'a/b', '']) assert.equal(TEMPLATE_KEY.test(`template/部品/${n}.pptx`), validPartName(n), n);
});
