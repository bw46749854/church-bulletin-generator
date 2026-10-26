// 本番の PDF エンジン：Cloudflare Browser Rendering（@cloudflare/puppeteer）。
// ローカル（wrangler dev）では PDF_DEV_URL を指定すると Node の dev サーバ（Playwright）に HTML を渡して PDF にしてもらう。
import puppeteer from '@cloudflare/puppeteer';

/** Access のサービストークン（人のログイン無しで通る合言葉）。紙面の CSS・JS・フォントを取りに行くときに付ける */
const accessHeaders = (env) => (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET } : null;

export async function renderPdfHtml(env, html) {
  if (env.PDF_DEV_URL) {
    const r = await fetch(env.PDF_DEV_URL.replace(/\/$/, '') + '/input-shuho/api/_pdf', { method: 'POST', body: html });
    if (!r.ok) throw new Error('PDF_DEV_URL での PDF 生成に失敗: ' + (await r.text()).slice(0, 200));
    const [engine, version] = (r.headers.get('x-pdf-engine') || 'dev/').split('/');
    return { pdf: new Uint8Array(await r.arrayBuffer()), overflow: decodeURIComponent(r.headers.get('x-overflow') || '').split(',').filter(Boolean), engine, version };
  }
  if (env.PDF_ENGINE === 'render') return renderViaRender(env, html);
  if (!env.BROWSER) throw new Error('Browser Rendering のバインディング（BROWSER）がありません');
  const { browser, reused } = await getBrowser(env);
  let page;
  try {
    page = await browser.newPage();
    const extra = accessHeaders(env);
    if (extra) await page.setExtraHTTPHeaders(extra);   // Access の後ろにある /shuho-assets/ を取りに行けるように
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => errors.push(`fetch failed: ${r.url()} ${r.failure()?.errorText || ''}`));
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__rendered === true || window.__error, { timeout: 30000 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error('render error: ' + err);
    if (errors.length) throw new Error('page error: ' + errors.join('; '));
    const overflow = await page.evaluate(() => window.__overflow || []);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const version = String(await browser.version()).replace(/^[^/]*\//, '');   // 'HeadlessChrome/128.0.6613.137' → '128.0.6613.137'
    return { pdf: new Uint8Array(pdf), overflow, engine: 'cloudflare', version, reused };
  } finally { await browser.close().catch(() => {}); }   // すぐ閉じる：Free は 1 日 10 分の枯渇が先に来る（開けたままだと待ち時間も消費）
}

// Render のコンテナ（scripts/pdf-server.mjs）に HTML を渡す。テスト・リハーサル用（上限なし）。眠っていたら起きるまで 30〜60 秒
export async function renderViaRender(env, html) {
  if (!env.PDF_RENDER_URL || !env.PDF_RENDER_SECRET) throw new Error('PDF_ENGINE=render ですが PDF_RENDER_URL / PDF_RENDER_SECRET がありません');
  let r;
  const extra = accessHeaders(env);
  try { r = await fetch(env.PDF_RENDER_URL.replace(/\/$/, '') + '/pdf', { method: 'POST', headers: { 'x-pdf-secret': env.PDF_RENDER_SECRET, 'content-type': 'text/html; charset=utf-8', ...(extra ? { 'x-page-headers': encodeURIComponent(JSON.stringify(extra)) } : {}) }, body: html, signal: AbortSignal.timeout(90000) }); }
  catch (e) { throw new Error('Render の PDF エンジンに接続できません（眠りから起きるのに 1 分ほどかかります。少し待ってやり直してください）: ' + (e.message || e)); }
  if (!r.ok) throw new Error('Render の PDF エンジンが失敗しました: ' + (await r.text()).slice(0, 300));
  const version = (r.headers.get('x-pdf-engine') || 'render/').split('/')[1] || '';
  return { pdf: new Uint8Array(await r.arrayBuffer()), overflow: decodeURIComponent(r.headers.get('x-overflow') || '').split(',').filter(Boolean), engine: 'render', version };
}
/** Render の /health（眠りから起こす・版を知る）。engine=render のときだけ */
export async function renderHealth(env) {
  const r = await fetch(env.PDF_RENDER_URL.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(75000) });
  if (!r.ok) throw new Error('Render /health ' + r.status);
  return r.json();   // {engine:'render', version}
}
/** Cloudflare 側の Chromium の版だけ知る（生成せずに起こして閉じる。数秒の枠を使う） */
export async function cloudflareVersion(env) {
  const { browser } = await getBrowser(env);
  try { return String(await browser.version()).replace(/^[^/]*\//, ''); } finally { await browser.close().catch(() => {}); }
}
// Free プランの上限は「新規ブラウザ 3 回/分」「同時 3」「1 日 10 分（開いている時間で減る）」。
// 前の要求が閉じ損ねたセッションが残っていれば繋ぎ直し、無ければ起こす。keep_alive は付けず、使い終わったら即 close。
// 429 は自動で再試行しない（分の上限なら待つ時間が読めず、日の上限なら待っても無駄）。何が起きたか分かる文で返す。
async function getBrowser(env) {
  try {
    const sessions = await puppeteer.sessions(env.BROWSER);
    for (const s of sessions.filter(x => !x.connectionId)) {
      try { return { browser: await puppeteer.connect(env.BROWSER, s.sessionId), reused: true }; } catch { /* 取られた・閉じた → 次へ */ }
    }
  } catch { /* 一覧が取れなくても起こせばよい */ }
  try { return { browser: await puppeteer.launch(env.BROWSER), reused: false }; }
  catch (e) {
    if (/429|Rate limit/i.test(String(e.message || e))) throw new Error('PDF 作成の上限に当たりました。1 日の合計（10 分）を使い切っていれば日本時間 9 時まで作れません。直前 1 分に 3 回作っていただけなら、1 分待てば作れます');
    throw e;
  }
}
