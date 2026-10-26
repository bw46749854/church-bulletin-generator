// ④ 式順（docs/pptx-template.md §1.3・§4）。式順の JSON を読み、行ごとに部品を展開（②）して、背景に載せる（③）。
// 牧師の画面・担当者ページ（ブラウザ）と検証用の CLI（Node）で同じコード。素材はすべて getFile(キー) で受け取る
import { openPptx } from './pptx.mjs';
import { makeValues } from './values.mjs';
import { fillPart } from './fill.mjs';
import { assemble } from './assemble.mjs';
import { SERVICES } from './vocab.mjs';
import { parseColors, parseOrder, partMarkers, checkOrder, checkBackground, leftovers, TemplateError } from './check.mjs';

/** テンプレ一式のファイルの名前（api/files/<名前>。今の版は目次で決まる。docs/file-store.md） */
export const TEMPLATE_KEYS = {
  background: 'template/背景.pptx',
  colors: 'template/背景.json',
  order: (kind) => `template/式順/${kind}.json`,
  part: (name) => `template/部品/${name}.pptx`,
};

/**
 * 礼拝 1 つ分のスライドを作る
 * @param {object} o
 * @param {'worship'|'afternoon'|'wednesday'|'other'} o.kind
 * @param {*} o.JSZip
 * @param {(key: string) => Promise<Uint8Array|null>} o.getFile  テンプレ一式・歌詞・交読文（無ければ null）
 * @param {object} o.week @param {object} o.people @param {object} o.hymnsMaster @param {object} o.config
 * @param {number|string|null} [o.prepHymn]  準備賛美の番号
 * @param {(ref: string) => Promise<object|null>} o.lookup  聖句
 * @returns {Promise<{pptx: Uint8Array|null, warnings: string[]}>}  作れないとき（テンプレが約束どおりでない）は TemplateError
 */
export async function buildSlides(o) {
  const svc = SERVICES[o.kind]; if (!svc) throw new Error(`礼拝の名前が違います: ${o.kind}`);
  const text = (b) => new TextDecoder().decode(b);
  const need = async (key, what) => { const b = await o.getFile(key); if (!b) throw new TemplateError(`${what}（${key}）がありません`); return b; };
  const [bgBytes, colorBytes, orderBytes] = await Promise.all([
    need(TEMPLATE_KEYS.background, '背景'), need(TEMPLATE_KEYS.colors, '色の設定'), need(TEMPLATE_KEYS.order(o.kind), `${svc.name}の式順`)]);
  const colors = parseColors(text(colorBytes));
  const order = parseOrder(text(orderBytes), o.kind);
  const bg = await openPptx(o.JSZip, bgBytes);
  const bgErrors = checkBackground(bg); if (bgErrors.length) throw new TemplateError(bgErrors.join('\n'));
  const parts = new Map();
  for (const name of new Set(order.map(e => e.部品))) { const b = await o.getFile(TEMPLATE_KEYS.part(name)); parts.set(name, b ? await openPptx(o.JSZip, b) : null); }
  const { errors, warnings } = checkOrder(o.kind, order, new Map([...parts].map(([n, p]) => [n, p ? partMarkers(p) : undefined])));
  if (errors.length) throw new TemplateError(errors.join('\n'));

  const values = await makeValues(o);
  const warn = new Set([...warnings, ...values.warnings]);
  const opened = new Map();
  const openFile = async (key) => { if (!opened.has(key)) { const b = await o.getFile(key); opened.set(key, b ? await openPptx(o.JSZip, b) : null); } return opened.get(key); };
  const groups = [];
  for (const entry of order) {
    const r = await fillPart({ name: entry.部品, part: parts.get(entry.部品), entry, kind: o.kind, values, slideHeight: bg.height,
      hymn: (no) => openFile(`hymns/${no}.pptx`), reading: (no) => openFile(`readings/${no}.pptx`) });
    r.warnings.forEach(w => warn.add(w));
    const v = entry.曲 ?? entry.聖句;
    groups.push({ section: v && v !== entry.部品 ? `${entry.部品}（${v}）` : entry.部品, contents: r.contents });
  }
  const out = await assemble({ JSZip: o.JSZip, background: bgBytes, colors, groups });
  for (const n of leftovers(out.xmls)) warn.add(`出来上がりに目印 {{${n}}} が残りました（背景スライドか歌詞・交読文のファイルに書いてあります）`);
  if (!out.pptx) warn.add('作るスライドがありません（聖書・引用聖句・賛美の番号などが入っていません）');
  return { pptx: out.pptx, warnings: [...warn] };
}
