// 入力画面の「入るか」（src/ui/titlefit.mjs）。題の欄は 8 か所とも同じ幅・同じ縮め方。期待値は本番と同じ Chrome 128 で描いた紙面の結果（2026-10-24）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useGlyphWidths, titleFit } from '../src/ui/titlefit.mjs';

useGlyphWidths(JSON.parse(readFileSync('src/ui/glyph-widths.json', 'utf8')));
const fit = JSON.parse(readFileSync('src/template/fit-policy.json', 'utf8'));

test('1 行に入らない題は「2 行にしてください」', () => {
  const r = titleFit(fit, '悔い改めにふさわしい実を結びなさい', null);
  assert.equal(r.kind, 'over'); assert.match(r.text, /「2 行」にしてください/);
  assert.equal(titleFit(fit, '罪人を招いて、悔い改めさせるため', null).kind, 'over');
});
test('2 行にすると入る（9pt のまま）', () => {
  assert.equal(titleFit(fit, '悔い改めにふさわしい実を結びなさい', 10).kind, '');
  assert.equal(titleFit(fit, 'あなたのみおしえは　私の喜びです', 10).kind, '');   // 行の境目の空白は数えない
});
test('縮めて入るときは、紙面と同じ段を出す', () => {
  assert.equal(titleFit(fit, '求めなさい。そうすれば与えられます', 6).text, '9pt・横 92% に縮めて入ります。');
});
test('改行位置が範囲外なら 1 行として見る。題が空なら何も出さない', () => {
  assert.equal(titleFit(fit, '悔い改めにふさわしい実を結びなさい', 99).kind, 'over');
  assert.deepEqual(titleFit(fit, '', null), { kind: '', text: '' });
});
test('紙面のフォントにない字を知らせる', () => {
  assert.match(titleFit(fit, '主の平和🙂', null).text, /フォントにない字があります（🙂）/);
});
