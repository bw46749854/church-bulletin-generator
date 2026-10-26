// PDF エンジン（Render のコンテナで動かす）。HTML を受けて Chromium で PDF にして返す。Worker から合言葉付きで呼ばれる。
//   POST /pdf   ヘッダ x-pdf-secret（環境変数 PDF_SECRET と一致必須）、本文 HTML → PDF。応答ヘッダ x-overflow, x-pdf-engine: render/<Chromium の版>
//   GET  /health → {engine:'render', version:'128.0.6613.137'}（眠りから起こす用。合言葉不要）
// Chromium は Chrome for Testing の指定ビルド（Dockerfile の ARG CHROME）。Cloudflare Browser Rendering と同じビルド番号に合わせる。
import { createServer } from 'node:http';
import puppeteer from 'puppeteer-core';
import { computeExecutablePath } from '@puppeteer/browsers';

const port = Number(process.env.PORT || 10000);
const secret = process.env.PDF_SECRET || '';
const buildId = process.env.CHROME_VERSION;
const executablePath = process.env.CHROME_PATH || computeExecutablePath({ browser: 'chrome', buildId, cacheDir: process.env.PUPPETEER_CACHE_DIR || '/opt/chrome' });

let browser = null, version = '';
async function getBrowser() {   // 1 つ起こしたまま使う（要求ごとにページだけ作る）
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'] });
  version = String(await browser.version()).replace(/^[^/]*\//, '');
  browser.on('disconnected', () => { browser = null; });
  return browser;
}
async function renderPdf(html, pageHeaders) {
  const page = await (await getBrowser()).newPage();
  try {
    if (pageHeaders) await page.setExtraHTTPHeaders(pageHeaders);   // Access のサービストークン等（呼び出し元が渡す）
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
    return { pdf: Buffer.from(pdf), overflow };
  } finally { await page.close().catch(() => {}); }
}

createServer(async (req, res) => {
  const send = (code, body, headers = {}) => { res.writeHead(code, headers); res.end(body); };
  try {
    if (req.method === 'GET' && req.url === '/health') { await getBrowser(); return send(200, JSON.stringify({ engine: 'render', version }), { 'content-type': 'application/json' }); }
    if (req.method === 'POST' && req.url === '/pdf') {
      if (!secret || req.headers['x-pdf-secret'] !== secret) return send(403, 'forbidden');
      const chunks = []; for await (const c of req) chunks.push(c);
      let pageHeaders = null; try { const h = req.headers['x-page-headers']; if (h) pageHeaders = JSON.parse(decodeURIComponent(h)); } catch { /* 無ければ付けない */ }
      const { pdf, overflow } = await renderPdf(Buffer.concat(chunks).toString('utf8'), pageHeaders);
      return send(200, pdf, { 'content-type': 'application/pdf', 'x-overflow': encodeURIComponent(overflow.join(',')), 'x-pdf-engine': `render/${version}` });
    }
    send(404, 'not found');
  } catch (e) { console.error(e); send(500, JSON.stringify({ error: String(e.message || e) }), { 'content-type': 'application/json' }); }
}).listen(port, async () => {
  console.log(`pdf-server :${port} chrome=${executablePath}`);
  try { await getBrowser(); console.log('Chromium', version); } catch (e) { console.error('Chromium が起きません:', e.message); }
});
