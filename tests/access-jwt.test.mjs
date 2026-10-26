// 受付（Access）の証明の検証（src/lib/auth.mjs の verifyAccessJwt）と、週報 Worker の API の門番（accessGate）。
// 本物の鍵の代わりに、ここで作った鍵で署名し、公開鍵の一覧（certs）の取得を差し替えて試す。実行: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessJwt, accessGate } from '../src/lib/auth.mjs';

const TEAM = 'team.cloudflareaccess.com', AUD = 'aud-slides';
const b64u = (b) => Buffer.from(b).toString('base64url');
const newKeys = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const publicJwk = async (k, kid) => ({ ...(await crypto.subtle.exportKey('jwk', k.publicKey)), kid, alg: 'RS256' });
let keys, served, realFetch;   // served: certs が返す公開鍵の一覧（鍵の入れ替えを試すときに差し替える）
before(async () => {
  keys = await newKeys();
  served = [await publicJwk(keys, 'k1')];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url) === `https://${TEAM}/cdn-cgi/access/certs` ? new Response(JSON.stringify({ keys: served })) : new Response('no', { status: 404 });
});
after(() => { globalThis.fetch = realFetch; });
async function jwt(payload, { kid = 'k1', key = keys.privateKey } = {}) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid })), p = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}
const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ iss: `https://${TEAM}`, aud: [AUD], email: 'Tanto@Example.com', exp: now() + 600 });
const machine = () => ({ iss: `https://${TEAM}`, aud: [AUD], common_name: 'abc123.access', sub: '', exp: now() + 600 });   // サービストークン

test('正しい証明なら、メールを返す（小文字にそろえる）', async () => {
  assert.deepEqual(await verifyAccessJwt(await jwt(good()), { teamDomain: TEAM, aud: AUD }), { ok: true, email: 'tanto@example.com', service: null });
});
test('機械（サービストークン）の正しい証明は、メールなしで通す（人だけ通すときは email を見る）', async () => {
  assert.deepEqual(await verifyAccessJwt(await jwt(machine()), { teamDomain: TEAM, aud: AUD }), { ok: true, email: null, service: 'abc123.access' });
});
test('別の受付宛て・別のチーム・期限切れ・誰か分からない証明・署名違い・設定なし・ヘッダなしは通さない', async () => {
  const no = async (token, o = { teamDomain: TEAM, aud: AUD }) => assert.equal((await verifyAccessJwt(token, o)).ok, false);
  await no(await jwt({ ...good(), aud: ['aud-shuho'] }));
  await no(await jwt({ ...good(), iss: 'https://other.cloudflareaccess.com' }));
  await no(await jwt({ ...good(), exp: now() - 1 }));
  await no(await jwt({ ...good(), email: undefined }));   // メールも機械の名前も無い
  const other = await newKeys();
  await no(await jwt(good(), { key: other.privateKey }));
  await no(await jwt(good(), { kid: 'unknown' }));
  await no(await jwt(good()), { teamDomain: TEAM, aud: '' });
  await no(null); await no('a.b'); await no('');
});
test('鍵の入れ替えの直後でも通す（使い回している公開鍵の一覧に無い鍵なら、取り直す）', async () => {
  await verifyAccessJwt(await jwt(good()), { teamDomain: TEAM, aud: AUD });   // k1 の一覧を手元に持った状態
  const k2 = await newKeys();
  served = [await publicJwk(keys, 'k1'), await publicJwk(k2, 'k2')];
  try {
    assert.equal((await verifyAccessJwt(await jwt(good(), { kid: 'k2', key: k2.privateKey }), { teamDomain: TEAM, aud: AUD })).ok, true);
  } finally { served = [await publicJwk(keys, 'k1')]; }
});

// ---------- 門番（accessGate）。週報 Worker の api/ の前に置く（docs/slides-role.md §6 の 2）----------
const ORIGIN = 'https://samplechurch-shuho.example.workers.dev';
const O = { teamDomain: TEAM, aud: AUD, publicPaths: ['public/'] };
const req = (path, { method = 'GET', token, origin = ORIGIN } = {}) =>
  new Request(`${origin}/input-shuho/api/${path}`, { method, headers: token ? { 'cf-access-jwt-assertion': token } : {} });
const gate = (path, opts, o = O) => accessGate(req(path, opts), path, o);

test('門番: 受付の証明が無ければ、読む・書く・歌詞・聖書のどれも 403 で断る', async () => {
  for (const [path, method] of [['bootstrap', 'GET'], ['week/2026-10-25', 'GET'], ['export', 'GET'], ['files/hymns/1.pptx', 'GET'], ['bible?ref=ヨハネ3:16', 'GET'], ['save', 'POST'], ['sync/object/church.json', 'PUT'], ['publish', 'POST']]) {
    const g = await gate(path, { method });
    assert.equal(g.ok, false, `${method} ${path}`);
    assert.equal(g.response.status, 403);
    assert.match((await g.response.json()).error, /受付/);
  }
});
test('門番: 人の証明はメールを添えて通し、機械（サービストークン）の証明もメールなしで通す', async () => {
  assert.deepEqual(await gate('bootstrap', { token: await jwt(good()) }), { ok: true, email: 'tanto@example.com' });
  assert.deepEqual(await gate('engine', { token: await jwt(machine()) }), { ok: true, email: null });
});
test('門番: 正しくない証明・確かめる値が無いときは断る（受付を作り直して AUD が変わったときも）', async () => {
  const wrong = await gate('bootstrap', { token: await jwt({ ...good(), aud: ['aud-old'] }) });
  assert.equal(wrong.ok, false); assert.equal((await wrong.response.json()).reason, 'この受付宛ての証明ではありません');
  assert.equal((await gate('bootstrap', { token: await jwt(good()) }, { ...O, aud: '' })).ok, false);
  assert.equal((await gate('bootstrap', { token: await jwt(good()) }, { ...O, teamDomain: undefined })).ok, false);
});
test('門番: サイトが読む public/ は GET だけ証明なしで通す', async () => {
  assert.deepEqual(await gate('public/current'), { ok: true, email: null });
  assert.equal((await gate('public/current', { method: 'POST' })).ok, false);
  assert.equal((await gate('bootstrap', {}, { ...O, publicPaths: [] })).ok, false);
});
test('門番: 手元（wrangler dev の localhost）は受付が無いので通す。ほかの宛先は通さない', async () => {
  for (const origin of ['http://localhost:8788', 'http://127.0.0.1:8788', 'http://[::1]:8788']) assert.equal((await gate('save', { method: 'POST', origin })).ok, true, origin);
  for (const origin of ['https://preview-samplechurch-shuho.example.workers.dev', 'https://www.example.com', 'http://localhost.example.com']) assert.equal((await gate('save', { method: 'POST', origin })).ok, false, origin);
});
