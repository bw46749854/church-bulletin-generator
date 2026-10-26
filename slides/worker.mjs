// 担当者用 Worker：/input-shuho/slides/（docs/slides-role.md）。中身は relay.mjs、ここは Cloudflare とのつなぎだけ。
// ページはアセット（dist-slides/、scripts/build-assets.mjs）が返す
import { handleSlides } from './relay.mjs';
import { verifyAccessJwt } from '../src/lib/auth.mjs';

/**
 * 誰か（docs/slides-role.md §6）。受付（Access）を通った要求だけに人が分かる。分からなければ null＝断る。
 * 静的アセット付きの Worker には ctx.access が渡らない（Cloudflare の文書）ので、受付が付ける証明（Cf-Access-Jwt-Assertion）を
 * 自分で確かめる。ctx.access があればそれを使う
 */
async function identify(request, env, ctx) {
  if (ctx.access) { const id = await ctx.access.getIdentity().catch(() => null); if (id?.email) return id.email; }
  const v = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD });
  return v.ok ? v.email : null;
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleSlides(request, { who: await identify(request, env, ctx), shuho: env.SHUHO });
    } catch (e) {
      console.error('slides', request.method, new URL(request.url).pathname, e);
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
  },
};
