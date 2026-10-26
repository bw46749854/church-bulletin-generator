// 担当者用の窓口（src/lib/slides-window.mjs）が、許可した仕事だけを API に渡すこと。とくに週データを書く仕事が通らないこと。
// 実行: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slidesAllows, handleSlidesWindow, ACTOR_HEADER } from '../src/lib/slides-window.mjs';

const ORIGIN = 'https://samplechurch-shuho.example.workers.dev';
/** API の代わり。渡された依頼を覚えて 200 を返す */
function fakeApi() {
  const calls = [];
  const api = async (req, path) => { calls.push({ method: req.method, url: req.url, path, body: req.body ? await req.text() : null }); return new Response('ok'); };
  return { api, calls };
}
const call = async (method, path, body) => {
  const { api, calls } = fakeApi();
  const res = await handleSlidesWindow(new Request(`https://slides.internal/api/${path}`, { method, body, headers: { [ACTOR_HEADER]: 'tanto@example.com' } }), api, ORIGIN);
  return { res, calls };
};

// 通すもの（docs/slides-role.md §4）
const ALLOWED = [
  ['GET', 'bootstrap'], ['GET', 'week/2026-10-18'], ['GET', 'pdf/2026-10-18'],
  ['GET', 'files/hymns/101.pptx'], ['GET', 'files/readings/5.pptx'],
  ['GET', 'bible'], ['GET', 'bible/books'], ['GET', 'export'],
  ['POST', 'masters/hymns'], ['POST', 'masters/readings'], ['DELETE', 'masters/hymns/998'], ['DELETE', 'masters/readings/12'],
  ['PUT', 'files/hymns/998.pptx'], ['PUT', 'files/readings/12.pptx'],
  ['DELETE', 'files/hymns/998.pptx'], ['DELETE', 'files/readings/12.pptx'],
  // テンプレ一式（docs/pptx-template.md）: 読む・一覧・差し替え。部品だけ消せる
  ['GET', 'files/template/背景.pptx'], ['GET', 'files/template/背景.json'], ['GET', 'files/template/部品/賛美.pptx'], ['GET', 'files/template/式順/worship.json'], ['GET', 'templates'],
  ['PUT', 'files/template/背景.pptx'], ['PUT', 'files/template/背景.json'], ['PUT', 'files/template/部品/前奏.pptx'], ['PUT', 'files/template/式順/other.json'],
  ['DELETE', 'files/template/部品/前奏.pptx'],
  ['PUT', 'sync/object/masters/people.json'], ['PUT', 'sync/object/masters/hymns.json'], ['PUT', 'sync/object/masters/readings.json'],
  ['PUT', 'sync/object/church.json'], ['PUT', 'sync/object/prayer-list.json'], ['PUT', 'sync/object/texts.json'],
];
// 通さないもの。とくに週データを書く仕事（保存・新しい週・日付の変更・週の差し替え）
const DENIED = [
  ['POST', 'save'], ['GET', 'week/2026-10-18/new'], ['POST', 'week/2026-10-18/rename'], ['GET', 'week/2026-10-18/exists'], ['GET', 'week/2026-10-18/json'],
  ['PUT', 'sync/object/weeks/2026-10-18.json'], ['PUT', 'sync/object/public/current.json'], ['GET', 'sync/manifest'], ['GET', 'sync/object/weeks/2026-10-18.json'],
  ['POST', 'preview'], ['POST', 'publish'], ['GET', 'site-builds'], ['GET', 'public/current'],
  ['POST', 'masters/texts'], ['POST', 'masters/prayer-list'], ['POST', 'masters/church'],
  ['PUT', 'files/manifest.json'], ['PUT', 'files/template/other.pptx'], ['PUT', 'files/hymns/abc.pptx'],
  ['GET', 'files/manifest.json'], ['GET', 'files/template/worship.pptx'], ['PUT', 'files/template/worship.pptx'], ['GET', 'files/blobs/' + 'a'.repeat(64)],   // 無くなった一覧表・古いテンプレ・版の中身そのもの（写し用）
  ['DELETE', 'files/template/背景.json'], ['DELETE', 'files/template/背景.pptx'], ['DELETE', 'files/template/式順/worship.json'],
  ['PUT', 'files/template/式順/sunday.json'], ['PUT', 'files/template/部品/../背景.pptx'], ['PUT', 'files/template/部品/a b.pptx'], ['PUT', 'files/template/部品/x.json'], ['PUT', 'templates'],
  ['GET', 'engine'], ['GET', 'engine/production'], ['GET', 'pdf-stats'], ['POST', 'client-log'], ['POST', '_pdf'],
  ['GET', 'auth/me'], ['POST', 'auth/google'],
  // 許可の仕事でも、方法（GET/POST…）が違えば通さない
  ['POST', 'bootstrap'], ['PUT', 'week/2026-10-18'], ['DELETE', 'week/2026-10-18'], ['PUT', 'masters/hymns'], ['DELETE', 'masters/hymns'], ['GET', 'masters/hymns/998'], ['HEAD', 'bootstrap'],
  // 形の崩れたパス
  ['GET', 'week/2026-10-18/../save'], ['POST', 'masters/hymns/../../save'], ['GET', 'files/hymns/../../weeks/2026-10-18.json'], ['GET', 'week/20261018'], ['GET', ''],
];

test('許可の一覧にある仕事は通る', () => { for (const [m, p] of ALLOWED) assert.ok(slidesAllows(m, p), `${m} ${p}`); });
test('許可の一覧に無い仕事は通らない（週データを書く仕事を含む）', () => { for (const [m, p] of DENIED) assert.ok(!slidesAllows(m, p), `${m} ${p}`); });

test('通る仕事は、牧師の画面と同じ URL の形で API に渡す（本文と ? の後ろもそのまま）', async () => {
  const { res, calls } = await call('PUT', 'sync/object/church.json', '{"a":"b"}');
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ method: 'PUT', url: `${ORIGIN}/input-shuho/api/sync/object/church.json`, path: 'sync/object/church.json', body: '{"a":"b"}' }]);
  const r2 = await call('GET', 'bible?ref=' + encodeURIComponent('マタイ28:16-20'));
  assert.equal(r2.calls[0].path, 'bible');
  assert.equal(new URL(r2.calls[0].url).searchParams.get('ref'), 'マタイ28:16-20');
});

test('通らない仕事は 403 で、API には届かない', async () => {
  for (const [m, p] of [['POST', 'save'], ['PUT', 'sync/object/weeks/2026-10-18.json'], ['POST', 'publish']]) {
    const { res, calls } = await call(m, p, m === 'GET' ? undefined : '{}');
    assert.equal(res.status, 403, `${m} ${p}`);
    assert.equal(calls.length, 0, `${m} ${p}`);
  }
});

test('/api/ で始まらない依頼は 400、誰からか無ければ 401、公開アドレスが無ければ 500（どれも API には届かない）', async () => {
  const { api, calls } = fakeApi();
  const who = { headers: { [ACTOR_HEADER]: 'tanto@example.com' } };
  assert.equal((await handleSlidesWindow(new Request('https://slides.internal/input-shuho/slides/api/bootstrap', who), api, ORIGIN)).status, 400);
  assert.equal((await handleSlidesWindow(new Request('https://slides.internal/api/bootstrap'), api, ORIGIN)).status, 401);
  assert.equal((await handleSlidesWindow(new Request('https://slides.internal/api/bootstrap', who), api, '')).status, 500);
  assert.equal(calls.length, 0);
});

test('日本語のパス（URL エンコードで届く）は戻してから許可の一覧と比べ、API にも戻した形で渡す', async () => {
  const enc = 'files/template/' + encodeURIComponent('部品') + '/' + encodeURIComponent('賛美') + '.pptx';
  const { res, calls } = await call('GET', enc);
  assert.equal(res.status, 200);
  assert.equal(calls[0].path, 'files/template/部品/賛美.pptx');
  assert.equal((await call('DELETE', 'files/template/' + encodeURIComponent('背景') + '.json')).res.status, 403);
});
