// スライド生成 ② 部品の展開（src/lib/slides/fill.mjs）と、目印の埋め方（src/lib/slides/pptx.mjs の fillParagraph）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { fillParagraph, openPptx } from '../src/lib/slides/pptx.mjs';
import { fillPart } from '../src/lib/slides/fill.mjs';
import { run, shape, makePptx, textOf } from './helpers/pptx.mjs';

const para = (...runs) => `<a:p>${runs.join('')}<a:endParaRPr lang="ja-JP" sz="3200"/></a:p>`;
const open = async (slides) => openPptx(JSZip, await makePptx(slides));
const values = (over = {}) => ({
  text: { 日付: '2026年 10月25日', 説教題: '柔和な者', 説教者: '山田一郎 牧師' },
  曲: { 賛美1: { 番号: 48, 曲名: 'イエスきみは' }, 賛美2: { 番号: null, 曲名: '' }, 聖餐式: null },
  聖句: { 引用聖句: async () => ({ groups: [{ 本文: '短い節', 書名: 'ローマ人への手紙', 章: '3章', 節: '23節' }, { 本文: 'あ'.repeat(120), 書名: '詩篇', 章: '90篇', 節: '' }], warnings: ['聖句を読めません: X1:1'] }) },
  交読文: 16, 報告: [{ 番号: 1, 本文: 'ようこそ' }, { 番号: 2, 本文: '11月の予定\n1日 聖餐式' }],
  祈りの対象: { 番号: 3, 見出し: 'ご年配の方のために', 名前: '一さん' }, ...over,
});
const files = { hymn: async () => null, reading: async () => null };
const fill = async (slides, entry, over = {}, opt = {}) => fillPart({ name: entry.部品, part: await open(slides), entry, kind: 'worship', values: values(over), ...files, ...opt });

test('目印は値に替わり、ほかの run の書式は残る。run をまたぐ目印は最初の run の書式になる', () => {
  const p = para(run('説教題: ', { sz: 2000, color: 'FFFF00' }), run('{{説教'), run('題}}', { sz: 9999 }), run(' です'));
  const r = fillParagraph(p, (n) => ({ 説教題: '柔和な者' })[n]);
  assert.deepEqual(r.names, ['説教題']);
  assert.match(r.xml, /sz="2000">.*?<a:t>説教題: <\/a:t>/);       // 前の run はそのまま
  assert.match(r.xml, /<a:t>柔和な者<\/a:t>/);
  assert.match(r.xml, /sz="9999"><a:solidFill><a:srgbClr val="FFFFFF"\/><\/a:solidFill><\/a:rPr><a:t><\/a:t>/);   // またいだ側の run は空に
  assert.equal(textOf(r.xml), '説教題: 柔和な者 です');
});
test('値に改行があると、同じ書式の段落に分ける。目印の前の文字は 1 行目だけ', () => {
  const r = fillParagraph(para(run('{{報告.番号}}.　{{報告.本文}}', { sz: 4000 })), (n) => ({ '報告.番号': '3', '報告.本文': '11月の予定\n1日 聖餐式' })[n]);
  const ps = r.xml.match(/<a:p>[\s\S]*?<\/a:p>/g);
  assert.equal(ps.length, 2);
  assert.deepEqual(ps.map(textOf), ['3.　11月の予定', '1日 聖餐式']);
  assert.ok(ps.every(p => /sz="4000"/.test(p) && /<a:endParaRPr/.test(p)));
});
test('ふつうのスライド: 目印を埋める。その礼拝で使えない目印・表に無い目印は空にして注意', async () => {
  const r = await fill([shape(2, ['説教', '「{{説教題}}」', '{{説教者}}', '{{司会者}}', '{{午後.何か}}'])], { 部品: '説教' });
  assert.equal(r.contents.length, 1);
  assert.equal(textOf(r.contents[0].shapes), '説教 / 「柔和な者」 / 山田一郎 牧師');
  assert.deepEqual(r.warnings.sort(), ['部品「説教」の目印 {{午後.何か}} は表にありません（空にしました）', '部品「説教」の目印 {{司会者}} は表にありません（空にしました）']);
  const w = await fillPart({ name: '説教', part: await open([shape(2, ['{{祈祷}}'])]), entry: { 部品: '説教' }, kind: 'afternoon', values: values({ text: { 日付: 'x' } }), ...files });
  assert.deepEqual(w.warnings, ['部品「説教」の目印 {{祈祷}} は午後礼拝では使えません（空にしました）']);
});
test('曲: 題は部品、歌詞は歌詞ファイルの 2 枚目以降。番号が空なら題は空欄で歌詞なし。ファイルが無ければ注意', async () => {
  const hymnFile = await open([shape(2, ['48 の題']), shape(2, ['1 番']), shape(2, ['2 番'])]);
  const slides = [shape(2, ['賛美', '{{曲.番号}}', '{{曲.曲名}}']), shape(2, ['{{曲.歌詞}}', '説明'])];
  const r = await fill(slides, { 部品: '賛美', 曲: '賛美1' }, {}, { hymn: async (no) => (no === 48 ? hymnFile : null) });
  assert.deepEqual(r.contents.map(c => textOf(c.shapes)), ['賛美 / 48 / イエスきみは', '1 番', '2 番']);
  assert.ok(r.contents[1].src.zip === hymnFile.zip);   // 歌詞の画像は歌詞ファイルから取り込む
  const blank = await fill(slides, { 部品: '賛美', 曲: '賛美2' });
  assert.deepEqual(blank.contents.map(c => textOf(c.shapes)), ['賛美']);
  assert.deepEqual(blank.warnings, []);
  const missing = await fill(slides, { 部品: '賛美', 曲: '賛美1' });
  assert.deepEqual(missing.warnings, ['賛美1（48）の歌詞ファイルがありません']);
});
test('曲が「なし」（聖餐式が式順に無い）・祈りの対象が空なら、部品ごと飛ばす', async () => {
  const r = await fill([shape(2, ['聖餐式', '{{曲.番号}}']), shape(2, ['{{曲.歌詞}}'])], { 部品: '聖餐式', 曲: '聖餐式' });
  assert.deepEqual(r.contents, []);
  const p = await fill([shape(2, ['{{祈りの対象.番号}}.　{{祈りの対象.見出し}}'])], { 部品: 'ご年配' }, { 祈りの対象: null });
  assert.deepEqual(p.contents, []);
});
test('交読文: 交読文ファイルの全部（題も）。番号が空なら 0 枚', async () => {
  const reading = await open([shape(2, ['交読文 16']), shape(2, ['司会']), shape(2, ['会衆'])]);
  const r = await fill([shape(2, ['{{交読文}}'])], { 部品: '交読文' }, {}, { reading: async (no) => (no === 16 ? reading : null) });
  assert.deepEqual(r.contents.map(c => textOf(c.shapes)), ['交読文 16', '司会', '会衆']);
  assert.deepEqual((await fill([shape(2, ['{{交読文}}'])], { 部品: '交読文' }, { 交読文: null })).contents, []);
});
test('聖句: 1 枚分ずつ複製。本文は長さで縮める（70 字まで部品の大きさ）。読めない箇所の注意を出す', async () => {
  const slide = shape(2, [[run('{{聖句.本文}}', { sz: 5400 }), run('   ', { sz: 5400 })], [run('{{聖句.書名}} {{聖句.章}}{{聖句.節}}', { sz: 3600, color: 'FFFF00' })]]);
  const r = await fill([slide], { 部品: '聖句', 聖句: '引用聖句' });
  assert.deepEqual(r.contents.map(c => textOf(c.shapes).replace(/あ+/, 'あ…')), ['短い節    / ローマ人への手紙 3章23節', 'あ…    / 詩篇 90篇']);
  assert.match(r.contents[0].shapes, /sz="5400"><a:solidFill><a:srgbClr val="FFFFFF"\/><\/a:solidFill><\/a:rPr><a:t>短い節/);
  assert.match(r.contents[1].shapes, /sz="3600"><a:solidFill><a:srgbClr val="FFFFFF"\/><\/a:solidFill><\/a:rPr><a:t>あ/);   // 120 字 → 160 字までの段（54→36pt）
  assert.match(r.contents[1].shapes, /sz="3600"><a:solidFill><a:srgbClr val="FFFF00"/);   // 出典は部品の大きさのまま
  assert.deepEqual(r.warnings, ['聖句を読めません: X1:1']);
});
test('報告: 1 項目 1 枚。字の大きさは長さで決め、箱はスライドの下端まで伸ばす', async () => {
  const r = await fill([shape(2, ['{{報告.番号}}.　{{報告.本文}}'], { y: 400000, cy: 900000 })], { 部品: '報告本文' });
  assert.deepEqual(r.contents.map(c => textOf(c.shapes)), ['1.　ようこそ', '2.　11月の予定 / 1日 聖餐式']);
  assert.ok(!/sz="3200"/.test(r.contents[0].shapes) && /sz="6000"/.test(r.contents[0].shapes));   // 40 字まで 60pt
  assert.match(r.contents[0].shapes, /<a:ext cx="8000000" cy="4643500"\/>/);                       // 5143500 − 100000 − 400000
});
