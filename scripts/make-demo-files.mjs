// デモ用の歌詞・交読文の pptx を作る（data/examples/files/hymns/<番号>.pptx・readings/<番号>.pptx）。土台は見本のテンプレの背景（template/背景.pptx）。
// 歌詞は、著作権の切れた英語の原詩から、このリポジトリのために新しく訳したもの（歌うための訳詞ではない）。
// 交読文は口語訳聖書（1954/1955 年版。著作権の保護期間が満了）から。司会と会衆が 1 節ずつ交互に読む（会衆の節は強調の色）。
// 使い方: node scripts/make-demo-files.mjs   （中身を変えたら作り直して、npm run demo で入れ直す）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';

const dir = resolve(import.meta.dirname, '../data/examples/files');

const HYMNS = {
  1: { title: 'アメイジング・グレイス', from: 'Amazing Grace（John Newton, 1779）', verses: [
    ['なんと深い 神の恵み', 'こんな私を 救い出した', '迷っていたのに 見つけられ', '見えなかった目が いま見える'],
    ['恵みが心に 恐れを教え', '恵みが恐れを 取り去った', 'はじめて信じた あの時から', '恵みはなんと 尊いことか'],
    ['多くの危険と 苦しみと', 'わなを越えて ここまで来た', 'ここまで守った この恵みが', '家路へと わたしを導く'],
  ] },
  2: { title: '友なるイエス', from: 'What a Friend We Have in Jesus（Joseph Scriven, 1855）', verses: [
    ['イエスという 友がいる', '罪も悲しみも 担われる', '何でも祈りで 打ち明けよう', 'それは なんという恵み'],
    ['試みや 悩みがあっても', '決して 望みを捨てないで', '主はわたしたちの 弱さを知る', 'すべてを祈りで ゆだねよう'],
    ['重荷に 疲れ果てても', '主こそ わたしたちの避け所', '友に 見捨てられた時も', '主の腕に 包まれる'],
  ] },
  3: { title: '聖なるかな', from: 'Holy, Holy, Holy（Reginald Heber, 1826）', verses: [
    ['聖なるかな 聖なるかな', '全能の主なる 神よ', '朝ごとに わたしたちの歌は', 'あなたのもとへ のぼる'],
    ['聖なるかな 聖なるかな', '聖徒らは 御前にひれ伏し', '金の冠を 投げ出して', '永遠の主を ほめたたえる'],
    ['聖なるかな 聖なるかな', '全能の主なる 神よ', '天も地も 海も', '御名を ほめたたえる'],
  ] },
  4: { title: '世界よ喜べ', from: 'Joy to the World（Isaac Watts, 1719）', verses: [
    ['世界よ 喜べ 主が来られた', '地は その王を迎えよ', 'すべての心に 場所を空け', '天も地も 歌え'],
    ['世界よ 喜べ 救い主が治める', '人よ 歌を上げよ', '野も 川も 山も 谷も', '喜びを くり返せ'],
    ['主は 真理と 恵みで治め', '国々に 示される', '主の 義の栄光と', '驚くべき 愛を'],
  ] },
  5: { title: '静かな夜', from: 'Silent Night（Joseph Mohr, 1818／英訳 John F. Young, 1859）', verses: [
    ['静かな夜 聖なる夜', 'すべては穏やかに 輝く', '母と 幼な子を照らし', '安らかに 眠りたまえ'],
    ['静かな夜 聖なる夜', '羊飼いは 震えた', '天の栄光が 遠くから流れ', '御使いは ハレルヤと歌う'],
    ['静かな夜 聖なる夜', '神の御子の 愛の光', '御顔から 輝き出る', '救いの 夜明けの恵み'],
  ] },
};

const READINGS = {
  1: { title: '詩篇 第1篇', verses: [
    '悪しき者のはかりごとに歩まず、罪びとの道に立たず、あざける者の座にすわらぬ人はさいわいである。',
    'このような人は主のおきてをよろこび、昼も夜もそのおきてを思う。',
    'このような人は流れのほとりに植えられた木の時が来ると実を結び、その葉もしぼまないように、そのなすところは皆栄える。',
    '悪しき者はそうでない、風の吹き去るもみがらのようだ。',
    'それゆえ、悪しき者はさばきに耐えない。罪びとは正しい者のつどいに立つことができない。',
    '主は正しい者の道を知られる。しかし、悪しき者の道は滅びる。',
  ] },
  2: { title: '詩篇 第23篇', verses: [
    '主はわたしの牧者であって、わたしには乏しいことがない。',
    '主はわたしを緑の牧場に伏させ、いこいのみぎわに伴われる。',
    '主はわたしの魂をいきかえらせ、み名のためにわたしを正しい道に導かれる。',
    'たといわたしは死の陰の谷を歩むとも、わざわいを恐れません。あなたがわたしと共におられるからです。あなたのむちと、あなたのつえはわたしを慰めます。',
    'あなたはわたしの敵の前で、わたしの前に宴を設け、わたしのこうべに油をそそがれる。わたしの杯はあふれます。',
    'わたしの生きているかぎりは必ず恵みといつくしみとが伴うでしょう。わたしはとこしえに主の宮に住むでしょう。',
  ] },
  3: { title: 'マタイによる福音書 5:1-12', verses: [
    'イエスはこの群衆を見て、山に登り、座につかれると、弟子たちがみもとに近寄ってきた。',
    'そこで、イエスは口を開き、彼らに教えて言われた。',
    '「こころの貧しい人たちは、さいわいである、天国は彼らのものである。',
    '悲しんでいる人たちは、さいわいである、彼らは慰められるであろう。',
    '柔和な人たちは、さいわいである、彼らは地を受けつぐであろう。',
    '義に飢えかわいている人たちは、さいわいである、彼らは飽き足りるようになるであろう。',
    'あわれみ深い人たちは、さいわいである、彼らはあわれみを受けるであろう。',
    '心の清い人たちは、さいわいである、彼らは神を見るであろう。',
    '平和をつくり出す人たちは、さいわいである、彼らは神の子と呼ばれるであろう。',
    '義のために迫害されてきた人たちは、さいわいである、天国は彼らのものである。',
    'わたしのために人々があなたがたをののしり、また迫害し、あなたがたに対し偽って様々の悪口を言う時には、あなたがたは、さいわいである。',
    '喜び、よろこべ、天においてあなたがたの受ける報いは大きい。あなたがたより前の預言者たちも、同じように迫害されたのである。',
  ] },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 色を書かない文字は、組み立てのときに背景.json の「基本」の色になる。強調は FFFF00（「強調」の色に置き換わる。src/lib/slides/pptx.mjs の recolorText）
const run = (text, sz, accent) => `<a:r><a:rPr lang="ja-JP" altLang="en-US" sz="${sz}" dirty="0">${accent ? '<a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill>' : ''}<a:latin typeface="+mn-ea"/><a:ea typeface="+mn-ea"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
const box = (id, [x, y, cx, cy], lines, { sz, accent = false, algn = 'ctr', anchor = 'ctr' }) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="テキスト ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
  + `<p:txBody><a:bodyPr wrap="square" lIns="91440" rIns="91440" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>`
  + `<a:p><a:pPr algn="${algn}"><a:lnSpc><a:spcPct val="110000"/></a:lnSpc></a:pPr>${lines.map(l => run(l, sz, accent)).join('<a:br><a:rPr lang="ja-JP" sz="' + sz + '"/></a:br>')}</a:p></p:txBody></p:sp>`;

const W = 9144000, H = 5143500;
async function deck(slides) {
  const zip = await JSZip.loadAsync(readFileSync(resolve(dir, 'template/背景.pptx')));
  const model = await zip.file('ppt/slides/slide1.xml').async('string');
  const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string');
  let types = await zip.file('[Content_Types].xml').async('string');
  let pres = await zip.file('ppt/presentation.xml').async('string');
  let presRels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  presRels = presRels.replace(/<Relationship\b[^>]*relationships\/slide"[^>]*\/>/g, '');
  let maxRid = Math.max(...[...presRels.matchAll(/Id="rId(\d+)"/g)].map(m => +m[1]));
  const ids = [];
  slides.forEach((shapes, i) => {
    const n = i + 1, rid = `rId${++maxRid}`;
    zip.file(`ppt/slides/slide${n}.xml`, model.replace(/<p:grpSpPr\/><\/p:spTree>/, `<p:grpSpPr/>${shapes}</p:spTree>`));
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels);
    presRels = presRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/></Relationships>`);
    if (!types.includes(`/ppt/slides/slide${n}.xml"`)) types = types.replace('</Types>', `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`);
    ids.push(`<p:sldId id="${256 + n}" r:id="${rid}"/>`);
  });
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids.join('')}</p:sldIdLst>`);
  zip.file('[Content_Types].xml', types); zip.file('ppt/presentation.xml', pres); zip.file('ppt/_rels/presentation.xml.rels', presRels);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const out = async (name, slides) => { mkdirSync(resolve(dir, name, '..'), { recursive: true }); writeFileSync(resolve(dir, name), await deck(slides)); console.log('wrote', name, `${slides.length} 枚`); };

for (const [no, h] of Object.entries(HYMNS)) {
  const title = box(2, [0, 900000, W, 900000], [String(no)], { sz: 6000, accent: true }) + box(3, [0, 1900000, W, 1500000], [h.title], { sz: 6600 })
    + box(4, [0, 4300000, W, 500000], [h.from], { sz: 1400 });
  await out(`hymns/${no}.pptx`, [title, ...h.verses.map((v, i) => box(2, [300000, 250000, 1000000, 600000], [String(i + 1)], { sz: 2400, accent: true, algn: 'l' })
    + box(3, [300000, 700000, W - 600000, H - 1100000], v, { sz: 4800 }))]);
}
for (const [no, r] of Object.entries(READINGS)) {
  const title = box(2, [0, 1100000, W, 900000], [`交読文 ${no}`], { sz: 4400, accent: true }) + box(3, [0, 2100000, W, 1300000], [r.title], { sz: 6000 })
    + box(4, [0, 4300000, W, 500000], ['口語訳聖書（1954/1955 年版）'], { sz: 1400 });
  await out(`readings/${no}.pptx`, [title, ...r.verses.map((v, i) => {
    const people = i % 2 === 1;   // 司会と会衆が交互に読む（会衆の節は強調の色）
    return box(2, [300000, 250000, 3000000, 600000], [`${i + 1}　${people ? '会衆' : '司会'}`], { sz: 2400, accent: true, algn: 'l' })
      + box(3, [400000, 800000, W - 800000, H - 1200000], [v], { sz: v.length > 60 ? 3600 : 4400, accent: people, algn: 'l' });
  })]);
}
