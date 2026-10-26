// ② 部品の展開（docs/pptx-template.md §3・§5.4）。部品 1 つと値から、スライドの中身（図形）を作る。並びも背景も知らない
import { spTreeOf, shapesOf, paragraphTexts, markersIn, fillXml, relsPathOf } from './pptx.mjs';
import { SERVICES, knownMarker } from './vocab.mjs';

const ANNOUNCE_SIZES = [[40, 6000], [70, 5400], [100, 4800], [140, 4000], [200, 3600], [Infinity, 3200]];   // 報告・祈りの対象（これまでと同じ。部品の字の大きさは使わない）
const VERSE_STEPS = [[70, 1], [110, 44 / 54], [160, 36 / 54], [Infinity, 32 / 54]];   // 聖句の本文（部品の大きさを 70 字までの大きさとして縮める）
const pick = (len, table) => table.find(([max]) => len <= max)[1];
const scaleSz = (xml, f) => (f === 1 ? xml : xml.replace(/\bsz="(\d+)"/g, (_, n) => `sz="${Math.round((+n * f) / 100) * 100}"`));

/** 報告・祈りの対象の箱: 文字の長さで大きさを決め、箱の高さをスライドの下端まで伸ばす（これまでの生成と同じ） */
function fitAnnouncement(sp, slideHeight) {
  const len = paragraphTexts(sp).join('\n').length;
  const sized = sp.replace(/\bsz="\d+"/g, `sz="${pick(len, ANNOUNCE_SIZES)}"`);
  return sized.replace(/(<a:xfrm\b[^>]*>\s*<a:off x="\d+" y="(\d+)"\/>\s*<a:ext cx="\d+" cy=")\d+(")/, (all, a, y, b) => `${a}${Math.max(0, slideHeight - 100000 - Number(y))}${b}`);
}

/**
 * 部品 1 つを展開する
 * @param {object} o
 * @param {string} o.name  部品名
 * @param {{slides: {xml: string, path: string}[], zip: *}} o.part  開いた部品（openPptx）
 * @param {{部品: string, 曲?: string, 聖句?: string}} o.entry  式順の行
 * @param {string} o.kind  礼拝
 * @param {object} o.values  makeValues の結果
 * @param {(no: number) => Promise<{slides, zip}|null>} o.hymn  歌詞ファイルを開く（無ければ null）
 * @param {(no: number) => Promise<{slides, zip}|null>} o.reading  交読文ファイルを開く（無ければ null）
 * @param {number} [o.slideHeight]  スライドの高さ（EMU）
 * @returns {Promise<{contents: {shapes: string, src: {zip, rels}|null}[], warnings: string[]}>}
 */
export async function fillPart(o) {
  const { name, part, entry, kind, values } = o;
  const height = o.slideHeight || 5143500;
  const warnings = new Set(); const warn = (t) => warnings.add(t);
  const contents = [];
  const marksOf = (xml) => new Set(markersIn(paragraphTexts(xml).join('\n')));
  const all = new Set(part.slides.flatMap(s => [...marksOf(s.xml)]));
  const has = (g) => [...all].some(n => n === g || n.startsWith(g + '.'));
  const song = entry.曲 != null ? values.曲[entry.曲] : undefined;
  // 値が「なし」なら部品ごと飛ばす（§5.4）
  if (has('曲') && song === null) return { contents, warnings: [] };
  if (has('祈りの対象') && values.祈りの対象 === null) return { contents, warnings: [] };

  const value = (ctx) => (n) => {
    const [g, item] = n.split('.');
    if (g === '曲' && item) return item === '番号' ? (song?.番号 ?? '') : item === '曲名' ? (song?.曲名 ?? '') : '';
    if (g === '聖句' && item) return ctx.group?.[item] ?? '';
    if (g === '報告' && item) return ctx.item ? String(ctx.item[item]) : '';
    if (g === '祈りの対象' && item) return values.祈りの対象 ? String(values.祈りの対象[item]) : '';
    if (Object.hasOwn(values.text, n)) return values.text[n];
    warn(knownMarker(n) ? `部品「${name}」の目印 {{${n}}} は${SERVICES[kind].name}では使えません（空にしました）` : `部品「${name}」の目印 {{${n}}} は表にありません（空にしました）`);
    return '';
  };
  /** スライド 1 枚分の図形を、値で埋めて返す */
  const filled = (xml, ctx = {}) => {
    let tree = spTreeOf(xml);
    tree = tree.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => (/\{\{(?:報告\.本文|祈りの対象\.)/.test(sp) ? fitAnnouncement(fillXml(sp, value(ctx)).xml, height) : sp));
    const verse = ctx.group ? pick(ctx.group.本文.length, VERSE_STEPS) : 1;
    tree = fillXml(tree, value(ctx), (p, names) => (names.includes('聖句.本文') ? scaleSz(p, verse) : p)).xml;
    return shapesOf(tree);
  };
  const addFile = (file, from) => { for (const sl of file.slides.slice(from)) contents.push({ shapes: shapesOf(spTreeOf(sl.xml)), src: { zip: file.zip, rels: relsPathOf(sl.path) } }); };

  for (const s of part.slides) {
    const marks = [...marksOf(s.xml)];
    const own = { zip: part.zip, rels: relsPathOf(s.path) };
    if (marks.includes('曲.歌詞')) {   // 場所: 歌詞ファイルの 2 枚目以降（1 枚目は題のスライドで、題は部品が受け持つ）
      if (song?.番号 != null) { const f = await o.hymn(song.番号); if (f) addFile(f, 1); else warn(`${entry.曲}（${song.番号}）の歌詞ファイルがありません`); }
    } else if (marks.includes('交読文')) {   // 場所: 交読文ファイルの全部（題のスライドも）
      if (values.交読文 != null) { const f = await o.reading(values.交読文); if (f) addFile(f, 0); else warn(`交読文 ${values.交読文} のファイルがありません`); }
    } else if (marks.some(n => n.startsWith('聖句.'))) {   // 繰り返し: 1 枚分ずつ
      const r = values.聖句[entry.聖句] ? await values.聖句[entry.聖句]() : { groups: [], warnings: [] };
      r.warnings.forEach(warn);
      for (const group of r.groups) contents.push({ shapes: filled(s.xml, { group }), src: own });
    } else if (marks.some(n => n.startsWith('報告.'))) {   // 繰り返し: 報告 1 項目 1 枚
      for (const item of values.報告) contents.push({ shapes: filled(s.xml, { item }), src: own });
    } else {
      contents.push({ shapes: filled(s.xml), src: own });
    }
  }
  return { contents, warnings: [...warnings] };
}
