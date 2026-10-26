// 担当者用 Worker の中身（docs/slides-role.md §3・§6）。worker.mjs は Cloudflare とのつなぎ（受付で分かった人・内線）だけ。
// データは持たない。/input-shuho/slides/api/<仕事> は、週報 Worker の窓口（SlidesWindow）へ内線で渡す。
// どの仕事を通すかは窓口（src/lib/slides-window.mjs）だけが決める。ここでは選ばない（許可の一覧を 2 か所に持たない）
import { ACTOR_HEADER } from '../src/lib/slides-window.mjs';
import { logClientError } from '../src/lib/client-log.mjs';

export const BASE = '/input-shuho/slides/';
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/**
 * ページ（HTML・JS・CSS）はアセット（dist-slides/）が直接返すので、ここに来るのは / と api/ と、無いファイルだけ。
 * @param {Request} request
 * @param {{who: string|null, shuho: {fetch: (r: Request) => Promise<Response>}}} o
 *   who: 受付（Access）で分かった人のメール。無ければ断る／shuho: 週報 Worker の窓口（内線）
 */
export async function handleSlides(request, { who, shuho }) {
  const url = new URL(request.url);
  if (url.pathname === '/') return Response.redirect(new URL(BASE, url).href, 302);
  if (!url.pathname.startsWith(BASE)) return new Response('not found', { status: 404 });
  const rel = url.pathname.slice(BASE.length);
  if (!rel.startsWith('api/')) return new Response('not found', { status: 404 });
  if (!who) return json({ error: '受付（Access）を通っていないので、受け付けられません' }, 403);
  const path = rel.slice('api/'.length);
  if (path === 'whoami' && request.method === 'GET') return json({ email: who }, 200);   // 画面の「ログイン中」
  if (path === 'client-log' && request.method === 'POST') {   // 画面のエラーはこの Worker のログに残す（週報 Worker へは渡さない）
    logClientError(await request.json().catch(() => ({})), { who });
    return new Response(null, { status: 204 });
  }
  const fwd = new Request(`https://slides.internal/api/${path}${url.search}`, request);
  fwd.headers.set(ACTOR_HEADER, who);   // 誰からの依頼か（ページから同じ名前で送られてきても、受付で分かった人で上書きする）
  return shuho.fetch(fwd);
}
