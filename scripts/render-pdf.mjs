// 使い方: node scripts/render-pdf.mjs data/weeks/2026-07-19.json [out/2026-07-19.pdf]
// PDF と同じ名前で中間 HTML（out/2026-07-19.html）も書く。ブラウザで開けば同じ紙面が描画される
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { renderPdf, buildHtmlFor, closeBrowser } from '../src/lib/render.mjs';

const weekPath = resolve(process.argv[2] || 'data/weeks/2026-07-19.json');
const font = process.env.SHUHO_FONT || 'ipa';   // ipa（IPA P明朝、既定）| ipaex（等幅）| biz
const outPdf = resolve(process.argv[3] || `out/${basename(weekPath, '.json')}${font === 'ipa' ? '' : '-' + font}.pdf`);
const week = JSON.parse(readFileSync(weekPath, 'utf8'));
const { pdf, overflow, data } = await renderPdf(week, { font });
mkdirSync(dirname(outPdf), { recursive: true });
writeFileSync(outPdf, pdf);
const outHtml = outPdf.replace(/\.pdf$/, '.html');
writeFileSync(outHtml, buildHtmlFor(data, dirname(outPdf), { font }));
await closeBrowser();
console.log('wrote', outPdf, outHtml, overflow.length ? `OVERFLOW: ${overflow.join(',')}` : '(no overflow)');
