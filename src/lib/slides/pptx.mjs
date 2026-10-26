// pptx の読み書きの部品（スライド生成の ②部品の展開・③組み立てが使う。docs/pptx-template.md）。
// pptx は zip なので JSZip だけで扱う（ブラウザと Node で同じコード。Worker では CPU 制限のため動かさない）

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const RUN = /<a:r>[\s\S]*?<\/a:r>/g;
const runText = (r) => unesc((r.match(/<a:t>([\s\S]*?)<\/a:t>/) || [])[1] || '');
const setRunText = (r, t) => r.replace(/<a:t>[\s\S]*?<\/a:t>|<a:t\/>/, `<a:t>${esc(t)}</a:t>`);
export const relsPathOf = (slidePath) => slidePath.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
export const spTreeOf = (xml) => xml.match(/<p:spTree>[\s\S]*<\/p:spTree>/)[0];
const TREE_HEAD = /^<p:spTree>\s*<p:nvGrpSpPr>[\s\S]*?<\/p:nvGrpSpPr>\s*(?:<p:grpSpPr\/>|<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>)/;
/** spTree の中の図形だけ（グループの見出し nvGrpSpPr・grpSpPr を除いた子） */
export const shapesOf = (tree) => tree.replace(TREE_HEAD, '').replace(/<\/p:spTree>\s*$/, '');
/** スライドの全段落の文字（段落ごと） */
export const paragraphTexts = (xml) => [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map(m => (m[1].match(RUN) || []).map(runText).join(''));
/** 文字の中の目印の名前（{{ と }} の間） */
export const markersIn = (text) => [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map(m => m[1]);

/** pptx を開く。slides は表示順 */
export async function openPptx(JSZip, bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const presFile = zip.file('ppt/presentation.xml'); if (!presFile) throw new Error('pptx として読めません（ppt/presentation.xml が無い）');
  const pres = await presFile.async('string');
  const rels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  const byId = {}; for (const m of rels.matchAll(/<Relationship\b([^>]*)\/>/g)) { const a = m[1]; byId[a.match(/Id="([^"]+)"/)[1]] = a.match(/Target="([^"]+)"/)[1]; }
  const slides = [...pres.matchAll(/<p:sldId [^>]*?id="(\d+)"[^>]*?r:id="(rId\d+)"[^>]*\/>/g)].map(m => ({ id: +m[1], rId: m[2], path: 'ppt/' + byId[m[2]].replace(/^\/?ppt\//, '') }));
  const xmls = await Promise.all(slides.map(s => zip.file(s.path).async('string')));
  slides.forEach((s, i) => { s.xml = xmls[i]; });
  const size = pres.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  return { zip, pres, rels, slides, width: size ? +size[1] : 9144000, height: size ? +size[2] : 5143500 };
}

// ---------- 段落の目印を埋める ----------
const PARA_CHILD = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>|<a:r>[\s\S]*?<\/a:r>|<a:br\b[^>]*\/>|<a:br\b[^>]*>[\s\S]*?<\/a:br>|<a:fld\b[\s\S]*?<\/a:fld>|<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[^>]*>[\s\S]*?<\/a:endParaRPr>/g;
/**
 * 段落 1 つの目印を値で置き換える（docs/pptx-template.md §3.1）。
 * 目印が run（書式の切れ目）をまたいでいても、値は目印の最初の文字の run に入れ、ほかの run からは目印の分だけ削る（ほかの書式はそのまま）。
 * 値に改行があれば、同じ書式の段落に分ける（目印の前の文字は 1 行目にだけ残る）。
 * @param {string} para  <a:p>…</a:p>
 * @param {(name: string) => string} value  目印の名前 → 入れる文字
 * @returns {{xml: string, names: string[]}}  names は置き換えた目印
 */
export function fillParagraph(para, value) {
  const inner = para.slice(5, -6);
  const kids = inner.match(PARA_CHILD) || [];
  const runs = kids.map((k, i) => (k.startsWith('<a:r>') ? i : -1)).filter(i => i >= 0);
  const texts = runs.map(i => runText(kids[i]));
  const all = texts.join('');
  const found = [...all.matchAll(/\{\{([^{}]*)\}\}/g)];
  if (!found.length) return { xml: para, names: [] };
  for (const m of found.reverse()) {   // 後ろから（前の位置がずれないように）
    const from = m.index, to = m.index + m[0].length, neu = value(m[1]);
    let pos = 0, placed = false;
    for (let j = 0; j < texts.length; j++) {
      const s = pos, e = pos + texts[j].length; pos = e;
      if (e <= from || s >= to) continue;
      texts[j] = texts[j].slice(0, Math.max(0, from - s)) + (placed ? '' : neu) + texts[j].slice(Math.max(0, to - s)); placed = true;
    }
    // 次の目印のために位置を合わせ直す必要はない（後ろから置き換えているので、前の目印の位置は変わらない）
  }
  runs.forEach((i, j) => { kids[i] = setRunText(kids[i], texts[j]); });
  const names = found.map(m => m[1]).reverse();
  if (!texts.some(t => t.includes('\n'))) return { xml: `<a:p>${kids.join('')}</a:p>`, names };
  // 改行で段落を分ける
  const pPr = kids.find(k => k.startsWith('<a:pPr')) || '';
  const end = kids.find(k => k.startsWith('<a:endParaRPr')) || '';
  const paras = []; let cur = [];
  for (const k of kids) {
    if (k === pPr || k === end) continue;
    if (!k.startsWith('<a:r>')) { cur.push(k); continue; }
    const parts = runText(k).split('\n');
    cur.push(setRunText(k, parts[0]));
    for (const p of parts.slice(1)) { paras.push(cur); cur = [setRunText(k, p)]; }
  }
  paras.push(cur);
  return { xml: paras.map(c => `<a:p>${pPr}${c.join('')}${end}</a:p>`).join(''), names };
}
/** XML の全段落の目印を埋める。@returns {{xml: string, names: string[]}} */
export function fillXml(xml, value, onParagraph) {
  const names = [];
  const out = xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, (p) => { const r = fillParagraph(p, value); names.push(...r.names); return onParagraph ? onParagraph(r.xml, r.names) : r.xml; });
  return { xml: out, names };
}

// ---------- 文字の色の役（docs/pptx-template.md §2.3） ----------
const TO_BASE = /^(?:srgbClr:(?:FFFFFF|000000)|schemeClr:(?:bg1|lt1|tx1|dk1)|prstClr:(?:white|black)|sysClr:(?:window|windowText))$/i;
const TO_ACCENT = /^(?:srgbClr:FFFF00|prstClr:yellow)$/i;
/**
 * 文字の書式（rPr・endParaRPr・defRPr）の色を役で置き換える。白・黒 → 基本色、黄 → 強調色。
 * 色の指定が無い文字（rPr・endParaRPr）は基本色にする。ほかの色はそのまま。明るさ・透明度などの調整は残す
 * @param {string} xml  図形の XML
 * @param {{基本: string, 強調: string}} c  6 桁の色コード
 */
export function recolorText(xml, c) {
  return xml.replace(/<a:(rPr|endParaRPr|defRPr)\b([^>]*?)(\/>|>([\s\S]*?)<\/a:\1>)/g, (all, tag, attrs, close, inner) => {
    const body = inner ?? '';
    const fill = body.match(/<a:solidFill>\s*<a:(srgbClr|schemeClr|prstClr|sysClr) val="([^"]+)"(?:\s+lastClr="[^"]*")?(\/>|>([\s\S]*?)<\/a:\1>)\s*<\/a:solidFill>/);
    if (fill) {
      const key = `${fill[1]}:${fill[2]}`;
      const to = TO_BASE.test(key) ? c.基本 : TO_ACCENT.test(key) ? c.強調 : null;
      if (!to) return all;
      const mods = fill[4] ?? '';
      return all.replace(fill[0], `<a:solidFill><a:srgbClr val="${to}"${mods ? `>${mods}</a:srgbClr>` : '/>'}</a:solidFill>`);
    }
    if (tag === 'defRPr' || /<a:(?:noFill|gradFill|blipFill|pattFill|grpFill)\b/.test(body)) return all;
    const add = `<a:solidFill><a:srgbClr val="${c.基本}"/></a:solidFill>`;
    if (close === '/>') return `<a:${tag}${attrs}>${add}</a:${tag}>`;
    const ln = body.match(/^\s*<a:ln\b[^>]*\/>|^\s*<a:ln\b[\s\S]*?<\/a:ln>/);   // 子の順番の決まり: ln の次が塗り
    return `<a:${tag}${attrs}>${ln ? ln[0] + add + body.slice(ln[0].length) : add + body}</a:${tag}>`;
  });
}

// ---------- 出来上がりの pptx（背景スライド＋中身） ----------
const MEDIA_TYPE = /\/(image|audio|video|media|hyperlink)$/;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', emf: 'image/x-emf', wmf: 'image/x-wmf', tiff: 'image/tiff', svg: 'image/svg+xml', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4' };
const SECTIONS_EXT = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';
/** セクションの ID（UUID の形）。randomUUID は https でない画面に無いので、どこでも使える getRandomValues で作る */
function guid() {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
}

/**
 * 背景.pptx の背景スライドを土台に、中身（図形）を 1 枚ずつ載せて pptx を作る（docs/pptx-template.md §1.2・§2）。
 * 背景スライドに置いた図形は、どのスライドでも中身の奥に出る。
 */
export class OutDeck {
  /** @param {*} JSZip @param {Uint8Array} bytes 背景.pptx（スライド 1 枚） */
  static async fromBackground(JSZip, bytes) {
    const d = new OutDeck();
    Object.assign(d, await openPptx(JSZip, bytes));
    d.JSZip = JSZip; d.model = d.slides[0];
    d.modelRels = await d.zip.file(relsPathOf(d.model.path)).async('string');
    d.modelShapes = shapesOf(spTreeOf(d.model.xml));
    d.modelMaxId = Math.max(1, ...[...d.model.xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map(m => +m[1]));
    d.out = []; d.sections = []; d.nextNo = Math.max(...Object.keys(d.zip.files).map(f => +(f.match(/^ppt\/slides\/slide(\d+)\.xml$/) || [0, 0])[1])) + 1; d.mediaNo = 1; d.types = new Set();
    return d;
  }
  get count() { return this.out.length; }
  /** セクションを始める（以後のスライドはこのセクションに入る） */
  section(name) { this.sections.push({ name, slides: [] }); }
  /**
   * スライドを 1 枚足す
   * @param {string} shapes  中身の図形（spTree の子）
   * @param {{zip: *, rels: string}|null} src  中身の元の pptx（画像などを取り込む）。null なら取り込まない
   * @param {{bgColor?: string|null, colors?: {基本: string, 強調: string}}} opt  背景色（null なら背景スライドのまま）・文字色
   */
  async addSlide(shapes, src, opt = {}) {
    // 背景スライドの関係（レイアウト・背景の画像など）はそのまま使う。ノートは持ち込まない
    const rels = [...this.modelRels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m => m[0]).filter(r => !/\/notesSlide"/.test(r));
    let maxRid = Math.max(0, ...rels.map(r => +(r.match(/Id="rId(\d+)"/) || [0, 0])[1]));
    let content = shapes;
    if (src?.rels) {   // 中身が指している画像・音声・動画・リンクを取り込み、番号を付け替える
      const srcRels = src.zip.file(src.rels) ? await src.zip.file(src.rels).async('string') : '';
      const map = {};
      for (const m of srcRels.matchAll(/<Relationship\b([^>]*)\/>/g)) {
        const a = m[1]; const id = a.match(/Id="([^"]+)"/)[1]; const target = a.match(/Target="([^"]+)"/)[1]; const type = a.match(/Type="([^"]+)"/)[1];
        if (!MEDIA_TYPE.test(type) || !new RegExp(`r:(?:embed|link|id|pict)="${id}"`).test(content)) continue;
        const newId = `rId${++maxRid}`; map[id] = newId;
        if (/TargetMode="External"/.test(a)) { rels.push(`<Relationship Id="${newId}" Type="${type}" Target="${target}" TargetMode="External"/>`); continue; }
        const srcPath = 'ppt/' + target.replace(/^\.\.\//, '');
        const file = src.zip.file(srcPath); if (!file) { delete map[id]; maxRid--; continue; }
        const ext = srcPath.split('.').pop().toLowerCase(); const name = `imported${this.mediaNo++}.${ext}`;
        this.zip.file(`ppt/media/${name}`, await file.async('uint8array'));
        rels.push(`<Relationship Id="${newId}" Type="${type}" Target="../media/${name}"/>`);
        this.types.add(ext);
      }
      content = content.replace(/(r:(?:embed|link|id|pict))="(rId\d+)"/g, (all, attr, id) => (map[id] ? `${attr}="${map[id]}"` : all));
    }
    if (this.modelShapes.trim()) content = content.replace(/(<p:cNvPr\b[^>]*\bid=")(\d+)"/g, (all, a, n) => `${a}${+n + this.modelMaxId}"`);   // 背景の図形と番号がぶつからないように
    if (opt.colors) content = recolorText(content, opt.colors);
    const tree = spTreeOf(this.model.xml);
    const head = tree.match(TREE_HEAD)[0];
    let xml = this.model.xml.replace(/<p:spTree>[\s\S]*<\/p:spTree>/, () => `${head}${this.modelShapes}${content}</p:spTree>`).replace(/<p:timing>[\s\S]*?<\/p:timing>/, '');
    if (opt.bgColor) {
      const bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${opt.bgColor}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
      xml = /<p:bg>[\s\S]*?<\/p:bg>/.test(xml) ? xml.replace(/<p:bg>[\s\S]*?<\/p:bg>/, bg) : xml.replace(/(<p:cSld(?:\s[^>]*)?>)/, `$1${bg}`);
    }
    const slide = { path: `ppt/slides/slide${this.nextNo++}.xml`, xml, rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` };
    this.out.push(slide);
    if (this.sections.length) this.sections.at(-1).slides.push(slide);
    return slide;
  }

  async save() {
    const { zip } = this;
    for (const s of this.out) { zip.file(s.path, s.xml); zip.file(relsPathOf(s.path), s.rels); }
    // 背景.pptx のスライド（土台）とそのノートは消す
    const goneParts = [];
    for (const s of this.slides) {
      const r = zip.file(relsPathOf(s.path)); const note = r && ((await r.async('string')).match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/) || [])[1];
      if (note) { goneParts.push(`ppt/notesSlides/${note}`); zip.remove(`ppt/notesSlides/${note}`); zip.remove(`ppt/notesSlides/_rels/${note}.rels`); }
      goneParts.push(s.path); zip.remove(s.path); zip.remove(relsPathOf(s.path));
    }
    let rels = this.rels;
    for (const s of this.slides) rels = rels.replace(new RegExp(`<Relationship\\b[^>]*Id="${s.rId}"[^>]*/>`), '');
    let maxRid = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map(m => +m[1]));
    const ridOf = new Map();
    for (const s of this.out) { const rid = `rId${++maxRid}`; ridOf.set(s, rid); rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${s.path.replace(/^ppt\//, '')}"/></Relationships>`); }
    const idOf = new Map(); let sid = 256; for (const s of this.out) idOf.set(s, sid++);
    let pres = this.pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/, `<p:sldIdLst>${this.out.map(s => `<p:sldId id="${idOf.get(s)}" r:id="${ridOf.get(s)}"/>`).join('')}</p:sldIdLst>`);
    // セクション（式順の行ごと）。背景.pptx にあったセクションは消す
    pres = pres.replace(new RegExp(`<p:ext uri="${SECTIONS_EXT.replace(/[{}]/g, '\\$&')}">[\\s\\S]*?</p:ext>`), '').replace(/<p:extLst>\s*<\/p:extLst>/, '');
    const secs = this.sections.filter(s => s.slides.length);
    if (secs.length) {
      const ext = `<p:ext uri="${SECTIONS_EXT}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${secs.map(s => `<p14:section name="${esc(s.name).replace(/"/g, '&quot;')}" id="${guid()}"><p14:sldIdLst>${s.slides.map(x => `<p14:sldId id="${idOf.get(x)}"/>`).join('')}</p14:sldIdLst></p14:section>`).join('')}</p14:sectionLst></p:ext>`;
      pres = /<p:extLst>/.test(pres) ? pres.replace('<p:extLst>', `<p:extLst>${ext}`) : pres.replace('</p:presentation>', `<p:extLst>${ext}</p:extLst></p:presentation>`);
    }
    zip.file('ppt/presentation.xml', pres); zip.file('ppt/_rels/presentation.xml.rels', rels);
    let ct = await zip.file('[Content_Types].xml').async('string');
    for (const part of goneParts) ct = ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${part.replace(/\./g, '\\.')}"[^>]*/>`), '');
    for (const s of this.out) ct = ct.replace('</Types>', `<Override PartName="/${s.path}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`);
    for (const ext of this.types) if (!new RegExp(`Extension="${ext}"`, 'i').test(ct)) ct = ct.replace('<Default ', `<Default Extension="${ext}" ContentType="${MIME[ext] || 'application/octet-stream'}"/><Default `);
    zip.file('[Content_Types].xml', ct);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }
}
