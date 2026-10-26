// 試験用の小さな pptx を作る（本物のテンプレ・部品は Git に無いので、その場で作る）
import JSZip from 'jszip';
import { paragraphTexts } from '../../src/lib/slides/pptx.mjs';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const escx = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** run 1 つ。color は 'FFFFFF' などの色コード、'bg1' はテーマの色、null は色の指定なし */
export const run = (t, { sz = 3200, color = 'FFFFFF' } = {}) => `<a:r><a:rPr lang="ja-JP" sz="${sz}">${color == null ? '' : /^[0-9A-F]{6}$/i.test(color) ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : `<a:solidFill><a:schemeClr val="${color}"/></a:solidFill>`}</a:rPr><a:t>${escx(t)}</a:t></a:r>`;
/** 図形 1 つ。paras は段落ごとの run の配列（文字だけなら run に直す） */
export function shape(id, paras, { y = 1000000, cy = 800000 } = {}) {
  const ps = paras.map(p => `<a:p>${(Array.isArray(p) ? p : [p]).map(x => (x.startsWith('<a:r>') ? x : run(x))).join('')}<a:endParaRPr lang="ja-JP" sz="3200"/></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="${y}"/><a:ext cx="8000000" cy="${cy}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${ps}</p:txBody></p:sp>`;
}
/** スライドごとの図形（spTree の子の XML）→ pptx。bg を渡すとスライドの背景を付ける */
export async function makePptx(slides, { bg = null, sections = null } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`);
  const sec = sections ? `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${sections.map(([n, idx]) => `<p14:section name="${n}" id="{00000000-0000-0000-0000-00000000000${idx[0]}}"><p14:sldIdLst>${idx.map(i => `<p14:sldId id="${256 + i}"/>`).join('')}</p14:sldIdLst></p14:section>`).join('')}</p14:sectionLst></p:ext></p:extLst>` : '';
  zip.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/>${sec}</p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`);
  slides.forEach((shapes, i) => {
    const bgx = bg ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : '';
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld ${NS}><p:cSld>${bgx}<p:spTree>${HEAD}${shapes}</p:spTree></p:cSld></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`);
  });
  return zip.generateAsync({ type: 'uint8array' });
}
/** 出来上がりの pptx → スライドごとの文字（段落を「/」でつなぐ。文字の無いスライドは「(空)」） */
export async function slideTexts(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const rels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  const target = {}; for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target[m[1]] = m[2];
  const pres = await zip.file('ppt/presentation.xml').async('string');
  const out = [];
  for (const m of pres.matchAll(/<p:sldId [^>]*r:id="(rId\d+)"/g)) out.push(paragraphTexts(await zip.file('ppt/' + target[m[1]]).async('string')).filter(Boolean).join(' / ') || '(空)');
  return out;
}
/** 図形の XML → 段落の文字（「/」でつなぐ） */
export const textOf = (xml) => paragraphTexts(xml).filter(Boolean).join(' / ');
