// 書き込みの記録と退避（src/lib/api.mjs の writeObject・writeFile・recordChange。docs/slides-role.md §7）。
// 正本への書き込みが、前の内容を history/ に残し、「いつ・誰が・どの入口から・何を」を meta/changes/ に足すこと。実行: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/lib/api.mjs';

/** 置き場（D1・KV）の代わり */
function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async (p) => [...m.keys()].filter(k => k.startsWith(p)).sort(), entries: async () => [] };
}
function memFiles(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, b) => { m.set(k, b); }, delete: async (k) => { m.delete(k); } };
}
const setup = (actor) => {
  const store = memStore({ 'masters/hymns.json': JSON.stringify({ 6: '父、み子、み霊の' }), 'church.json': JSON.stringify({ name: '見本' }) });
  const files = memFiles();
  const api = createApi({ store, files, config: {}, fit: {}, actor });
  const call = (method, path, body, headers = {}) => api(new Request(`https://x/input-shuho/api/${path}`, { method, body, headers }), path);
  const changes = () => [...store.m.entries()].filter(([k]) => k.startsWith('meta/changes/')).flatMap(([, v]) => JSON.parse(v));
  const history = (prefix) => [...store.m.keys(), ...[...files.m.keys()].map(k => 'files:' + k)].filter(k => k.includes('history/' + prefix));
  return { store, files, call, changes, history };
};

test('マスタの登録: 前の内容を history/ に残し、誰が・どこから・何をを記録する', async () => {
  const t = setup(() => ({ who: 'tanto@example.com', via: 'slides' }));
  assert.equal((await t.call('POST', 'masters/hymns', JSON.stringify({ 998: 'テスト' }))).status, 200);
  assert.equal(JSON.parse(t.store.m.get('masters/hymns.json'))['998'], 'テスト');
  assert.equal(t.history('masters/hymns.json').length, 1);
  const [c] = t.changes();
  assert.equal(c.who, 'tanto@example.com'); assert.equal(c.via, 'slides'); assert.equal(c.op, 'put'); assert.equal(c.key, 'masters/hymns.json'); assert.deepEqual(c.titles, { 998: [null, 'テスト'] });   // 新規は前が null
  assert.ok(Date.parse(c.at));
});

test('曲名・交読文の題は、番号ごとに前と後を記録する（新規は前が null、削除は後が null）', async () => {
  const t = setup(() => ({ who: 'tanto@example.com', via: 'slides' }));
  await t.call('POST', 'masters/hymns', JSON.stringify({ 6: '新しい題', 998: 'テスト' }));
  await t.call('DELETE', 'masters/hymns/6');
  assert.deepEqual(t.changes().map(c => [c.op, c.titles]), [
    ['put', { 6: ['父、み子、み霊の', '新しい題'], 998: [null, 'テスト'] }],
    ['delete', { 6: ['新しい題', null] }],
  ]);
  assert.ok(t.changes().every(c => !('nos' in c)));
});

test('画面での編集（教会情報）も history/ に残す（これまでは残していなかった）', async () => {
  const t = setup(async () => ({ who: 'pastor@example.com', via: 'input-shuho' }));
  await t.call('POST', 'masters/church', JSON.stringify({ name: 'サンプル教会' }));
  assert.equal(t.history('church.json').length, 1);
  assert.equal(t.changes()[0].who, 'pastor@example.com');
});

test('JSON の差し替え・マスタの削除・pptx の置き換えと削除も、同じ形で記録する', async () => {
  const t = setup(() => ({ who: 'tanto@example.com', via: 'slides' }));
  await t.call('PUT', 'sync/object/church.json', JSON.stringify({ name: '差し替え' }));
  await t.call('DELETE', 'masters/hymns/6');
  const pptx = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);
  await t.call('POST', 'masters/hymns', JSON.stringify({ 7: '七' }));
  assert.equal((await t.call('PUT', 'files/hymns/7.pptx', pptx)).status, 200);
  assert.equal((await t.call('PUT', 'files/hymns/7.pptx', new Uint8Array([0x50, 0x4b, 9]))).status, 200);   // 2 回目は置き換え → 前の目次の行を退避（docs/file-store.md）
  assert.equal((await t.call('DELETE', 'files/hymns/7.pptx')).status, 200);
  const ops = t.changes().map(c => `${c.op} ${c.key}${c.by ? ' ' + c.by : ''}`);
  assert.deepEqual(ops, ['put church.json replace', 'delete masters/hymns.json', 'put masters/hymns.json', 'put files/hymns/7.pptx', 'put files/hymns/7.pptx', 'delete files/hymns/7.pptx']);
  assert.equal(t.history('index/hymns/7.pptx').length, 2);   // 置き換え前と、削除前の目次の行（中身は KV の blobs/ に残る）
  assert.ok(t.changes().every(c => c.who === 'tanto@example.com' && c.via === 'slides'));
});

test('誰か分からない入口（actor なし）でも書き込みは止めず、誰かを空にして記録する', async () => {
  const t = setup(undefined);
  await t.call('POST', 'masters/hymns', JSON.stringify({ 998: 'テスト' }));
  const [c] = t.changes(); assert.equal(c.who, null); assert.equal(c.via, null);
});

test('api/changes は記録を新しい順に返す', async () => {
  const t = setup(() => ({ who: 'a@example.com', via: 'slides' }));
  await t.call('POST', 'masters/hymns', JSON.stringify({ 1: '一' }));
  await t.call('POST', 'masters/hymns', JSON.stringify({ 2: '二' }));
  const j = await (await t.call('GET', 'changes')).json();
  assert.deepEqual(j.changes.map(c => Object.keys(c.titles)[0]), ['2', '1']);
});
