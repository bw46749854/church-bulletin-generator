// 「データは api/ からだけ渡す」（docs/ARCHITECTURE.md §10 の 7）。静的アセットは Worker のコードを通らずに返るので、
// 受付が外れたら誰でも読める。そこにデータが入っていないことを、実際に組み立てた dist/・dist-slides/ で確かめる。実行: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
let out;
before(() => {
  out = mkdtempSync(join(tmpdir(), 'shuho-assets-'));
  execFileSync(process.execPath, [resolve(root, 'scripts/build-assets.mjs'), out], { stdio: 'ignore' });
});
after(() => rmSync(out, { recursive: true, force: true }));

/** dir の下の全ファイル（dir からの相対パス、区切りは /） */
function files(dir) {
  const walk = (d) => readdirSync(d).flatMap(f => { const p = resolve(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  return walk(dir).map(p => relative(dir, p).split('\\').join('/'));
}

// 置いてよいもの: 画面のプログラム・見た目、紙面の型・ロゴ・フォント、外部の部品（JSZip・PDF.js）。どれもデータを含まない。
// ここに無いファイルができたら失敗する（集める場所を増やすときは、データが入らないことを確かめてからここに足す）
const ALLOWED = {
  dist: [
    /^_headers$/,
    /^input-shuho\/(index\.html|admin\.js|admin\.css)$/,
    /^input-shuho\/relogin\.html$/,   // ログインし直すときに新しいタブで開く（文と、元の画面に知らせる 2 行だけ。ARCHITECTURE.md §6.1）
    /^input-shuho\/ui\/[\w-]+\.mjs$/,
    /^input-shuho\/ui\/glyph-widths\.json$/,   // 紙面のフォントの字幅表（題の欄の「入るか」の表示。データは含まない）
    /^input-shuho\/lib\/(slides|bible|html)\.mjs$/,
    /^input-shuho\/lib\/slides\/[\w-]+\.mjs$/,   // スライド生成の 5 段（コードだけ）
    /^input-shuho\/vendor\/(jszip\.min\.js|pdfjs\/pdf(\.worker)?\.min\.mjs)$/,
    /^shuho-assets\/template\/(index\.html|bulletin\.css|render\.js|fit-policy\.json|version\.txt|logo\.png|church\.png)$/,
    /^shuho-assets\/fonts\/[\w.-]+\.(ttf|txt)$/,
  ],
  'dist-slides': [
    /^_headers$/,
    /^input-shuho\/slides\/(index\.html|slides\.js|slides\.css|admin\.css)$/,
    /^input-shuho\/slides\/ui\/[\w-]+\.mjs$/,
    /^input-shuho\/slides\/ui\/glyph-widths\.json$/,   // ui/ を丸ごと写すので一緒に来る（担当者ページは使わない）
    /^input-shuho\/slides\/lib\/slides\.mjs$/,
    /^input-shuho\/slides\/lib\/slides\/[\w-]+\.mjs$/,
    /^input-shuho\/slides\/vendor\/(jszip\.min\.js|pdfjs\/pdf(\.worker)?\.min\.mjs)$/,
  ],
};

/**
 * データの値（名簿の名前、教会の住所・電話・メール・口座、牧師の連絡先、祈り課題、据え置きの文）。
 * 手元に実データ（data/ 直下。Git の外）があればそれも、無ければ仮名化サンプル（data/examples/）だけを使う
 */
function dataValues() {
  const vals = new Set();
  const read = (f) => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  const strings = (v) => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
  for (const dir of [resolve(root, 'data'), resolve(root, 'data/examples')]) {
    for (const p of read(resolve(dir, 'masters/people.json'))?.people || []) vals.add(p.name);
    const church = read(resolve(dir, 'church.json')) || {};
    for (const k of ['postal', 'address', 'tel_fax', 'email', 'bank_line1', 'bank_line2', 'pastor_contact']) vals.add(church[k]);   // 教会名・教団名・URL は紙面のロゴにもある公開の情報なので除く
    for (const s of strings(read(resolve(dir, 'prayer-list.json')))) vals.add(s);
    for (const s of strings(read(resolve(dir, 'texts.json')))) vals.add(s);
  }
  return [...vals].filter(v => typeof v === 'string').map(v => v.trim()).filter(v => [...v].length >= 3);
}
const TEXT = /(\.(html|js|mjs|css|json|txt)|_headers)$/;
const ours = (f) => !/\/(vendor|fonts)\//.test(`/${f}`);   // 外部の部品とフォント（ライセンス文にメールがある）は形の検査から外す

for (const name of Object.keys(ALLOWED)) {
  test(`${name}: 置いてあるのは、決めた場所のファイルだけ`, () => {
    const extra = files(resolve(out, name)).filter(f => !ALLOWED[name].some(re => re.test(f)));
    assert.deepEqual(extra, [], `許可の一覧に無いファイル（データを入れていないか確かめてから ALLOWED に足す）: ${extra.join(', ')}`);
  });
  test(`${name}: 名簿・教会情報・祈り課題・据え置きの文の値が入っていない`, () => {
    const values = dataValues(); assert.ok(values.length > 10, 'データの値を集められない');
    for (const f of files(resolve(out, name)).filter(f => TEXT.test(f))) {
      const text = readFileSync(resolve(out, name, f), 'utf8');
      const found = values.filter(v => text.includes(v));
      assert.deepEqual(found, [], `${f} にデータの値`);
      if (!ours(f)) continue;
      assert.equal(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0], undefined, `${f} にメールアドレスの形`);
      assert.equal(text.match(/\b0\d{1,4}-\d{1,4}-\d{3,4}\b/)?.[0], undefined, `${f} に電話番号の形`);
    }
  });
}
