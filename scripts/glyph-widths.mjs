// 紙面のフォント（IPA P明朝）の字幅表を作る：入力画面の「入るか」の表示（src/ui/titlefit.mjs）が使う。ARCHITECTURE.md §14.7
//   node scripts/glyph-widths.mjs        → src/ui/glyph-widths.json を書き直す
// 表の形: { font, upm, default, w: {字: 字幅}, bmp: base64, extra: [コードポイント…] }
//   字幅はフォントの単位（upm で 1 字分）。default（漢字など）と違う字だけ w に持つ。
//   フォントにある字は、BMP（U+0000〜FFFF）を 1 字 1 ビットの表（base64）で、それより上は extra に並べる（フォントにない字は別の字体で印字される）
// このフォントは字の間を詰める情報（GPOS・kern）を持たないので、行の幅は字幅の足し算で決まる（入力画面と PDF で同じ値になる）
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FONT = 'src/fonts/ipamp.ttf';
export const OUT = 'src/ui/glyph-widths.json';

/** TrueType の cmap（format 4・12）と hmtx から、文字 → 字幅 を読む */
export function readWidths(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = {};
  for (let i = 0, n = v.getUint16(4); i < n; i++) { const o = 12 + i * 16; tables[String.fromCharCode(...buf.subarray(o, o + 4))] = v.getUint32(o + 8); }
  for (const t of ['head', 'hhea', 'hmtx', 'cmap']) if (tables[t] == null) throw new Error(`${t} がありません`);
  const upm = v.getUint16(tables.head + 18), nHM = v.getUint16(tables.hhea + 34);
  const adv = (g) => v.getUint16(tables.hmtx + 4 * Math.min(g, nHM - 1));
  const cmap = new Map();   // コードポイント → グリフ
  const c = tables.cmap, subs = [];
  for (let i = 0, n = v.getUint16(c + 2); i < n; i++) subs.push({ pid: v.getUint16(c + 4 + i * 8), eid: v.getUint16(c + 6 + i * 8), off: c + v.getUint32(c + 8 + i * 8) });
  const pick = subs.find(s => s.pid === 3 && s.eid === 10 && v.getUint16(s.off) === 12) || subs.find(s => s.pid === 3 && s.eid === 1 && v.getUint16(s.off) === 4);
  if (!pick) throw new Error('Unicode の cmap（format 4/12）がありません');
  const o = pick.off;
  if (v.getUint16(o) === 12) {
    for (let i = 0, n = v.getUint32(o + 12); i < n; i++) {
      const g = o + 16 + i * 12, s = v.getUint32(g), e = v.getUint32(g + 4), g0 = v.getUint32(g + 8);
      for (let cp = s; cp <= e; cp++) cmap.set(cp, g0 + cp - s);
    }
  } else {
    const seg = v.getUint16(o + 6) / 2, ends = o + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
    for (let i = 0; i < seg; i++) {
      const e = v.getUint16(ends + i * 2), s = v.getUint16(starts + i * 2), d = v.getInt16(deltas + i * 2), ro = v.getUint16(ranges + i * 2);
      for (let cp = s; cp <= e && cp !== 0xffff; cp++) {
        let g;
        if (ro === 0) g = (cp + d) & 0xffff;
        else { const at = ranges + i * 2 + ro + (cp - s) * 2; g = v.getUint16(at); if (g) g = (g + d) & 0xffff; }
        if (g) cmap.set(cp, g);
      }
    }
  }
  return { upm, cmap, adv };
}

/** 表にする（漢字の幅を default に、違う字だけ w に、フォントにある字を bmp・extra に） */
export function buildTable(buf) {
  const { upm, cmap, adv } = readWidths(buf);
  const cps = [...cmap.keys()].sort((a, b) => a - b);
  const count = new Map(); for (const cp of cps) { const a = adv(cmap.get(cp)); count.set(a, (count.get(a) || 0) + 1); }
  const dflt = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const w = {}; for (const cp of cps) { const a = adv(cmap.get(cp)); if (a !== dflt) w[String.fromCodePoint(cp)] = a; }
  const bits = new Uint8Array(0x10000 / 8); for (const cp of cps) if (cp <= 0xffff) bits[cp >> 3] |= 1 << (cp & 7);
  return { font: 'IPAPMincho', upm, default: dflt, w, bmp: Buffer.from(bits).toString('base64'), extra: cps.filter(cp => cp > 0xffff) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t = buildTable(readFileSync(resolve(root, FONT)));
  writeFileSync(resolve(root, OUT), JSON.stringify(t) + '\n');
  console.log('wrote', OUT, `（1 字分でない字 ${Object.keys(t.w).length}、BMP より上の字 ${t.extra.length}）`);
}
