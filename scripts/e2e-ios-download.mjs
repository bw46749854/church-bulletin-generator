// iOS（iPhone・iPad）の Safari のダウンロードの特性を手元の Chromium で真似て、入力画面の保存・表示・ダウンロードを確かめる。
// 使い方: node scripts/e2e-ios-download.mjs [入力画面の URL]   （既定 http://localhost:8787/input-shuho/。開発サーバを先に起動しておく）
//
// 真似る特性（2026-10-22 に iPhone の Safari 27.0.1 で確認。WebKit Bug 220621。ARCHITECTURE.md §4.8）:
//   1. ページがダウンロードを始めると「ダウンロードしますか？」の確認が出る。答えるまでの間にページが始めた通信は失敗する
//      （モジュールの読み込み・PDF.js の worker の読み込み・fetch のどれも）
//   2. 確認が出ている間に次のダウンロードを始めると、先のダウンロードは消える（確認は最後の 1 つだけ出る）
//   3. PDF など Safari が表示できる種類のファイルは、download 属性があっても確認なしに同じタブで開く（WebKit Bug 263608。2026-10-23 確認）
//      → 渡すファイルの種類が application/octet-stream になっているかを数える（種類を伏せると確認が出て、名前どおりに保存される）
// 手元の Chromium にはこの確認がないので、<a download> が押された時刻から PROMPT_MS の間を「確認中」とみなし、
// その間に届いた要求を失敗させ、その間に始まったダウンロードは先のものを「消えた」と数える。
//
// 試験は保存の流れの約束を確かめる: 保存は保存だけ（自動のダウンロードなし）、保存後の表示に通信が要らない、
// ダウンロードは利用者が押した 1 回につき 1 つで、その後に通信を始めない。
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libs = resolve(root, '.local-libs/usr/lib/x86_64-linux-gnu');   // WSL2 の Ubuntu で Chromium に足りないライブラリ（docs/OPERATIONS.md）
if (existsSync(libs)) process.env.LD_LIBRARY_PATH = [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

const BASE = process.argv[2] || 'http://localhost:8787/input-shuho/';
const PROMPT_MS = 2500;   // 確認が出ている時間（利用者が「ダウンロード」を押すまで）
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

/**
 * iOS の特性を真似たページを開く。戻り値の log に、失敗させた要求・ダウンロードの記録が溜まる。
 * o.fail: { match: 正規表現, times: n } 合う要求を最初の n 回だけ失敗させる（PDF.js の用意の最中に確認が出た、を真似る。
 *         worker は本物が読めないと PDF.js が同じファイルを読み直す（fake worker）ので、2 回落とすと用意が失敗する）
 * o.engine: PDF エンジンを「眠る」（Render）扱いにし、api/engine の返事をこの関数で決める（n 回目 → 'abort' | 返事の JSON）
 */
async function openPage(browser, o = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const log = { clicks: [], aborted: [], downloads: [], errors: [], clientLogs: [], engineCalls: 0, pdfjs: [] };
  // <a download> が押された瞬間を node 側に知らせる（Playwright の download イベントは遅れて届き、直後の要求の判定に間に合わない）
  await ctx.exposeBinding('__dlClick', (_src, name, type) => {
    const now = Date.now(), prev = log.clicks.at(-1);
    if (prev && now - prev.at < PROMPT_MS) prev.lost = true;   // 特性 2
    log.clicks.push({ name, type, at: now, lost: false, opened: type !== 'application/octet-stream' });   // 特性 3: 種類を伏せていなければ同じタブで開いてしまう
  });
  await ctx.addInitScript(() => {
    const types = new Map(), mk = URL.createObjectURL;
    URL.createObjectURL = function (b) { const u = mk.call(URL, b); types.set(u, b && b.type); return u; };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) window.__dlClick(this.download, types.get(this.href) ?? ''); return click.call(this); };
  });
  const pending = (t) => log.clicks.some(c => t >= c.at - 20 && t < c.at + PROMPT_MS);
  let failed = 0;
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname + url.search, t = Date.now();
    await new Promise(r => setTimeout(r, 60));   // 押された知らせが要求より遅れて届く分を待つ
    if (pending(t)) { log.aborted.push(path); return route.abort('aborted'); }   // 特性 1
    if (url.pathname.includes('/vendor/pdfjs/')) log.pdfjs.push(path);
    if (o.fail && o.fail.match.test(url.pathname) && failed < o.fail.times) { failed++; log.aborted.push(path + '（用意の最中の確認を真似て）'); return route.abort('aborted'); }
    if (url.pathname.endsWith('/api/client-log')) log.clientLogs.push(route.request().postDataJSON());
    if (o.engine && url.pathname.endsWith('/api/bootstrap')) { const res = await route.fetch(); const j = await res.json(); return route.fulfill({ response: res, json: { ...j, engine_sleeps: true } }); }
    if (o.engine && url.pathname.endsWith('/api/engine')) { const a = o.engine(++log.engineCalls); return a === 'abort' ? route.abort('aborted') : route.fulfill({ json: a }); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('download', d => log.downloads.push(d.suggestedFilename()));
  page.on('pageerror', e => log.errors.push(String(e.message || e)));
  await page.goto(BASE);
  await page.waitForFunction(() => /保存済み/.test(document.querySelector('#save-state')?.textContent || ''), null, { timeout: 30000 });
  return { ctx, page, log };
}
const notice = (page, key) => page.locator(`#notices [data-key="${key}"] .msg`).textContent({ timeout: 1000 }).catch(() => null);
const waitQuiet = (ms = PROMPT_MS + 500) => new Promise(r => setTimeout(r, ms));   // 確認に答え終わるまで待つ
async function pressSave(page) {
  await page.click('#btn-save');
  await page.waitForFunction(() => !/保存しています/.test(document.querySelector('#save-state')?.textContent || ''), null, { timeout: 60000 });
}
async function openPreviewTab(page) {
  await page.click('.tab[data-tab="t5"]');
  await page.waitForFunction(() => document.querySelectorAll('#pdf-view canvas').length > 0 || document.querySelector('#pdf-view .failed'), null, { timeout: 60000 });
}
const canvases = (page) => page.locator('#pdf-view canvas').count();
const previewTitle = (page) => page.locator('#preview-title').textContent();
const fmtClicks = (log) => log.clicks.map(c => c.name + (c.lost ? '（消えた）' : '') + (c.opened ? `（${c.type || '種類なし'}＝iOS では同じタブで開く）` : '')).join(', ') || 'なし';

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? `\n       ${detail}` : ''}`); }
async function checkSavedShown(page) {
  await openPreviewTab(page);
  const n = await canvases(page), title = await previewTitle(page);
  check('プレビュータブに保存した PDF が出る', n > 0 && /保存済み/.test(title), `ページ ${n}・見出し「${title}」`);
}
async function checkSaveResult(page, log) {
  const save = await notice(page, 'save');
  check('保存の知らせは成功', !!save && /^保存しました/.test(save), `保存: ${save}`);
  check('保存で自動のダウンロードをしない', log.clicks.length === 0, `ダウンロード: ${fmtClicks(log)}`);
  check('確認中に失敗した通信がない', log.aborted.length === 0, log.aborted.join(', '));
}

const scenarios = {
  // iPhone のテスト 1 と同じ: 開いてすぐ、プレビューに触らずに保存
  async 'save-fresh'(browser) {
    const { ctx, page, log } = await openPage(browser);
    await pressSave(page); await waitQuiet();
    await checkSaveResult(page, log);
    await checkSavedShown(page);
    await ctx.close();
  },
  // iPhone のテスト 2・3 と同じ: プレビューを先に開いてから保存
  async 'preview-then-save'(browser) {
    const { ctx, page, log } = await openPage(browser);
    await openPreviewTab(page);
    check('プレビューが出る', (await canvases(page)) > 0);
    await page.click('.tab[data-tab="t1"]');
    await pressSave(page); await waitQuiet();
    await checkSaveResult(page, log);
    await checkSavedShown(page);
    await ctx.close();
  },
  // プレビュータブを開いたまま保存（保存した PDF がその場で描き変わる）
  async 'save-on-preview-tab'(browser) {
    const { ctx, page, log } = await openPage(browser);
    await openPreviewTab(page);
    await pressSave(page); await waitQuiet();
    await checkSaveResult(page, log);
    await page.waitForFunction(() => /保存済み/.test(document.querySelector('#preview-title')?.textContent || '') && document.querySelectorAll('#pdf-view canvas').length > 0, null, { timeout: 30000 }).catch(() => {});
    check('その場で保存した PDF に描き変わる', /保存済み/.test(await previewTitle(page)) && (await canvases(page)) > 0, `見出し「${await previewTitle(page)}」`);
    await ctx.close();
  },
  // 保存の知らせのボタンで PDF と控えを 1 つずつ受け取る（1 回押す → 確認に答える → もう 1 回）
  async 'save-then-files'(browser) {
    const { ctx, page, log } = await openPage(browser);
    await pressSave(page); await waitQuiet();
    await page.click('#notices [data-key="save"] button.act:has-text("PDF を保存")'); await waitQuiet();
    await page.click('#notices [data-key="save"] button.act:has-text("控え（JSON）を保存")'); await waitQuiet();
    const names = log.clicks.map(c => c.name);
    check('押した分だけ 1 つずつダウンロードする', names.length === 2 && names[0].endsWith('.pdf') && names[1].endsWith('.json'), `ダウンロード: ${fmtClicks(log)}`);
    check('消えたダウンロードがない', log.clicks.every(c => !c.lost));
    check('種類を伏せて渡す（iOS で同じタブで開かない）', log.clicks.every(c => !c.opened), `ダウンロード: ${fmtClicks(log)}`);
    check('確認中に失敗した通信がない', log.aborted.length === 0, log.aborted.join(', '));
    await ctx.close();
  },
  // プレビュー欄の「PDF を保存」（表示している PDF をそのまま渡す）
  async 'viewer-download'(browser) {
    const { ctx, page, log } = await openPage(browser);
    await openPreviewTab(page);
    await page.waitForLoadState('networkidle');   // 人は PDF を見てから押す。描いた直後の「今日の生成回数」（落ちても実害なし）と重ねない
    await page.click('#btn-pdf-download'); await waitQuiet();
    check('プレビュー欄から PDF を 1 つ受け取る', log.clicks.length === 1 && log.clicks[0].name.endsWith('.pdf'), `ダウンロード: ${fmtClicks(log)}`);
    check('種類を伏せて渡す（iOS で同じタブで開かない）', log.clicks.every(c => !c.opened), `ダウンロード: ${fmtClicks(log)}`);
    check('確認中に失敗した通信がない', log.aborted.length === 0, log.aborted.join(', '));
    await ctx.close();
  },
  // 週のメニューから、保存済みの PDF と控えを受け取る（サーバーから受け取ってからダウンロード）
  async 'menu-export'(browser) {
    const { ctx, page, log } = await openPage(browser);
    for (const id of ['#btn-export-pdf', '#btn-export-json']) {
      await page.click('#btn-week'); await page.click(id);
      await waitQuiet();
    }
    const names = log.clicks.map(c => c.name);
    check('メニューから PDF と控えを 1 つずつ受け取る', names.length === 2 && names[0].endsWith('.pdf') && names[1].endsWith('.json'), `ダウンロード: ${fmtClicks(log)}`);
    check('種類を伏せて渡す（iOS で同じタブで開かない）', log.clicks.every(c => !c.opened), `ダウンロード: ${fmtClicks(log)}`);
    check('確認中に失敗した通信がない', log.aborted.length === 0, log.aborted.join(', '));
    await ctx.close();
  },
  // PDF.js の用意の最中に確認が出て、用意が失敗した → 保存は成功し、プレビュータブを開いたときに用意をやり直して表示する
  async 'prepare-failed'(browser) {
    const { ctx, page, log } = await openPage(browser, { fail: { match: /pdf\.worker\.min\.mjs$/, times: 2 } });
    await waitQuiet(1500);
    await pressSave(page); await waitQuiet();
    const save = await notice(page, 'save');
    check('保存の知らせは成功', !!save && /^保存しました/.test(save), `保存: ${save}`);
    await checkSavedShown(page);
    check('やり直しは URL を変えて読み込む', log.pdfjs.some(p => /\?retry=1$/.test(p)), `PDF.js の要求: ${log.pdfjs.join(', ')}`);
    check('用意の失敗を記録に送る', log.clientLogs.some(l => l.where === 'pdf-prepare'), `記録: ${log.clientLogs.map(l => l.where).join(', ') || 'なし'}`);
    await ctx.close();
  },
  // エンジン（Render）の確認の通信が落ちても、故障扱いにしない（確認中に 10 分ごとの確認が重なった、を真似る）
  async 'engine-network'(browser) {
    const ready = { ready: true, current: { engine: 'local', version: 'test' } };
    const { ctx, page, log } = await openPage(browser, { engine: (n) => (n === 1 ? ready : n <= 3 ? 'abort' : ready) });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // 裏から戻った → 確かめ直す（10 分たっていないので起きない）
    // 1 回目（開いたとき）は準備完了。2・3 回目を落とすために、確かめ直しを 2 回起こす
    await page.evaluate(() => { const o = Date.now; Date.now = () => o() + 11 * 60 * 1000; document.dispatchEvent(new Event('visibilitychange')); });
    await waitQuiet(12000);
    const failedTab = await page.locator('#tab-preview.failed').count();
    check('通信の失敗ではエンジンを「失敗」にしない', failedTab === 0, `api/engine を ${log.engineCalls} 回（2・3 回目を落とした）`);
    await pressSave(page); await waitQuiet();
    const save = await notice(page, 'save');
    check('そのまま保存できる', !!save && /^保存しました/.test(save), `保存: ${save}`);
    await ctx.close();
  },
  // 残す範囲（新しい方から n 週。§4.6）を超えて消える週を知らせる。開発サーバを RETAIN_WEEKS=2 で起動したときだけ
  async 'prune'(browser) {
    const { ctx, page, log } = await openPage(browser);
    const retain = await page.evaluate(async () => (await (await fetch('api/bootstrap')).json()).retain_weeks);
    if (!retain) { console.log('     （開発サーバが無制限なので飛ばす。RETAIN_WEEKS=2 で起動すると試す）'); await ctx.close(); return; }
    const before = await page.evaluate(async () => (await (await fetch('api/bootstrap')).json()).weeks);
    await pressSave(page); await waitQuiet(800);
    const save = await notice(page, 'save');
    const expectGone = before.slice(0, Math.max(0, before.length - retain));
    check('保存で消えた週を知らせる', !!save && /^保存しました/.test(save) && (expectGone.length === 0 || /サーバーから消えました/.test(save)), `保存: ${save}`);
    const weeks = await page.locator('#week-list button').count();
    check('週の一覧から消えた週を外す', weeks === Math.min(retain, before.length), `一覧 ${weeks} 週`);
    // 新しい週の窓: 保存すると消える週と、その控えのボタン
    await page.click('#btn-week'); await page.click('#btn-new-open');
    await page.fill('#new-date', '2026-10-25');
    const warn = await page.locator('#new-prune').textContent();
    check('作る前に、保存すると消える週を知らせる', /10\/11 の週がサーバーから消えます/.test(warn), warn.replace(/\s+/g, ' ').slice(0, 120));
    await page.click('#new-prune button'); await waitQuiet();
    check('消える週の控えをその場で受け取る', log.clicks.length === 1 && log.clicks[0].name === '2026-10-11.json' && log.aborted.length === 0, `ダウンロード: ${fmtClicks(log)}`);
    await page.fill('#new-date', '2026-10-04');
    check('残す範囲より古い日付だと知らせる', /保存してもサーバーからすぐに消えます/.test(await page.locator('#new-prune').textContent()));
    await page.click('#new-ok');
    await page.waitForFunction(() => /まだ保存していません/.test(document.querySelector('#save-state')?.textContent || ''), null, { timeout: 30000 });
    await pressSave(page); await waitQuiet(800);
    const gone = await notice(page, 'save');
    check('保存した週自身が消えたら、そう知らせてファイルを渡す', /サーバーからすぐに消えました/.test(gone || '') && (await page.locator('#notices [data-key="save"] button.act').count()) === 2, `保存: ${gone}`);
    check('その週は「まだ保存していません」に戻る', /まだ保存していません/.test(await page.locator('#save-state').textContent()));
    await ctx.close();
  },
};

const browser = await chromium.launch();
try {
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only && !only.includes(name)) continue;
    console.log(`\n== ${name}`);
    try { await fn(browser); } catch (e) { check(`${name} が最後まで動く`, false, String(e.message || e).split('\n')[0]); }
  }
} finally { await browser.close(); }
const ng = results.filter(r => !r.ok).length;
console.log(`\n${results.length - ng} / ${results.length} OK`);
process.exit(ng ? 1 : 0);
