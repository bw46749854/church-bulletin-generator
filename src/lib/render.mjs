// ローカル（Node）用：Playwright（Chromium）で HTML → PDF。CLI と dev サーバで共用。本番の Worker は worker/pdf.mjs（Browser Rendering）。
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildHtml } from './html.mjs';
import { fsStore } from './store-fs.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tpl = resolve(root, 'src/template');
const localLibs = resolve(root, '.local-libs/usr/lib/x86_64-linux-gnu');
if (existsSync(localLibs)) process.env.LD_LIBRARY_PATH = [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

export const readTemplate = () => readFileSync(resolve(tpl, 'index.html'), 'utf8');
export const config = () => JSON.parse(readFileSync(resolve(root, 'data/config.json'), 'utf8'));
export const fitPolicy = () => JSON.parse(readFileSync(resolve(tpl, 'fit-policy.json'), 'utf8'));
export const store = fsStore(root);

/** CLI 用：運用データ（無ければ examples）を集めて buildHtml に渡す形にする */
export async function loadData(week) {
  const get = async (k) => { const t = await store.get(k); if (t == null) throw new Error(`data/${k} がありません`); return JSON.parse(t); };
  return { week, config: { ...config(), church: await get('church.json') }, people: await get('masters/people.json'),
    hymns: await get('masters/hymns.json'), readings: await get('masters/readings.json'), prayer: await get('prayer-list.json'), fit: fitPolicy() };
}

/** outDir に保存する用の中間 HTML。<base> を outDir から見た src/template/ への相対パスにする */
export function buildHtmlFor(data, outDir, opts = {}) {
  const base = relative(outDir, tpl).split(sep).join('/') + '/';
  return buildHtml(readTemplate(), data, { ...opts, baseHref: base });
}

let browser = null;
let launching = null;
export async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (!launching) {
    launching = chromium.launch({ args: ['--disable-gpu'] })
      .then(b => { b.on('disconnected', () => { if (browser === b) browser = null; }); browser = b; return b; })
      .catch(e => { throw new Error('Chromium を起動できません: ' + e.message.split('\n')[0] + '（README の「不足ライブラリ」を確認してください）'); })
      .finally(() => { launching = null; });
  }
  return launching;
}
export async function closeBrowser() { if (browser) { const b = browser; browser = null; await b.close().catch(() => {}); } }

/** 描画前 HTML → PDF。@returns {Promise<{pdf: Uint8Array, overflow: string[]}>} */
export async function renderPdfHtml(html) {
  let page;
  try { page = await (await getBrowser()).newPage(); }
  catch (e) {              // ブラウザが落ちていたら1回だけ起動し直す
    await closeBrowser();
    page = await (await getBrowser()).newPage();
  }
  try {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // file:// のサブリソース（css/js/フォント）を読ませるため、テンプレと同じ場所に一時ファイルとして置く
    const tmp = resolve(tpl, `.rendered-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    writeFileSync(tmp, html);
    try { await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' }); } finally { try { unlinkSync(tmp); } catch {} }
    await page.waitForFunction(() => window.__rendered === true || window.__error, null, { timeout: 20000 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error('render error: ' + err);
    if (errors.length) throw new Error('page error: ' + errors.join('; '));
    const overflow = await page.evaluate(() => window.__overflow || []);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const version = String(await (await getBrowser()).version()).replace(/^[^/]*\//, '');
    return { pdf: new Uint8Array(pdf), overflow, engine: 'local', version };
  } finally { await page.close(); }
}

/** 週データ → PDF（CLI 用のまとめ） */
export async function renderPdf(week, opts = {}) {
  const data = await loadData(week);
  const { pdf, overflow } = await renderPdfHtml(buildHtml(readTemplate(), data, { font: opts.font }));
  return { pdf, overflow, data };
}
