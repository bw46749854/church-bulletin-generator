// ⑤ 確かめ（docs/pptx-template.md §6）。作るとき（build.mjs）と、テンプレを差し替えるとき（管理画面）の両方で使う
import { SERVICES, GROUPS, knownMarker, markerAllowed } from './vocab.mjs';
import { paragraphTexts, markersIn } from './pptx.mjs';

/** テンプレが約束どおりでないこと（作らない理由）。画面はこの文をそのまま出す（通信の失敗などとは分ける） */
export class TemplateError extends Error { constructor(message) { super(message); this.name = 'TemplateError'; } }

const COLOR = /^#?([0-9A-Fa-f]{6})$/;
const ENTRY_KEYS = new Set(['部品', '曲', '聖句']);
const PART_NAME = /^[\p{L}\p{N}_-]+$/u;
export const validPartName = (name) => PART_NAME.test(name);

/** 背景.json の文字 → {背景色: 'RRGGBB'|null, 文字色: {基本, 強調}}。約束どおりでなければ Error */
export function parseColors(text) {
  let o; try { o = JSON.parse(text); } catch (e) { throw new TemplateError(`背景.json が JSON として読めません（${e.message}）`); }
  const keys = Object.keys(o || {});
  if (keys.length !== 2 || !keys.includes('背景色') || !keys.includes('文字色')) throw new TemplateError('背景.json は「背景色」と「文字色」の 2 つだけを書きます');
  const color = (v, what) => { const m = String(v ?? '').match(COLOR); if (!m) throw new TemplateError(`背景.json の${what}が 6 桁の色コードではありません: ${JSON.stringify(v)}`); return m[1].toUpperCase(); };
  const fc = o.文字色 || {};
  if (Object.keys(fc).length !== 2 || !('基本' in fc) || !('強調' in fc)) throw new TemplateError('背景.json の文字色は「基本」と「強調」の 2 つだけを書きます');
  return { 背景色: o.背景色 === null ? null : color(o.背景色, '背景色'), 文字色: { 基本: color(fc.基本, '文字色.基本'), 強調: color(fc.強調, '文字色.強調') } };
}

/** 式順の JSON の文字 → 行の配列。形が違えば Error（どの行かを書く） */
export function parseOrder(text, kind) {
  const file = `式順/${kind}.json`;
  let o; try { o = JSON.parse(text); } catch (e) { throw new TemplateError(`${file} が JSON として読めません（${e.message}）`); }
  if (!o || !Array.isArray(o.式順)) throw new TemplateError(`${file} に「式順」の並びがありません`);
  o.式順.forEach((e, i) => {
    const where = `${file} の ${i + 1} 行目`;
    if (!e || typeof e !== 'object' || typeof e.部品 !== 'string' || !e.部品) throw new TemplateError(`${where}: 「部品」がありません`);
    const extra = Object.keys(e).filter(k => !ENTRY_KEYS.has(k));
    if (extra.length) throw new TemplateError(`${where}: 書けない項目があります（${extra.join('、')}）。書けるのは 部品・曲・聖句 だけ`);
  });
  return o.式順;
}

/** 部品（openPptx の結果）の目印の名前 */
export const partMarkers = (part) => new Set(part.slides.flatMap(s => markersIn(paragraphTexts(s.xml).join('\n'))));

/** 目印が書式（run）の境目をまたいでいる所。入れた文字は最初の文字の書式になる（差し替えのときの注意） */
export function splitMarkers(part) {
  const out = [];
  for (const s of part.slides) for (const p of s.xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []) {
    const runs = (p.match(/<a:r>[\s\S]*?<\/a:r>/g) || []).map(r => (r.match(/<a:t>([\s\S]*?)<\/a:t>/) || [])[1] || '');
    for (const m of runs.join('').matchAll(/\{\{[^{}]*\}\}/g)) if (!runs.some(r => r.includes(m[0]))) out.push(m[0]);
  }
  return out;
}

/** 背景.pptx（openPptx の結果）の確かめ。@returns {string[]} 作れない理由 */
export function checkBackground(bg) {
  return bg.slides.length === 1 ? [] : [`背景.pptx のスライドは 1 枚にします（いま ${bg.slides.length} 枚）`];
}

/**
 * 式順と部品の突き合わせ
 * @param {string} kind
 * @param {{部品, 曲?, 聖句?}[]} order
 * @param {Map<string, Set<string>|undefined>} markers  部品名 → 目印（部品が無ければ undefined）
 * @param {{markers?: boolean}} [opt]  markers: 目印がその礼拝で使えるかも見る（差し替えのとき。作るときは展開で注意を出すので見ない）
 * @returns {{errors: string[], warnings: string[]}}  errors があれば、その礼拝は作れない
 */
export function checkOrder(kind, order, markers, opt = {}) {
  const svc = SERVICES[kind]; const errors = [], warnings = [];
  order.forEach((e, i) => {
    const where = `式順/${kind}.json の ${i + 1} 行目（${e.部品}）`;
    const ms = markers.get(e.部品);
    if (!ms) { errors.push(`${where}: 部品「${e.部品}」がありません`); return; }
    const uses = (g) => [...ms].some(n => n.startsWith(g + '.'));
    for (const g of ['曲', '聖句']) {
      if (e[g] != null && !svc[g].includes(e[g])) errors.push(`${where}: ${g}「${e[g]}」は${svc.name}にありません（${svc[g].join('・') || 'なし'}）`);
      if (uses(g) && e[g] == null) errors.push(`${where}: 部品に${g}の目印があるので、「${g}」を書きます`);
      if (e[g] != null && !uses(g)) warnings.push(`${where}: 「${g}」がありますが、部品に${g}の目印がありません`);
    }
    if (opt.markers) for (const n of ms) {
      if (!knownMarker(n)) warnings.push(`${where}: 目印 {{${n}}} は表にありません`);
      else if (!markerAllowed(kind, n)) warnings.push(`${where}: 目印 {{${n}}} は${svc.name}では使えません`);
    }
  });
  return { errors, warnings };
}

/** 出来上がりのスライドに残った目印の名前 */
export const leftovers = (xmls) => [...new Set(xmls.flatMap(x => markersIn(paragraphTexts(x).join('\n'))))];
export { GROUPS };
