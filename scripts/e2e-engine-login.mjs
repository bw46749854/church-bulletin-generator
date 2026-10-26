// PDF の準備中・失敗・受付のログイン切れのときの保存・プレビューの知らせを、手元の Chromium で確かめる（ARCHITECTURE.md §14.1・§14.2・§6.1）。
// 使い方: node scripts/e2e-engine-login.mjs [入力画面の URL]   （既定 http://localhost:8787/input-shuho/。開発サーバを先に起動しておく）
// 保存が成功する場面がある（data/weeks を書く）ので、scratchpad の写しで起動したサーバに流す（README「試験」）。ONLY=名前,… で場面を絞る。
//
// 真似ること:
//   - PDF エンジンが眠る（Render）: api/bootstrap の engine_sleeps を立て、api/engine の返事をこちらで決める
//   - 画面を裏に回していた: 開いてから時計を 15 分進める（最後の返事から 14 分を超え、プレビュー・保存の前に確かめ直す）
//   - 受付（Cloudflare Access）のログインの期限切れ: 切れている間の api/ は、X-Requested-With が付いていれば 401
//     （www-authenticate: Cloudflare-Access）、付いていなければ別のドメインへの 302（fetch は追って失敗する）。
//     ここまでは 2026-10-24 に本番の受付で確かめた返事の形。ページを開くとログイン画面になり、そこで「ログイン」すると元の URL に戻る
//     （本物は受付のドメインへ回してから戻すが、Playwright は転送先を横取りできないので、同じ URL でログイン画面を返す）
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libs = resolve(root, '.local-libs/usr/lib/x86_64-linux-gnu');   // WSL2 の Ubuntu で Chromium に足りないライブラリ（README）
if (existsSync(libs)) process.env.LD_LIBRARY_PATH = [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

const BASE = process.argv[2] || 'http://localhost:8787/input-shuho/';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const ELSEWHERE = 'http://127.0.0.1:9/login';   // 受付のログイン画面（別のドメイン）の代わり。fetch が追うと接続できずに失敗する

/**
 * o.engine: api/engine の n 回目の返事を決める（'abort' | 返事の JSON）。1 回目は開いたとき
 * 戻り値の auth.expired を true にすると、受付のログインが切れた状態になる
 */
async function openPage(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const log = { engineCalls: 0, errors: [], noXrw: [], pages: [] };
  const auth = { expired: false, logins: 0 };
  await ctx.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/__login') { auth.expired = false; auth.logins++; return route.fulfill({ body: 'ok' }); }   // 受付のログイン画面で「ログイン」を押した
    if (url.pathname.includes('/api/') && req.headers()['x-requested-with'] !== 'XMLHttpRequest') log.noXrw.push(url.pathname);
    if (auth.expired) {
      if (req.headers()['x-requested-with'] === 'XMLHttpRequest') return route.fulfill({ status: 401, contentType: 'text/html', headers: { 'www-authenticate': 'Cloudflare-Access resource_metadata="x"' }, body: '<html>401 Unauthorized</html>' });
      if (req.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>受付</title><button id="login">ログイン</button><script>document.getElementById("login").onclick = async () => { await fetch("/__login"); location.reload(); };</script>' });
      return route.fulfill({ status: 302, headers: { location: ELSEWHERE } });
    }
    if (url.pathname.endsWith('/api/bootstrap') && o.engine) { const res = await route.fetch(); const j = await res.json(); return route.fulfill({ response: res, json: { ...j, engine_sleeps: true, estimates: { ...j.estimates, wake_ms: 22000 } } }); }
    if (url.pathname.endsWith('/api/engine') && o.engine) {
      const a = o.engine(++log.engineCalls);
      if (a === 'abort') return route.abort('failed');
      await new Promise(r => setTimeout(r, log.engineCalls === 1 ? 0 : 1500));   // 起きるのを待つ間（「準備中」の知らせが見える）
      return route.fulfill({ json: a });
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  ctx.on('page', (p) => log.pages.push(p));
  page.on('pageerror', e => log.errors.push(String(e.message || e)));
  await page.clock.install();
  await page.goto(BASE);
  await page.waitForFunction(() => /保存済み/.test(document.querySelector('#save-state')?.textContent || ''), null, { timeout: 30000 });
  return { ctx, page, log, auth };
}
const READY = { ready: true, current: { engine: 'render', version: '128.0.6613.137' }, production: null, mismatch: false, error: null, waited_ms: 0, estimates: { wake_ms: 22000 } };
const DOWN = { ready: false, current: null, production: null, mismatch: false, error: 'Render /health 502', waited_ms: 75000, estimates: { wake_ms: 22000 } };
const notice = (page, key) => page.locator(`#notices [data-key="${key}"] .msg`).textContent({ timeout: 1000 }).catch(() => null);
const notices = (page) => page.$$eval('#notices .notice', ns => ns.map(n => `[${n.dataset.key}] ${n.querySelector('.msg').textContent}`));
const tabText = (page) => page.evaluate(() => { const p = document.querySelector('#eng-progress'); return p.hidden ? '' : p.querySelector('.pg-text').textContent; });
const waitFor = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
async function edit(page) {   // 入力を 1 つ変える（未保存の変更を作る）
  await page.click('.tab[data-tab="t1"]');
  const input = page.locator('input[name="service_name"]'); await input.fill((await input.inputValue()) + '（試験）');
}
const away = (page) => page.clock.setSystemTime(Date.now() + 15 * 60 * 1000);   // 裏に回していた（タイマーは動かさず、時刻だけ進める）

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? `\n       ${detail}` : ''}`); }

const scenarios = {
  // 押したときは準備中 → エンジンが応答しない。知らせは 1 つで、失敗に置き換わる（2026-10-24 の食い違い）
  async 'engine-down'(browser) {
    const { ctx, page } = await openPage(browser, { engine: (n) => n === 1 ? READY : DOWN });
    await edit(page); await away(page);
    await page.click('#btn-save');
    const first = await notice(page, 'engine');
    check('押したときは「準備中」。残りの秒数は書かない', /PDF の準備中です（ふだん約 22 秒）/.test(first || '') && !/あと約/.test(first || ''), first);
    await waitFor(page, () => /できませんでした/.test(document.querySelector('#notices [data-key="engine"] .msg')?.textContent || ''));
    const all = await notices(page);
    check('失敗に置き換わる（知らせは 1 つ）', all.length === 1 && /^\[engine\] 保存していません。PDF の準備ができませんでした（PDF エンジンが応答しません）。入力は画面に残っています/.test(all[0]), all.join(' / '));
    check('タブも同じことを言う', (await tabText(page)) === 'PDF の準備ができませんでした（押すとやり直し）', await tabText(page));
    check('未保存のまま', /未保存/.test(await page.textContent('#save-state')), await page.textContent('#save-state'));
    await ctx.close();
  },
  // 通信が 4 回続けて届かない。エンジンのせいにしない
  async 'engine-net'(browser) {
    const { ctx, page } = await openPage(browser, { engine: (n) => n === 1 ? READY : 'abort' });
    await edit(page); await away(page);
    await page.click('#btn-save');
    await page.clock.runFor(20000);   // 確かめ直し（3・6・9 秒後）を待つ
    await waitFor(page, () => /通信できません/.test(document.querySelector('#notices [data-key="engine"] .msg')?.textContent || ''), null, 10000);
    const all = await notices(page);
    check('通信の失敗として知らせる（知らせは 1 つ）', all.length === 1 && /^\[engine\] 保存していません。通信できません（インターネットの接続を確かめてください）/.test(all[0]), all.join(' / '));
    check('タブは「通信できません」', (await tabText(page)) === '通信できません（押すとやり直し）', await tabText(page));
    await ctx.close();
  },
  // 裏に回している間にログインが切れた → 戻って保存（2026-10-24 の事象そのもの）→ 新しいタブでログインし直す → 元の画面で保存できる
  async 'login-save'(browser) {
    const { ctx, page, log, auth } = await openPage(browser, { engine: () => READY });
    await edit(page); const typed = await page.inputValue('input[name="service_name"]');
    await away(page); auth.expired = true;
    await page.click('#btn-save');
    await waitFor(page, () => !!document.querySelector('#notices [data-key="login"]'), null, 10000);
    let all = await notices(page);
    check('ログイン切れとして知らせる（「PDF の準備」は言わない。知らせは 1 つ）', all.length === 1 && /^\[login\] ログインの期限が切れました。保存していない入力は、この画面に残っています/.test(all[0]), all.join(' / '));
    check('タブに「準備できませんでした」を出さない', !/できません/.test(await tabText(page)), await tabText(page));
    await page.click('#btn-save');   // もう一度押しても同じ知らせ（増えない）
    await page.waitForTimeout(800); all = await notices(page);
    check('もう一度押しても知らせは 1 つ', all.length === 1 && /^\[login\]/.test(all[0]), all.join(' / '));
    const opened = ctx.waitForEvent('page');
    await page.click('#notices [data-key="login"] button.act:has-text("ログインし直す")');
    const tab = await opened; await tab.waitForSelector('#login', { timeout: 10000 });
    check('新しいタブは受付のログイン画面になる', (await tab.title()) === '受付', tab.url());
    await tab.click('#login');
    await waitFor(page, () => /もう一度「保存」を押してください/.test(document.querySelector('#notices [data-key="engine"] .msg')?.textContent || ''), null, 10000);
    all = await notices(page);
    check('ログインできたら、元の画面の知らせが「もう一度保存」に変わる', all.length === 1 && /^\[engine\] PDF の準備ができました。もう一度「保存」を押してください/.test(all[0]), all.join(' / '));
    await waitFor(page, () => true); await new Promise(r => setTimeout(r, 2500));
    check('新しいタブは自分で閉じる', tab.isClosed());
    check('入力は残っている', (await page.inputValue('input[name="service_name"]')) === typed);
    await page.click('#btn-save');
    await waitFor(page, () => /^保存しました/.test(document.querySelector('#notices [data-key="save"] .msg')?.textContent || ''), null, 60000);
    check('保存できる', /保存済み/.test(await page.textContent('#save-state')), await page.textContent('#save-state'));
    check('API の要求にはすべて X-Requested-With が付く', log.noXrw.length === 0, log.noXrw.join(', '));
    check('画面のエラーがない', log.errors.length === 0, log.errors.join(' / '));
    await ctx.close();
  },
  // 準備は済んでいて、保存の要求そのものが受付で止められる（PDF エンジンが眠らない場合も同じ）。この画面が前に出たら確かめ直す
  async 'login-direct'(browser) {
    const { ctx, page, log, auth } = await openPage(browser);   // engine を真似ない＝眠らないエンジン（手元）
    await edit(page); auth.expired = true;
    await page.click('#btn-save');
    await waitFor(page, () => !!document.querySelector('#notices [data-key="login"]'), null, 10000);
    const all = await notices(page);
    check('保存の失敗ではなく、ログイン切れとして知らせる', all.length === 1 && /^\[login\]/.test(all[0]), all.join(' / '));
    auth.expired = false;   // 利用者が自分で別のタブを開いてログインした
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(page, () => /ログインできました。もう一度「保存」を押してください/.test(document.querySelector('#notices [data-key="engine"] .msg')?.textContent || ''), null, 10000);
    const after = await notices(page);
    check('前に出たら確かめ直して「もう一度保存」', after.length === 1 && /^\[engine\] ログインできました。もう一度「保存」を押してください/.test(after[0]), after.join(' / '));
    check('画面のエラーがない', log.errors.length === 0, log.errors.join(' / '));
    await ctx.close();
  },
};

const browser = await chromium.launch();
try {
  for (const [name, run] of Object.entries(scenarios)) {
    if (only && !only.includes(name)) continue;
    console.log(`\n== ${name}`);
    try { await run(browser); } catch (e) { check(`${name} が最後まで動く`, false, String(e.stack || e)); }
  }
} finally { await browser.close(); }
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
