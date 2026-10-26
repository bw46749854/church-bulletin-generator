// ③ 組み立て（docs/pptx-template.md §1.2・§2・§7）。中身を 1 枚ずつ背景スライドに載せて pptx にする。目印もデータも知らない
import { OutDeck } from './pptx.mjs';

/**
 * @param {object} o
 * @param {*} o.JSZip
 * @param {Uint8Array} o.background  背景.pptx（スライド 1 枚）
 * @param {{背景色: string|null, 文字色: {基本: string, 強調: string}}} o.colors  背景.json（check.parseColors で整えたもの）
 * @param {{section: string, contents: {shapes: string, src: object|null}[]}[]} o.groups  式順の行ごとの中身。行ごとにセクションになる（中身の無い行は出さない）
 * @returns {Promise<{pptx: Uint8Array|null, count: number, xmls: string[]}>}  スライドが 1 枚も無ければ pptx は null
 */
export async function assemble(o) {
  const deck = await OutDeck.fromBackground(o.JSZip, o.background);
  for (const g of o.groups) {
    if (!g.contents.length) continue;
    deck.section(g.section);
    for (const c of g.contents) await deck.addSlide(c.shapes, c.src, { bgColor: o.colors.背景色, colors: o.colors.文字色 });
  }
  const xmls = deck.out.map(s => s.xml);
  return { count: deck.count, xmls, pptx: deck.count ? await deck.save() : null };
}
