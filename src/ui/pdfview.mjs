// PDF の表示（PDF.js で各ページを canvas に描く）。牧師の画面と担当者ページで共通（docs/slides-role.md §5）。
// iPad の Safari は iframe の PDF を 1 ページしか描かず、Android は inline 表示できないため、自前で描く
import { $, el, download, mountHtml, pageUrl, why } from './dom.mjs';

// ---------- PDF.js の用意（ページで 1 組だけ。ARCHITECTURE.md §5.1） ----------
// PDF.js は、表の担当（pdf.min.mjs）と、PDF を読み解く裏方（pdf.worker.min.mjs。ブラウザの Web Worker）の 2 つでできている。
// 何も指定しないと、PDF.js は文書を開くたびに裏方を作り直し、そのたびに裏方のファイルを取りに行く。
// iOS の Safari は、ダウンロードの確認に答えるまでの間にページが始めた通信を落とす（ARCHITECTURE.md §4.8）ので、
// 表示のたびに通信が要る作りだと、ダウンロードと重なったときに表示できない。
// → 用意（通信）は手の空いたときに 1 回だけ済ませ、裏方は置いたまま使い回す。表示は通信なしで終わる。
// 用意に失敗したら、次に要るときにやり直す。やり直しは URL を変える（ブラウザも PDF.js も、読み込みに失敗した
// モジュールをページの中で覚えていて、同じ URL では失敗を返し続けるため）
const engine = { ready: null, attempt: 0 };
function withTimeout(p, ms, what) {
  let t; return Promise.race([p, new Promise((_, ng) => { t = setTimeout(() => ng(new Error(`${what}に時間がかかりすぎました`)), ms); })]).finally(() => clearTimeout(t));
}
/** PDF.js を用意する（済んでいれば同じものを返す）。表示する前に呼ばなくてもよい（show が待つ）。手の空いたときに呼んでおくと、初めての表示も通信なしで済む */
export function preparePdfEngine() {
  if (engine.ready) return engine.ready;
  const q = engine.attempt ? `?retry=${engine.attempt}` : '';
  const ready = (async () => {
    const pdfjs = await import(pageUrl(`vendor/pdfjs/pdf.min.mjs${q}`));
    pdfjs.GlobalWorkerOptions.workerSrc = pageUrl(`vendor/pdfjs/pdf.worker.min.mjs${q}`);
    const worker = new pdfjs.PDFWorker({ name: 'shuho-pdf' });   // getDocument に渡すと、文書を閉じても裏方は止まらない
    try { await withTimeout(worker.promise, 60000, 'PDF の表示の準備'); } catch (e) { worker.destroy(); throw e; }
    return { pdfjs, worker };
  })();
  engine.ready = ready;
  ready.catch(() => resetEngine(ready));
  return ready;
}
function resetEngine(ready) {   // 次に要るときに作り直す（裏方が応答しなくなったときも）
  if (engine.ready !== ready) return;
  engine.ready = null; engine.attempt++;
  ready.then(({ worker }) => worker.destroy(), () => {});
}

/**
 * PDF の表示欄（見出し・溢れ・拡大縮小・保存・印刷・表示面）を placeholder の位置に置く。
 * 表示できなかったときは、表示面に理由と「もう一度表示」を出す（呼んだ側は知らせを出さなくてよい）。
 * @param {{bar?: string, wrap?: string, onError?: (e: Error) => void}} extra  ページだけの部品の HTML（bar: ボタンの列の最後、wrap: 表示面の後ろ）と、表示できなかったときの記録
 * @returns {{show: (blob: Blob, o: {title: string, name: string, response: Response}) => Promise<boolean>, clear: () => void}}
 */
/** 紙面に収まらない欄（縮小の規則の名前。x-overflow）を、直し方の分かる言葉に（保存の知らせと表示欄で共通） */
const OVERFLOW_TEXT = {
  sermon_title: '説教題（1 行に入りません。「2 行」にしてください）', nextweek_title: '次週欄の題（1 行に入りません。「2 行」にしてください）',   // 2026-10-24 より前に作った PDF の写し
  title_2line: '2 行の題（縮めても入りません。題を短くするか、改行の位置を変えてください）', program: '式順（枠の下からはみ出しています）',
  person_name: '名前', hymn_title: '曲名', song_title: 'ワーシップ曲', scripture_ref: '聖書箇所', nextweek_val: '次週・JJS の欄', nextweek_body: '次週奉仕予定',
  box_title: '枠の見出し', contact: '牧師連絡先', creed_line: '使徒信条', prayer: '覚えて祈りましょう', announcements: '報告',
};
const TITLE_TEXT = { title: '1 行に入りません。「2 行」にしてください', title_2line: '2 行でも入りません。題を短くするか、改行の位置を変えてください' };   // 題は「規則:欄の名前」で来る
export function overflowText(header) {
  const keys = [...new Set(decodeURIComponent(header || '').split(',').filter(Boolean))];
  return keys.map(k => { const [rule, label] = k.split(':'); return label && TITLE_TEXT[rule] ? `${label}（${TITLE_TEXT[rule]}）` : OVERFLOW_TEXT[k] || k; }).join('、');
}

export function mountPdfViewer(placeholder, extra = {}) {
  mountHtml(placeholder, `
      <div class="preview-bar">
        <span id="preview-title">プレビュー</span><span id="overflow-msg" class="warn"></span><span class="spacer"></span>
        <button type="button" class="small" id="btn-zoom-out" title="縮小">−</button><button type="button" class="small" id="btn-zoom-fit" title="幅に合わせる">幅</button><button type="button" class="small" id="btn-zoom-in" title="拡大">＋</button>
        <button type="button" class="small" id="btn-pdf-download" disabled>PDF を保存</button><button type="button" class="small" id="btn-pdf-print" disabled>印刷</button>${extra.bar || ''}
      </div>
      <div class="pdfwrap">
        <div id="pdf-view" class="pdfview"></div>${extra.wrap || ''}
      </div>`);
  // blob: 表示する PDF。pending: まだ開けていない（表示欄が隠れていた・用意に失敗した）。表示欄が見えたときに開く
  const shown = { blob: null, doc: null, pending: false, zoom: 1, name: 'shuho.pdf', drawnWidth: 0 };
  let opening = null, drawing = null, retrying = null;
  /** PDF を表示欄に渡す。開けて（見えていれば描けて）true、表示できなければ false（表示面に理由を出す） */
  async function show(blob, { title, name, response }) {
    const overflow = overflowText(response.headers.get('x-overflow'));
    shown.blob = blob; shown.name = name; shown.pending = true;
    $('#preview-title').textContent = title;
    $('#overflow-msg').textContent = overflow ? `紙面に収まらない欄（赤枠）：${overflow}` : '';
    $('#btn-pdf-download').disabled = $('#btn-pdf-print').disabled = false;
    return open();
  }
  async function open() {
    const job = {}; opening = job; drawing = null;   // 開いている途中・描いている途中の古い方はやめる
    try {
      const { pdfjs, worker } = await preparePdfEngine();
      const data = new Uint8Array(await shown.blob.arrayBuffer());
      if (opening !== job) return true;
      if (shown.doc) { const old = shown.doc; shown.doc = null; await old.destroy().catch(() => {}); }   // 待つ: 裏方を使い回すので、閉じ終わる前に次を開かない
      const task = pdfjs.getDocument({ data, worker });
      const doc = await withTimeout(task.promise, 30000, 'PDF を開く').catch(e => { task.destroy().catch(() => {}); resetEngine(engine.ready); throw e; });   // 裏方が応答しない → 作り直す
      if (opening !== job) { doc.destroy().catch(() => {}); return true; }
      shown.doc = doc; shown.pending = false;
      await drawPages();
      return true;
    } catch (e) {
      if (opening !== job) return true;
      extra.onError?.(e);
      if ($('#pdf-view').clientWidth > 0) showFailure(e);   // 見えていなければ、見えたときにやり直す（下の監視）
      return false;
    }
  }
  function showFailure(e) {
    const box = el('div', 'empty failed'); const retry = el('button', 'small', 'もう一度表示'); retry.type = 'button';
    retry.addEventListener('click', () => { box.replaceChildren('表示しています…'); open(); });
    box.append(el('div', null, `PDF を画面に表示できませんでした（${why(e)}）。保存や「PDF を保存」には影響しません。`), retry);
    $('#pdf-view').replaceChildren(box);
  }
  async function drawPages() {   // 幅に合わせて各ページを canvas に描く。端末の画素密度ぶん高解像度で描いて CSS で縮める
    if (!shown.doc) return;
    const job = {}; drawing = job;   // 描画中に次の描画が始まったら、古い方は途中でやめる
    const view0 = $('#pdf-view');
    if (view0.clientWidth <= 0) return;   // 表示欄が隠れている間は描かない（幅が測れない）。表示されたら下の監視が呼び直す
    await (async () => { try {
      const view = view0; view.innerHTML = '';
      const width = Math.max(200, view.clientWidth - 28); shown.drawnWidth = view.clientWidth; const dpr = window.devicePixelRatio || 1;
      for (let i = 1; i <= shown.doc.numPages; i++) {
        if (drawing !== job) return;
        const page = await shown.doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(1.6, width / base.width) * shown.zoom });
        const c = el('canvas', 'page'); c.width = Math.round(vp.width * dpr); c.height = Math.round(vp.height * dpr); c.style.width = `${Math.round(vp.width)}px`; c.style.height = `${Math.round(vp.height)}px`;
        view.append(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      }
    } catch (e) { if (drawing === job) throw e; /* 途中で次の PDF に切り替わった（古い文書は破棄済み）→ 無視 */ } })();
  }
  const zoomTo = (z) => { shown.zoom = Math.min(4, Math.max(0.5, z)); drawPages(); };
  $('#btn-zoom-in').addEventListener('click', () => zoomTo(shown.zoom * 1.25));
  $('#btn-zoom-out').addEventListener('click', () => zoomTo(shown.zoom / 1.25));
  $('#btn-zoom-fit').addEventListener('click', () => zoomTo(1));
  $('#btn-pdf-download').addEventListener('click', () => { if (shown.blob) download(shown.blob, shown.name); });
  $('#btn-pdf-print').addEventListener('click', () => { if (shown.blob) window.open(URL.createObjectURL(shown.blob), '_blank'); });   // ボタン押下＝利用者の操作なのでポップアップ扱いにならない
  // 幅が変わったら描き直す（タブを開いた・窓の大きさを変えた・保存後に初めて表示した、など）。まだ開けていない PDF はここで開く
  let resizeTimer = null;
  const redrawIfWidthChanged = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = $('#pdf-view').clientWidth; if (w <= 0) return;
      if (shown.pending && shown.blob) { if (!retrying) retrying = open().finally(() => { retrying = null; }); return; }
      if (shown.doc && Math.abs(w - shown.drawnWidth) > 2) drawPages();
    }, 150);
  };
  if (window.ResizeObserver) new ResizeObserver(redrawIfWidthChanged).observe($('#pdf-view'));
  window.addEventListener('resize', redrawIfWidthChanged);
  function clear() { opening = null; drawing = null; shown.blob = null; shown.pending = false; if (shown.doc) { shown.doc.destroy().catch(() => {}); shown.doc = null; } $('#pdf-view').innerHTML = ''; $('#pdf-view').append(el('div', 'empty', 'プレビューはまだありません')); $('#btn-pdf-download').disabled = $('#btn-pdf-print').disabled = true; }
  return { show, clear };
}
