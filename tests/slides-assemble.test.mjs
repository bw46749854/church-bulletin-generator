// スライド生成 ③ 組み立て（src/lib/slides/assemble.mjs・pptx.mjs の OutDeck と recolorText）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { assemble } from '../src/lib/slides/assemble.mjs';
import { recolorText, openPptx } from '../src/lib/slides/pptx.mjs';
import { run, shape, makePptx, slideTexts } from './helpers/pptx.mjs';

const colors = { 背景色: '0000FF', 文字色: { 基本: 'FFFFFF', 強調: 'FFFF00' } };
const content = (...texts) => ({ shapes: shape(2, texts), src: null });
const slidesOf = async (bytes) => { const d = await openPptx(JSZip, bytes); return d; };

test('文字の色の役: 白・テーマの背景 1・黒・色なし → 基本色、黄 → 強調色、ほかの色はそのまま、調整は残す', () => {
  const c = { 基本: '2B2B2B', 強調: 'C2185B' };
  const xml = [run('白'), run('背景1', { color: 'bg1' }), run('黒', { color: '000000' }), run('なし', { color: null }), run('黄', { color: 'FFFF00' }), run('赤', { color: 'FF0000' }),
    '<a:r><a:rPr lang="ja-JP"><a:solidFill><a:schemeClr val="bg1"><a:lumMod val="95000"/></a:schemeClr></a:solidFill></a:rPr><a:t>調整</a:t></a:r>', '<a:r><a:rPr lang="ja-JP"/><a:t>空</a:t></a:r>'].join('');
  const out = recolorText(xml, c);
  const colorOf = (t) => (out.match(new RegExp(`<a:srgbClr val="([0-9A-F]{6})"(?:/>|>(?:(?!</a:r>).)*?</a:srgbClr>)</a:solidFill></a:rPr><a:t>${t}</a:t>`)) || [])[1];
  assert.deepEqual(['白', '背景1', '黒', 'なし', '黄', '赤', '調整', '空'].map(colorOf), ['2B2B2B', '2B2B2B', '2B2B2B', '2B2B2B', 'C2185B', 'FF0000', '2B2B2B', '2B2B2B']);
  assert.match(out, /<a:srgbClr val="2B2B2B"><a:lumMod val="95000"\/><\/a:srgbClr>/);
});
test('中身を背景スライドに 1 枚ずつ載せる。背景.pptx のスライド自体は残らない。中身の無い行は出ない', async () => {
  const background = await makePptx(['']);
  const r = await assemble({ JSZip, background, colors, groups: [{ section: '準備賛美', contents: [content('準備賛美 / 101'), content('1 番')] }, { section: '聖餐式', contents: [] }, { section: '説教', contents: [content('説教')] }] });
  assert.equal(r.count, 3);
  assert.deepEqual(await slideTexts(r.pptx), ['準備賛美 / 101', '1 番', '説教']);
  const d = await slidesOf(r.pptx);
  assert.ok(!d.zip.file('ppt/slides/slide1.xml'), '背景.pptx のスライドは消える');
  const ct = await d.zip.file('[Content_Types].xml').async('string');
  for (const s of d.slides) assert.match(ct, new RegExp(`PartName="/${s.path}"`));
  assert.doesNotMatch(ct, /PartName="\/ppt\/slides\/slide1\.xml"/);
});
test('背景色: 全部のスライドに単色の背景を付ける。null なら背景スライドの背景のまま', async () => {
  const background = await makePptx([''], { bg: '123456' });
  const blue = await slidesOf((await assemble({ JSZip, background, colors, groups: [{ section: 'a', contents: [content('x'), content('y')] }] })).pptx);
  assert.ok(blue.slides.every(s => /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0000FF"\/>/.test(s.xml)));
  const keep = await slidesOf((await assemble({ JSZip, background, colors: { ...colors, 背景色: null }, groups: [{ section: 'a', contents: [content('x')] }] })).pptx);
  assert.match(keep.slides[0].xml, /<a:srgbClr val="123456"\/>/);
});
test('式順の行ごとにセクション（名前と、そのスライド）。背景.pptx にあったセクションは消す', async () => {
  const background = await makePptx([''], { sections: [['古い', [0]]] });
  const d = await slidesOf((await assemble({ JSZip, background, colors, groups: [{ section: '賛美（賛美1）', contents: [content('a'), content('b')] }, { section: '説教', contents: [content('c')] }] })).pptx);
  const secs = [...d.pres.matchAll(/<p14:section name="([^"]+)"[^>]*><p14:sldIdLst>(.*?)<\/p14:sldIdLst>/g)].map(m => [m[1], [...m[2].matchAll(/id="(\d+)"/g)].map(x => +x[1])]);
  assert.deepEqual(secs, [['賛美（賛美1）', [d.slides[0].id, d.slides[1].id]], ['説教', [d.slides[2].id]]]);
  assert.doesNotMatch(d.pres, /古い/);
});
test('背景スライドの図形は全部のスライドの奥に出る（中身の図形は番号をずらして重ねる）。文字色は中身だけ置き換える', async () => {
  const background = await makePptx([shape(5, [run('ロゴ', { color: 'FFFF00' })])]);
  const d = await slidesOf((await assemble({ JSZip, background, colors: { 背景色: null, 文字色: { 基本: '111111', 強調: '222222' } }, groups: [{ section: 'a', contents: [{ shapes: shape(2, [run('本文', { color: 'FFFF00' })]), src: null }] }] })).pptx);
  const x = d.slides[0].xml;
  assert.ok(x.indexOf('ロゴ') < x.indexOf('本文'), '背景の図形が先（奥）');
  assert.deepEqual([...x.matchAll(/<p:cNvPr id="(\d+)"/g)].map(m => +m[1]), [1, 5, 7]);   // 中身の 2 は 5 だけずらす
  assert.match(x, /val="FFFF00"\/><\/a:solidFill><\/a:rPr><a:t>ロゴ/);
  assert.match(x, /val="222222"\/><\/a:solidFill><\/a:rPr><a:t>本文/);
});
test('中身の画像は元のファイルから取り込み、番号を付け替える', async () => {
  const src = new JSZip();
  src.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image3.png"/></Relationships>');
  src.file('ppt/media/image3.png', new Uint8Array([137, 80, 78, 71]));
  const pic = '<p:pic><p:nvPicPr><p:cNvPr id="3" name="pic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId7"/></p:blipFill><p:spPr/></p:pic>';
  const d = await slidesOf((await assemble({ JSZip, background: await makePptx(['']), colors, groups: [{ section: 'a', contents: [{ shapes: pic, src: { zip: src, rels: 'ppt/slides/_rels/slide1.xml.rels' } }] }] })).pptx);
  const rels = await d.zip.file(d.slides[0].path.replace(/slides\/(slide\d+\.xml)/, 'slides/_rels/$1.rels')).async('string');
  const id = d.slides[0].xml.match(/r:embed="(rId\d+)"/)[1];
  assert.match(rels, new RegExp(`Id="${id}" Type="[^"]*/image" Target="\\.\\./media/imported1\\.png"`));
  assert.ok(d.zip.file('ppt/media/imported1.png'));
  assert.match(await d.zip.file('[Content_Types].xml').async('string'), /Extension="png"/);
});
test('スライドが 1 枚も無ければ pptx は作らない', async () => {
  const r = await assemble({ JSZip, background: await makePptx(['']), colors, groups: [{ section: 'a', contents: [] }] });
  assert.equal(r.pptx, null); assert.equal(r.count, 0);
});
