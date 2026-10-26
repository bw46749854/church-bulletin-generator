// ログイン：本人確認は Google（Sign in with Google の ID トークン）、入ってよいかは許可メール一覧で決める。
// 通ったら HMAC 署名付きの Cookie を発行し、以後の API はそれで判定する（使うたびに延長、最長 1 年）。
// Web Crypto だけで書いてあり、Node の dev サーバと Worker で共用。
const COOKIE = 'shuho_session';
const DAY = 86400;
const SLIDE = 30 * DAY;      // Cookie の寿命（使うたびにここまで延長）
const HARD_MAX = 365 * DAY;  // 最初のログインからの上限。超えたら再ログイン
const RENEW_AFTER = 1 * DAY; // 発行から 1 日たっていたら延長し直す（毎回 Set-Cookie しない）

const enc = new TextEncoder();
const b64u = {
  enc: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
};
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64u.dec(s)));

// ---------- RS256 の JWT を公開鍵の一覧（JWKS）で検証する。Google の ID トークンと Cloudflare Access の証明で共用 ----------
const jwksCache = new Map();   // 公開鍵の一覧の URL → { at, keys }（1 時間使い回す）
async function jwks(url, what, fresh = false) {
  const c = jwksCache.get(url);
  if (!fresh && c && Date.now() - c.at < 3600_000 && c.keys.length) return c.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${what}の公開鍵を取得できません: ${r.status}`);
  const keys = (await r.json()).keys || [];
  jwksCache.set(url, { at: Date.now(), keys });
  return keys;
}
/** 署名と期限だけ確かめる。発行元・宛先は呼ぶ側で。@returns {Promise<{ok: true, payload: object} | {ok: false, reason: string}>} */
async function verifyRs256(token, certsUrl, what) {
  const [h, p, sig] = (token || '').split('.');
  if (!h || !p || !sig) return { ok: false, reason: 'トークンの形が不正です' };
  let header, payload;
  try { header = decodeJson(h); payload = decodeJson(p); } catch { return { ok: false, reason: 'トークンを読めません' }; }
  if (header.alg !== 'RS256') return { ok: false, reason: '署名方式が不正です' };
  let key = (await jwks(certsUrl, what)).find(k => k.kid === header.kid);
  if (!key) key = (await jwks(certsUrl, what, true)).find(k => k.kid === header.kid);   // 鍵の入れ替えの直後は、使い回している一覧が古い
  if (!key) return { ok: false, reason: '署名鍵が見つかりません' };
  const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, b64u.dec(sig), enc.encode(`${h}.${p}`))) return { ok: false, reason: '署名が一致しません' };
  if (!(payload.exp > Math.floor(Date.now() / 1000))) return { ok: false, reason: 'トークンの期限が切れています' };
  return { ok: true, payload };
}

// ---------- Google ID トークンの検証 ----------
/** @returns {Promise<{ok: true, email: string} | {ok: false, reason: string}>} */
export async function verifyGoogleIdToken(token, { clientId, certsUrl = 'https://www.googleapis.com/oauth2/v3/certs' }) {
  const v = await verifyRs256(token, certsUrl, 'Google'); if (!v.ok) return v;
  const payload = v.payload;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) return { ok: false, reason: '発行元が Google ではありません' };
  if (payload.aud !== clientId) return { ok: false, reason: 'このアプリ宛てのトークンではありません' };
  if (!payload.email || payload.email_verified !== true) return { ok: false, reason: 'メールアドレスが確認されていません' };
  return { ok: true, email: payload.email.toLowerCase() };
}

// ---------- Cloudflare Access の証明（ヘッダ Cf-Access-Jwt-Assertion）の検証 ----------
// 受付（Access）を通った要求に Cloudflare が付ける。静的アセット付きの Worker には ctx.access が渡らないので、これで人を確かめる
// （docs/slides-role.md §6）。teamDomain: 〜.cloudflareaccess.com、aud: その Worker の受付（Access のアプリ）の AUD
/**
 * 人の証明は email、機械（サービストークン）の証明は service（common_name＝Client ID）を持つ。人だけ通すときは email を見る。
 * @returns {Promise<{ok: true, email: string|null, service: string|null} | {ok: false, reason: string}>}
 */
export async function verifyAccessJwt(token, { teamDomain, aud }) {
  if (!teamDomain || !aud) return { ok: false, reason: '受付の設定（チームのドメイン・AUD）がありません' };
  const v = await verifyRs256(token, `https://${teamDomain}/cdn-cgi/access/certs`, 'Access'); if (!v.ok) return v;
  const payload = v.payload;
  if (payload.iss !== `https://${teamDomain}`) return { ok: false, reason: '発行元がこのチームではありません' };
  if (!(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(aud)) return { ok: false, reason: 'この受付宛ての証明ではありません' };
  const email = payload.email ? String(payload.email).toLowerCase() : null, service = payload.common_name ? String(payload.common_name) : null;
  if (!email && !service) return { ok: false, reason: '誰の証明か分かりません' };
  return { ok: true, email, service };
}

// ---------- セッション Cookie ----------
async function hmacKey(secret) { return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function sign(secret, body) { return b64u.enc(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))); }
export async function makeSession(secret, { email, first }) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64u.enc(enc.encode(JSON.stringify({ email, first: first ?? now, iat: now, exp: Math.min(now + SLIDE, (first ?? now) + HARD_MAX) })));
  return `${body}.${await sign(secret, body)}`;
}
/** @returns {Promise<{email, first, iat, exp} | null>} */
export async function readSession(secret, cookieHeader) {
  const m = (cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64u.dec(sig), enc.encode(body)).catch(() => false);
  if (!ok) return null;
  let s; try { s = decodeJson(body); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (!(s.exp > now) || !(s.first + HARD_MAX > now)) return null;
  return s;
}
export const cookieHeader = (value, { path, maxAge, secure }) =>
  `${COOKIE}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

// ---------- API の前段 ----------
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

/**
 * 受付（Access）の門番（docs/slides-role.md §6 の 2、ARCHITECTURE.md §6）。API の前で受付の証明を確かめ、無ければ断る。
 * 設定画面で受付を外したときに「誰でも入れる」にならず「誰も入れない」で止まるようにする。
 * - 人（メール）でも機械（サービストークン）でも、この受付が出した正しい証明なら通す
 * - publicPaths の GET（サイトが読む public/current。公開してよい情報）は証明なしで通す
 * - 手元（wrangler dev。localhost）には受付が無いので通す。インターネットから Cloudflare を通って来る要求の宛先が localhost に
 *   なることはない（宛先の名前でこの Worker に振り分けられるため。内線でこの入口を呼ぶ Worker も無い。担当者用は SlidesWindow）
 * - 確かめる値（teamDomain・aud）が無い・公開鍵を取れないときも断る
 * @param {Request} request
 * @param {string} path  api/ より後ろ
 * @param {{ teamDomain?: string, aud?: string, publicPaths?: string[] }} o
 * @returns {Promise<{ok: true, email: string|null} | {ok: false, response: Response}>}  email: 人の証明ならそのメール（変更の記録に使う）
 */
export async function accessGate(request, path, o) {
  if (request.method === 'GET' && (o.publicPaths || []).some(p => path.startsWith(p))) return { ok: true, email: null };
  if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)) return { ok: true, email: null };
  const token = request.headers.get('cf-access-jwt-assertion');
  const v = !token ? { ok: false, reason: '受付の証明がありません（受付が外れている）' }
    : await verifyAccessJwt(token, { teamDomain: o.teamDomain, aud: o.aud }).catch(e => ({ ok: false, reason: String(e.message || e) }));
  if (v.ok) return { ok: true, email: v.email };
  console.warn('[受付なし]', request.method, path, v.reason);
  return { ok: false, response: json({ error: '受付（Access）を通っていないので、受け付けられません', reason: v.reason }, 403) };
}

/**
 * API ハンドラを認証で包む。
 * @param {(request: Request, path: string) => Promise<Response>} handler
 * @param {{ clientId?: string, allowed?: string, secret?: string, path: string, certsUrl?: string }} o
 *   clientId が無ければ認証なし（Worker では前の accessGate が守る。開発サーバは手元だけ）。allowed はカンマ区切りの許可メール。path は Cookie の Path（/input-shuho）
 *   publicPaths: ログインが有効でも誰でも読める path の接頭辞（サイトが読む public/current など）
 */
export function withAuth(handler, o) {
  const enabled = !!o.clientId;
  const allowed = new Set((o.allowed || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  const secure = (req) => new URL(req.url).protocol === 'https:';
  return async function (request, path) {
    if (path === 'auth/config' && request.method === 'GET') return json({ enabled, google_client_id: o.clientId || null });
    if (request.method === 'GET' && (o.publicPaths || []).some(p => path.startsWith(p))) return handler(request, path);   // 公開の読み取り
    if (!enabled) return handler(request, path);
    if (!o.secret) return json({ error: 'SESSION_SECRET が設定されていません' }, 500);
    if (path === 'auth/google' && request.method === 'POST') {
      const { credential } = await request.json().catch(() => ({}));
      const v = await verifyGoogleIdToken(credential, { clientId: o.clientId, certsUrl: o.certsUrl });
      if (!v.ok) return json({ error: 'Google でのログインを確認できません：' + v.reason }, 401);
      if (!allowed.has(v.email)) return json({ error: `${v.email} は許可されていません。管理者に追加を依頼してください` }, 403);
      const session = await makeSession(o.secret, { email: v.email });
      return json({ email: v.email }, 200, { 'set-cookie': cookieHeader(session, { path: o.path, maxAge: SLIDE, secure: secure(request) }) });
    }
    if (path === 'auth/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', { path: o.path, maxAge: 0, secure: secure(request) }) });
    }
    const s = await readSession(o.secret, request.headers.get('cookie'));
    if (!s || !allowed.has(s.email)) return json({ error: 'ログインが必要です' }, 401);
    if (path === 'auth/me' && request.method === 'GET') return json({ email: s.email });
    const res = await handler(request, path);
    if (Math.floor(Date.now() / 1000) - s.iat > RENEW_AFTER) {   // 使うたびに延長
      const out = new Response(res.body, res);
      out.headers.append('set-cookie', cookieHeader(await makeSession(o.secret, { email: s.email, first: s.first }), { path: o.path, maxAge: SLIDE, secure: secure(request) }));
      return out;
    }
    return res;
  };
}
