// 題を入れてよい幅（fit-policy.json の _title_width_px）が、紙面の 8 か所の題の欄のうち一番狭い欄の幅と同じか（どの欄にも収まる幅か）。
// 8 か所とも、縮小をこの幅で判定しているか。手元の Chromium（Playwright）で紙面を組んで測る。ブラウザが起動できない環境では飛ばす
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, loadData, readTemplate, getBrowser, closeBrowser } from '../src/lib/render.mjs';
import { buildHtml } from '../src/lib/html.mjs';

test('題を入れてよい幅は、8 か所の題の欄の一番狭い幅', async (t) => {
  let browser; try { browser = await getBrowser(); } catch (e) { t.skip('Chromium を起動できない: ' + e.message); return; }
  try {
    const week = JSON.parse(readFileSync(resolve(root, 'data/examples/weeks/2026-07-26.json'), 'utf8'));
    const who = { id: 'x', display: '山田太郎牧師' };
    Object.assign(week.morning, { sermon_title: '題', preacher: who });
    week.afternoon = { ...(week.afternoon || {}), sermon_title: '題', presider_preacher: who, suspended: false };
    week.wednesday = { ...(week.wednesday || {}), sermon_title: '題', presider_preacher: who };
    week.sunday_school = { ...(week.sunday_school || {}), title: '題' };
    week.next_week = { morning: { sermon_title: '題' }, afternoon: { sermon_title: '題', suspended: false }, sunday_school: { title: '題', suspended: false }, youth: { title: '題', suspended: false } };
    const tpl = resolve(root, 'src/template'), tmp = resolve(tpl, `.rendered-test-${process.pid}.html`);
    writeFileSync(tmp, buildHtml(readTemplate(), await loadData(week)));   // テンプレと同じ場所に置くので <base> は要らない（renderPdfHtml と同じ）
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(tmp).href); await page.waitForFunction(() => window.__rendered === true);
      const got = await page.evaluate(() => [...document.querySelectorAll('.val[data-fit="title"]')].map(v => ({ label: v.dataset.fitLabel, width: v.clientWidth, fitWidth: Number(v.dataset.fitWidth) })));
      const px = JSON.parse(readFileSync(resolve(tpl, 'fit-policy.json'), 'utf8'))._title_width_px;
      assert.deepEqual(got.map(g => g.label).sort(), ['主日の説教題', '午後の説教題', '本日の JJS の題', '本日の中高科の題', '次週の JJS の題', '次週の中高科の題', '次週の主日の説教題', '次週の午後の説教題', '水曜の説教題'].sort());
      for (const g of got) { assert.equal(g.fitWidth, px, `${g.label} の判定の幅`); assert.ok(g.width >= px, `${g.label} の欄（${g.width}px）が ${px}px より狭い`); }
      assert.equal(Math.min(...got.map(g => g.width)), px, '一番狭い欄の幅と同じ');
    } finally { await page.close(); unlinkSync(tmp); }
  } finally { await closeBrowser(); }
});
