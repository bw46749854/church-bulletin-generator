// 礼拝スライド（pptx）: ブラウザ内で組み立ててダウンロード（ARCHITECTURE.md §18）。牧師の画面と担当者ページで共通（docs/slides-role.md §5）。
// ページには [data-slides="<kind>"]（作るボタン）・[data-slides-warn="<kind>"]（注意）・[data-slides-need="<kind>"]（pptx 未登録の番号）を置く。
// 主日礼拝には [data-slides-prep="morning"]（準備賛美の番号）と [data-slides-prep-title="morning"]（その曲名）も置く
import { $, $$, inlineMsg, why, download, loadJSZip, pageUrl } from './dom.mjs';
import { MF } from './masters.mjs';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** 4 つのエリア: 週データの引用聖句の置き場（key）、テンプレの式順の名前（service。template/式順/<service>.json）とファイル名 */
export const SLIDE_AREAS = [
  { kind: 'morning', service: 'worship', key: 'sermon_refs', file: (d) => `${d}.pptx` },
  { kind: 'afternoon', service: 'afternoon', key: 'afternoon_refs', file: (d) => `${d}-午後礼拝.pptx` },
  { kind: 'wednesday', service: 'wednesday', key: 'wednesday_refs', file: (d, boot) => { const [y, m, dd] = d.split('-').map(Number); return `${ymd(new Date(y, m - 1, dd + boot.config.rules.wednesday_offset_days))}-水曜祈祷会.pptx`; } },
  { kind: 'other', service: 'other', key: 'other_refs', file: (d) => `${d}-その他.pptx` },
];

/** 準備賛美の番号。週データには無く、作る直前に画面で入れる（保存しない。ARCHITECTURE.md §18）。空なら null＝準備賛美はテンプレのまま */
const prepNo = (kind) => $(`[data-slides-prep="${kind}"]`)?.value.trim() || null;
/** 別の週を開いたら準備賛美の番号を空にする（その週のスライドを作るためだけの番号） */
export function clearPrep() { for (const i of $$('[data-slides-prep]')) i.value = ''; }

// 作る前に、歌詞・交読文の pptx が無い番号を出す（pptx 担当者の作業の入口。番号は生成の値（lib/slides/values.mjs）の曲・交読文と同じ）
function slidesNeed(week, boot, kind) {
  const w = week || {}; const list = [];
  const add = (k, no, label) => { if (no == null || no === '') return; const n = String(+no); if (!(boot.files?.[k] || {})[n]) list.push(`${MF[k].name} ${n}（${label}）`); };
  if (kind === 'morning') {
    add('hymns', prepNo(kind), '準備賛美'); (w.morning?.hymns || []).forEach((no, i) => add('hymns', no, `賛美 ${i + 1}`)); add('readings', w.morning?.responsive_reading, '交読文');
    const communion = (w.morning?.program || []).find(x => x?.preset === '聖餐式'); if (communion) add('hymns', communion.hymn, '聖餐式');
  }
  if (kind === 'afternoon') add('hymns', w.afternoon?.hymn, '賛美');
  if (kind === 'wednesday') (w.wednesday?.hymns || []).forEach((no, i) => add('hymns', no, `賛美 ${i + 1}`));
  return list;
}
export function paintSlidesNeed(week, boot) {
  for (const t of $$('[data-slides-prep-title]')) {   // 準備賛美の番号の横の曲名（pptx が無いことは下の行で知らせる）
    const no = prepNo(t.dataset.slidesPrepTitle); const title = no && boot?.hymns?.[String(+no)];
    t.textContent = !no ? '' : title ? `（${title}）` : '曲名が未登録'; t.classList.toggle('missing', !!no && !title);
  }
  for (const p of $$('[data-slides-need]')) { const l = week && boot ? slidesNeed(week, boot, p.dataset.slidesNeed) : []; p.textContent = l.length ? `${l.join('、')}の pptx が未登録です（このまま作ると入りません。見出しの「マスタ」で pptx を置いてください）` : ''; }
}

/**
 * スライドを作ってダウンロードする。
 * マスタ・名簿は、画面を開いたときに読んだものではなく、作る直前にサーバーから読み直す（牧師と担当者が別々に変えるため。
 * docs/slides-role.md §5）。読み直した内容は onBoot で画面に返す（一覧や「pptx 未登録」を合わせる）
 * @param {{week: object, kind: string, onBoot?: (boot: object) => void}} o
 */
export async function makeSlides({ week, kind, onBoot }) {
  if (!week) return;
  const area = SLIDE_AREAS.find(a => a.kind === kind);
  const btn = $(`[data-slides="${kind}"]`), warnBox = $(`[data-slides-warn="${kind}"]`); btn.disabled = true; inlineMsg(btn, 'スライドを作っています…（数秒〜十数秒）', 'busy');
  try {
    const r0 = await fetch('api/bootstrap'); const boot = await r0.json(); if (!r0.ok) throw new Error(boot.error || `マスタを読めません: ${r0.status}`);
    onBoot?.(boot);
    const JSZip = await loadJSZip();
    const { buildSlides } = await import(pageUrl('lib/slides.mjs'));   // 式順・部品・背景のテンプレ一式で組む（docs/pptx-template.md）
    const getFile = async (k) => {   // テンプレ一式・歌詞・交読文。テンプレの名前は日本語なので区切りごとに URL エンコード
      const r = await fetch(`api/files/${k.split('/').map(encodeURIComponent).join('/')}`);
      if (r.status === 404) return null; if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${k}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    };
    const lookup = async (ref) => { const r = await fetch('api/bible?ref=' + encodeURIComponent(ref)); return r.ok ? r.json() : null; };
    let built;
    try { built = await buildSlides({ kind: area.service, JSZip, getFile, week, people: boot.people, hymnsMaster: boot.hymns, config: boot.config, prepHymn: prepNo(kind), lookup }); }
    catch (e) {
      if (e?.name !== 'TemplateError') throw e;   // 通信の失敗・ログインの期限切れは下の catch（why）で
      warnBox.textContent = e.message; inlineMsg(btn, 'スライドを作れませんでした。下の理由のとおりテンプレ（マスタの「テンプレ」）を確かめてください'); return;
    }
    const { pptx, warnings } = built;
    warnBox.textContent = warnings.join('\n');
    if (!pptx) { inlineMsg(btn, '作るスライドがありません。下の注意を確認してください'); return; }
    const name = area.file(week.date, boot);
    download(new Blob([pptx], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), name);
    inlineMsg(btn, `ダウンロードしました（${name}）` + (warnings.length ? '。下の注意を確認してください' : ''), warnings.length ? 'error' : 'ok');
  } catch (e) { inlineMsg(btn, `スライドを作れませんでした: ${why(e)}`); }
  finally { btn.disabled = false; }
}
