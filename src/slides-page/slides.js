/* 担当者ページ（docs/slides-role.md §2・§5）。牧師の画面と共通の部品は ui/。
   週報の内容（週データ）は読むだけ。この画面から送る書き込みは、マスタと素材（pptx・決めた JSON）だけで、
   それ以外は担当者用の窓口（src/lib/slides-window.mjs）が断る。URL はすべてこのページからの相対（api/…、ui/…、vendor/…） */
import { $, $$, el, notify, why, report, reportUncaught } from './ui/dom.mjs';
import { mountMasterFiles, renderPeople } from './ui/masters.mjs';
import { mountReplace } from './ui/replace.mjs';
import { mountPdfViewer, preparePdfEngine } from './ui/pdfview.mjs';
import { SLIDE_AREAS, paintSlidesNeed, makeSlides, clearPrep } from './ui/slide-maker.mjs';
import { mountPlace } from './ui/place.mjs';
import { mountTemplates } from './ui/templates.mjs';

reportUncaught();
let boot = null;   // api/bootstrap（マスタ・名簿・保存済みの週の一覧）
let week = null;   // 選んでいる週（保存済みの内容）
let pdfShownFor = null;   // 表示欄にいま出している週の日付

const getJson = async (url) => { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `${url}: ${r.status}`); return j; };
const WD = '日月火水木金土';
const fmtWeek = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${y}年${m}月${dd}日（${WD[new Date(y, m - 1, dd).getDay()]}）`; };

// ---------- 共通の部品 ----------
const masterFiles = mountMasterFiles($('[data-part="master-files"]'), {
  getBoot: () => boot,
  afterPaint: () => paintSlidesNeed(week, boot),   // 「pptx 未登録」の番号はスライドの欄にも出す
});
mountReplace($('[data-part="replace"]'), { onJsonReplaced: async () => takeMasters(await getJson('api/bootstrap')) });   // 名簿・曲名などを読み直す
const viewer = mountPdfViewer($('[data-part="pdf-view"]'), { onError: (e) => report('pdf-view', e) });
const templates = mountTemplates($('[data-part="templates"]'));   // テンプレの管理（マスタの側を開いたときに読む）
const place = mountPlace({ onChange: (p) => { masterFiles.relock(); if (p === 'masters') templates.open(); } });   // 見出しの「週報｜マスタ」。削除の有効は、マスタを離れると戻す
if (place.get() === 'masters') templates.open();
$('#btn-export').addEventListener('click', () => { location.href = 'api/export'; });

/** 読み直したマスタ・名簿で画面を合わせる（週の一覧はそのまま） */
function takeMasters(b) {
  for (const k of ['config', 'people', 'hymns', 'readings', 'files']) boot[k] = b[k];
  renderPeople($('#people-list'), boot.people); masterFiles.paint();
}

// ---------- 週 ----------
function paintWeek() {
  for (const a of SLIDE_AREAS) {
    const box = $(`[data-refs-view="${a.key}"]`); if (!box) continue;
    const refs = (week?.slides?.[a.key] || []).filter(Boolean);
    box.replaceChildren(...(refs.length ? refs.map((r, i) => { const row = el('div', 'arow'); row.append(el('span', 'n', `${i + 1}.`), el('span', null, r)); return row; }) : [el('div', 'hint', '引用聖句はありません')]));
  }
  paintSlidesNeed(week, boot);
}
async function openWeek(date) {
  week = (await getJson(`api/week/${date}`)).week; clearPrep();
  paintWeek();
  if ($('#p-pdf').classList.contains('active')) showPdf();
}
$('#week-select').addEventListener('change', async (e) => {
  try { await openWeek(e.target.value); } catch (err) { notify(`週を読み込めませんでした: ${why(err)}`, { kind: 'error', key: 'week' }); report('openWeek', err); }
});

// ---------- スライド（作る直前に、週もサーバーの最新を読み直す。マスタ・名簿は makeSlides が読み直す） ----------
$$('[data-slides]').forEach(b => b.addEventListener('click', async () => {
  if (!week) return;
  try { week = (await getJson(`api/week/${week.date}`)).week; paintWeek(); }
  catch (e) { notify(`週報を読み直せませんでした: ${why(e)}`, { kind: 'error', key: 'slides' }); return; }
  await makeSlides({ week, kind: b.dataset.slides, onBoot: takeMasters });
}));
$$('[data-slides-prep]').forEach(i => i.addEventListener('input', () => paintSlidesNeed(week, boot)));   // 準備賛美の曲名と「pptx 未登録」

// ---------- 週報（保存済みの PDF） ----------
async function showPdf() {
  if (!week || pdfShownFor === week.date) return;
  const date = week.date; pdfShownFor = date;
  viewer.clear(); $('#preview-title').textContent = `${fmtWeek(date)} の週報を用意しています…（しばらく使われていないと 1 分ほどかかります）`;
  try {
    const r = await fetch(`api/pdf/${date}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `PDF: ${r.status}`);
    if (week?.date !== date) return;   // 待っている間に別の週を選んだ
    await viewer.show(await r.blob(), { title: `${fmtWeek(date)} の週報（保存済みの内容）`, name: `${date}.pdf`, response: r });
  } catch (e) {
    if (pdfShownFor === date) pdfShownFor = null;   // もう一度タブを開いたらやり直す
    $('#preview-title').textContent = '週報';
    notify(`週報の PDF を用意できませんでした: ${why(e)}`, { kind: 'error', key: 'pdf' }); report('showPdf', e);
  }
}

// ---------- タブ ----------
$$('.tab').forEach(b => b.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === b)); $$('#week-view .panel').forEach(p => p.classList.toggle('active', p.id === b.dataset.tab));
  if (b.dataset.tab === 'p-pdf') showPdf();
}));

// ---------- 起動 ----------
(async function init() {
  try {
    const [b, me] = await Promise.all([getJson('api/bootstrap'), getJson('api/whoami').catch(() => null)]);
    boot = b;
    if (me?.email) $('#who').textContent = `ログイン中: ${me.email}`;
    renderPeople($('#people-list'), boot.people); masterFiles.paint();
    const sel = $('#week-select'); sel.replaceChildren();
    for (const d of [...boot.weeks].reverse()) sel.append(new Option(fmtWeek(d), d));
    sel.disabled = !boot.weeks.length;
    if (boot.weeks.length) await openWeek(boot.weeks.at(-1));
    else notify('保存済みの週がありません（牧師が週報を保存すると、ここに出ます）', { kind: 'ok', key: 'week' });
    setTimeout(() => preparePdfEngine().catch(() => {}), 1500);   // PDF の表示の準備は手の空いたときに（ARCHITECTURE.md §5.1）
  } catch (e) { notify(`読み込めませんでした: ${why(e)}`, { kind: 'error', key: 'init' }); report('init', e); }
})();
