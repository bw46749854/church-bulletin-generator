// スライド生成 ④ 式順と ⑤ 確かめ（src/lib/slides/build.mjs・check.mjs）。小さなテンプレ一式をその場で作って通す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildSlides, TEMPLATE_KEYS } from '../src/lib/slides/build.mjs';
import { parseColors, parseOrder, splitMarkers, checkOrder } from '../src/lib/slides/check.mjs';
import { openPptx } from '../src/lib/slides/pptx.mjs';
import { run, shape, makePptx, slideTexts } from './helpers/pptx.mjs';

const enc = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
const week = {
  date: '2026-10-25',
  morning: { preacher: { display: '山田一郎牧師' }, sermon_title: '柔和な者', hymns: [48, null, null], program: [] },
  announcements: { lead: 'ようこそ', body: [] }, slides: { sermon_refs: ['ローマ3:23'] },
};
const lookup = async (ref) => (ref === 'ローマ3:23' ? { book: { id: 45, name: 'ローマ人への手紙', short: 'ローマ', testament: 2 }, parsed: { chapter: 3, verse: 23 }, verses: [{ chapter: 3, verse: 23, text: 'すべての人は罪を犯して' }] } : null);
async function templateSet(over = {}) {
  const files = new Map(Object.entries({
    [TEMPLATE_KEYS.background]: await makePptx(['']),
    [TEMPLATE_KEYS.colors]: enc({ 背景色: '0000FF', 文字色: { 基本: 'FFFFFF', 強調: 'FFFF00' } }),
    [TEMPLATE_KEYS.order('worship')]: enc({ 式順: [{ 部品: '準備賛美', 曲: '準備賛美' }, { 部品: '説教' }, { 部品: '聖句', 聖句: '引用聖句' }, { 部品: '聖餐式', 曲: '聖餐式' }, { 部品: '賛美', 曲: '賛美1' }, { 部品: '報告本文' }, { 部品: 'ご年配' }] }),
    [TEMPLATE_KEYS.part('準備賛美')]: await makePptx([shape(2, ['準備賛美', '{{曲.番号}}', '{{曲.曲名}}']), shape(2, ['{{曲.歌詞}}'])]),
    [TEMPLATE_KEYS.part('賛美')]: await makePptx([shape(2, ['賛美', '{{曲.番号}}', '{{曲.曲名}}']), shape(2, ['{{曲.歌詞}}'])]),
    [TEMPLATE_KEYS.part('聖餐式')]: await makePptx([shape(2, ['聖餐式', '{{曲.番号}}']), shape(2, ['{{曲.歌詞}}'])]),
    [TEMPLATE_KEYS.part('説教')]: await makePptx([shape(2, ['説教', '「{{説教題}}」', '{{説教者}}'])]),
    [TEMPLATE_KEYS.part('聖句')]: await makePptx([shape(2, ['{{聖句.本文}}', [run('{{聖句.書名}} {{聖句.章}}{{聖句.節}}', { color: 'FFFF00' })]])]),
    [TEMPLATE_KEYS.part('報告本文')]: await makePptx([shape(2, ['{{報告.番号}}.　{{報告.本文}}'])]),
    [TEMPLATE_KEYS.part('ご年配')]: await makePptx([shape(2, ['{{祈りの対象.番号}}.　{{祈りの対象.見出し}}'])]),
    'hymns/48.pptx': await makePptx([shape(2, ['48 の題']), shape(2, ['48 の 1 番'])]),
    'hymns/101.pptx': await makePptx([shape(2, ['101 の題']), shape(2, ['101 の 1 番'])]),
    ...over,
  }));
  return async (key) => files.get(key) ?? null;
}
const build = async (o = {}) => buildSlides({ kind: 'worship', JSZip, getFile: await templateSet(o.files), week: o.week || week, people: { people: [] }, hymnsMaster: { 48: 'イエスきみは', 101: '主イエスのみ名こそ' }, config: { rules: { wednesday_offset_days: 3 } }, prepHymn: o.prep ?? '101', lookup });

test('式順のとおりに並べる。聖餐式の無い週・祈りの対象の無い週はその部品を飛ばす。行ごとにセクション', async () => {
  const r = await build();
  assert.deepEqual(await slideTexts(r.pptx), ['準備賛美 / 101 / 主イエスのみ名こそ', '101 の 1 番', '説教 / 「柔和な者」 / 山田一郎 牧師', 'すべての人は罪を犯して / ローマ人への手紙 3章23節', '賛美 / 48 / イエスきみは', '48 の 1 番', '1.　ようこそ']);
  assert.deepEqual(r.warnings, []);
  const d = await openPptx(JSZip, r.pptx);
  assert.deepEqual([...d.pres.matchAll(/<p14:section name="([^"]+)"/g)].map(m => m[1]), ['準備賛美', '説教', '聖句（引用聖句）', '賛美（賛美1）', '報告本文']);
});
test('作れないとき（テンプレが約束どおりでない）はエラー。どのファイルの何行目かを書く', async () => {
  await assert.rejects(build({ files: { [TEMPLATE_KEYS.part('説教')]: null } }), (e) => e.name === 'TemplateError' && /式順\/worship\.json の 2 行目（説教）: 部品「説教」がありません/.test(e.message));
  await assert.rejects(build({ files: { [TEMPLATE_KEYS.colors]: null } }), /色の設定（template\/背景\.json）がありません/);
  await assert.rejects(build({ files: { [TEMPLATE_KEYS.colors]: enc({ 背景色: 'blue', 文字色: { 基本: 'FFFFFF', 強調: 'FFFF00' } }) } }), /背景色が 6 桁の色コードではありません/);
  await assert.rejects(build({ files: { [TEMPLATE_KEYS.order('worship')]: enc({ 式順: [{ 部品: '賛美', 曲: '賛美4' }] }) } }), /曲「賛美4」は主日礼拝にありません/);
  await assert.rejects(build({ files: { [TEMPLATE_KEYS.order('worship')]: enc({ 式順: [{ 部品: '賛美' }] }) } }), /部品に曲の目印があるので、「曲」を書きます/);
  await assert.rejects(build({ files: { [TEMPLATE_KEYS.background]: await makePptx(['', '']) } }), /背景\.pptx のスライドは 1 枚にします（いま 2 枚）/);
});
test('出来上がりに残った目印は注意（背景スライドの図形は埋めない）', async () => {
  const r = await build({ files: { [TEMPLATE_KEYS.background]: await makePptx([shape(9, ['{{日付}}'])]) } });
  assert.ok(r.warnings.some(w => /出来上がりに目印 \{\{日付\}\} が残りました/.test(w)));
});
test('背景.json: # はあってもよく、大文字にそろえる。背景色は null 可。項目が違えばエラー', () => {
  assert.deepEqual(parseColors('{"背景色": "#00009f", "文字色": {"基本": "ffffff", "強調": "#FFFF00"}}'), { 背景色: '00009F', 文字色: { 基本: 'FFFFFF', 強調: 'FFFF00' } });
  assert.equal(parseColors('{"背景色": null, "文字色": {"基本": "333333", "強調": "C2185B"}}').背景色, null);
  assert.throws(() => parseColors('{"背景色": "000000", "文字色": {"基本": "FFFFFF"}}'), /基本」と「強調」の 2 つだけ/);
  assert.throws(() => parseColors('{"背景色": "000000"}'), /「背景色」と「文字色」の 2 つだけ/);
});
test('式順の JSON: 書けるのは 部品・曲・聖句 だけ。部品が無い行はエラー', () => {
  assert.throws(() => parseOrder('{"式順": [{"部品": "説教", "背景": "x"}]}', 'worship'), /1 行目: 書けない項目があります（背景）/);
  assert.throws(() => parseOrder('{"式順": [{"曲": "賛美1"}]}', 'worship'), /1 行目: 「部品」がありません/);
  assert.throws(() => parseOrder('{"順": []}', 'other'), /「式順」の並びがありません/);
});
test('差し替えのときの確かめ: 目印がその礼拝で使えるか・表にあるか。書式をまたいだ目印', async () => {
  const r = checkOrder('afternoon', [{ 部品: '表紙' }], new Map([['表紙', new Set(['日付', '司会', 'ふりがな'])]]), { markers: true });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ['式順/afternoon.json の 1 行目（表紙）: 目印 {{司会}} は午後礼拝では使えません', '式順/afternoon.json の 1 行目（表紙）: 目印 {{ふりがな}} は表にありません']);
  const part = await openPptx(JSZip, await makePptx([shape(2, [[run('{{説教'), run('題}}')], '{{日付}}'])]));
  assert.deepEqual(splitMarkers(part), ['{{説教題}}']);
});
