// 題が紙面の欄に入るか（入力画面の「入るか」の表示。ARCHITECTURE.md §14.7）。
// 紙面（src/template/render.js の fitAll）と同じ縮小の手順を、フォントの字幅表（glyph-widths.json）で計算する。
// このフォントは字の間を詰める情報を持たないので、行の幅は字幅の足し算で決まり、PDF と同じ結果になる。
// 題を入れてよい幅と縮小の規則は fit-policy.json（_title_width_px、title・title_2line）。8 か所とも同じ（ARCHITECTURE.md §5.2）
const PX_PER_PT = 96 / 72;
let table = null;   // { upm, def, w: Map, bmp: Uint8Array, extra: Set }

/** 字幅表を使えるようにする（入力画面は fetch した JSON、試験はファイルを読んだ JSON を渡す） */
export function useGlyphWidths(j) {
  const bin = typeof atob === 'function' ? Uint8Array.from(atob(j.bmp), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(j.bmp, 'base64'));
  table = { upm: j.upm, def: j.default, w: new Map(Object.entries(j.w)), bmp: bin, extra: new Set(j.extra) };
}
export async function loadGlyphWidths(url) { const r = await fetch(url); if (!r.ok) throw new Error(`字幅表 ${r.status}`); useGlyphWidths(await r.json()); }
export const glyphWidthsReady = () => !!table;

const inFont = (cp) => cp <= 0xffff ? !!(table.bmp[cp >> 3] & (1 << (cp & 7))) : table.extra.has(cp);
/** 行の幅（px）。pt は文字の大きさ */
function width(s, pt) {
  let u = 0; for (const ch of s) u += table.w.get(ch) ?? table.def;
  return u / table.upm * pt * PX_PER_PT;
}
/** 縮小の手順を始めから当て、入る最初の段を返す（入らなければ null）。紙面と同じく、横は 0.3px まで許す */
function firstFit(lines, base, steps, px) {
  let pt = base, k = 1;
  const fits = () => Math.max(...lines.map(l => width(l, pt))) * k <= px + 0.3;
  if (fits()) return { pt, k };
  for (const st of steps) {
    const [kind, v] = st.split(':');
    if (kind === 'scale') k = Number(v); else if (kind === 'font') pt = parseFloat(v); else continue;
    if (fits()) return { pt, k };
  }
  return null;
}

/**
 * @param {object} fit   fit-policy.json（入力画面は boot.fit）
 * @param {string} title 題
 * @param {number|null} brk  改行位置（1 行目の字数）。null なら 1 行
 * @returns {{kind: ''|'shrink'|'over', text: string}}  kind: '' そのまま入る／shrink 縮めて入る／over 入らない
 */
export function titleFit(fit, title, brk) {
  const px = fit && fit._title_width_px;
  if (!table || !px || !fit.title || !fit.title_2line || !title) return { kind: '', text: '' };
  const cs = [...title], two = Number.isInteger(brk) && brk >= 1 && brk < cs.length;
  const lines = two ? ['「' + cs.slice(0, brk).join('').trimEnd(), '「' + cs.slice(brk).join('').trimStart() + '」'] : ['「' + title + '」'];   // 2 行目の頭の「は見えない字（そろえる分の幅）
  const got = two ? firstFit(lines, 9, fit.title_2line.steps, px) : firstFit(lines, 10, fit.title.steps, px);
  const missing = [...new Set(cs.filter(ch => !/\s/.test(ch) && !inFont(ch.codePointAt(0))))];
  const miss = missing.length ? `紙面のフォントにない字があります（${missing.join('')}）。別の字体で印字されます。` : '';
  if (!got) return { kind: 'over', text: (two ? '2 行でも入りません。題を短くするか、改行の位置を変えてください。' : '1 行に入りません。「2 行」にしてください。') + miss };
  const base = two ? 9 : 10;
  if (got.pt === base && got.k === 1) return { kind: miss ? 'shrink' : '', text: miss };
  return { kind: 'shrink', text: `${got.pt}pt・横 ${Math.round(got.k * 100)}% に縮めて入ります。` + miss };
}
