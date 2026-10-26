// 担当者用 Worker の中継（slides/relay.mjs）: 受付を通った人の依頼だけを、誰からかを添えて窓口へ渡すこと。
// 実行: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSlides } from '../slides/relay.mjs';
import { ACTOR_HEADER } from '../src/lib/slides-window.mjs';

const HOST = 'https://samplechurch-slides.example.workers.dev';
/** 窓口の代わり。渡された依頼を覚えて 200 を返す */
function fakeShuho() {
  const calls = [];
  return { calls, fetch: async (r) => { calls.push({ method: r.method, url: r.url, who: r.headers.get(ACTOR_HEADER), body: r.body ? await r.text() : null }); return new Response('from-window', { status: 200 }); } };
}
const run = async (path, { who = 'tanto@example.com', method = 'GET', body, headers } = {}) => {
  const shuho = fakeShuho();
  const res = await handleSlides(new Request(HOST + path, { method, body, headers }), { who, shuho });
  return { res, calls: shuho.calls };
};

test('API の依頼は、/input-shuho/slides/ を外して窓口へ。本文・? の後ろはそのまま、誰からかを添える', async () => {
  const { res, calls } = await run('/input-shuho/slides/api/masters/hymns?x=1', { method: 'POST', body: '{"998":"t"}' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'from-window');
  assert.deepEqual(calls, [{ method: 'POST', url: 'https://slides.internal/api/masters/hymns?x=1', who: 'tanto@example.com', body: '{"998":"t"}' }]);
});

test('ページから送られた「誰から」は、受付で分かった人で上書きする', async () => {
  const { calls } = await run('/input-shuho/slides/api/bootstrap', { headers: { [ACTOR_HEADER]: 'pastor@example.com' } });
  assert.equal(calls[0].who, 'tanto@example.com');
});

test('受付を通っていなければ、API は 403 で窓口には渡さない', async () => {
  const api = await run('/input-shuho/slides/api/bootstrap', { who: null });
  assert.equal(api.res.status, 403); assert.equal(api.calls.length, 0);
  const me = await run('/input-shuho/slides/api/whoami', { who: null });
  assert.equal(me.res.status, 403);
});

test('api/whoami は受付で分かった人を返す（窓口には渡さない）', async () => {
  const { res, calls } = await run('/input-shuho/slides/api/whoami');
  assert.deepEqual(await res.json(), { email: 'tanto@example.com' }); assert.equal(calls.length, 0);
});

test('画面のエラー（api/client-log）は、この Worker のログに残して窓口には渡さない', async () => {
  const { res, calls } = await run('/input-shuho/slides/api/client-log', { method: 'POST', body: '{"where":"t","message":"m"}' });
  assert.equal(res.status, 204); assert.equal(calls.length, 0);
});

test('/ は担当者ページへ移動。/input-shuho/slides/ の外と、api/ 以外（無いファイル）は 404', async () => {
  const root = await run('/');
  assert.equal(root.res.status, 302); assert.equal(root.res.headers.get('location'), HOST + '/input-shuho/slides/');
  assert.equal((await run('/input-shuho/')).res.status, 404);
  assert.equal((await run('/input-shuho/slides/nothing.js')).res.status, 404);
});
