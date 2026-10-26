/* 週報 入力フォーム。各タブは週報の紙面と同じ配置。式順は config.json の定義から生成する。
   データは week.json と同じ形で持ち、保存・プレビューは api/*（この画面と同じ場所の下）に送る。
   担当者ページと共通の部品は ui/（docs/slides-role.md §5） */
import { $, $$, el, inlineMsg, why, notify, dropNotice, download, report, reportUncaught, guardLogin, LoginExpired } from './ui/dom.mjs';
import { mountMasterFiles, badge, renderPeople } from './ui/masters.mjs';
import { mountReplace } from './ui/replace.mjs';
import { mountPdfViewer, preparePdfEngine, overflowText } from './ui/pdfview.mjs';
import { SLIDE_AREAS, paintSlidesNeed as paintSlidesNeedFor, makeSlides, clearPrep } from './ui/slide-maker.mjs';
import { loadGlyphWidths, titleFit } from './ui/titlefit.mjs';
import { mountPlace } from './ui/place.mjs';
import { mountTemplates } from './ui/templates.mjs';
(function () {
  'use strict';
  let boot = null;   // config, people, hymns, readings, prayer, weeks
  let week = null;   // 編集中のデータ
  let version = null; // 読み込んだときのサーバー側の版（保存時に比べる）
  let dirty = false;
  let savedAt = null, saving = false;   // 最後に保存した時刻（サーバーの記録）・保存中か。ヘッダの状態表示に使う
  let previewRev = -1, editRev = 0;   // プレビューが最新の入力を反映しているか
  let releaseLock = null;             // 編集権（Web Locks）の解放関数

  // ---------- 汎用 ----------
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  function setPath(o, p, v) {
    const ks = p.split('.'); let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; cur = cur[k]; }
    cur[ks.at(-1)] = v;
  }
  // 共通の部品（ui/）を置く。下のイベントの登録より先に（PDF の表示欄のボタンは部品が作る）
  const masterFiles = mountMasterFiles($('[data-part="master-files"]'), {
    getBoot: () => boot,
    onMasterChanged: () => { previewRev = -1; $('#tab-preview').classList.add('stale'); },   // マスタは紙面の題に効く（番号の横の表示とプレビュー）
    afterPaint: () => { $$('input.num').forEach(hymnTitle); paintSlidesNeed(); },   // 週の入力欄・スライドタブの「pptx 未登録」も合わせる
  });
  mountReplace($('[data-part="replace"]'), {   // 名簿・曲名などは画面の候補も更新
    onJsonReplaced: async () => { boot = { ...boot, ...(await (await fetch('api/bootstrap')).json()) }; buildStatic(); loadRare(); masterFiles.paint(); $$('input.num').forEach(hymnTitle); },
  });
  const viewer = mountPdfViewer($('[data-part="pdf-view"]'), {
    bar: `
        <button type="button" class="small" id="btn-preview-refresh">作り直す</button>`,
    wrap: `
        <!-- プレビューを作っている間の進み具合 -->
        <div id="pv-progress" class="progress overlay" role="status" aria-live="polite" hidden>
          <div class="pg-box"><div class="pg-text"></div><div class="pg-bar"><i></i></div><div class="pg-note"></div></div>
        </div>`,
    onError: (e) => report('pdf-view', e),   // 表示できなかった理由は表示欄に出る。ここでは記録だけ
  });
  const templates = mountTemplates($('[data-part="templates"]'));   // テンプレの管理（マスタの側を開いたときに読む）
  // 見出しの「週報｜マスタ」。週報の入力（未保存の分も）は、マスタを開いている間もそのまま残る
  const place = mountPlace({
    onChange: (p) => {
      closeMenus(); masterFiles.relock();   // 削除の有効は、マスタを離れると戻す
      if (p === 'masters') templates.open();
      if (p === 'week' && week && $('#t5').classList.contains('active') && previewRev !== editRev) preview();   // マスタで題を変えて戻ったとき、プレビューを開いていれば作り直す
    },
  });
  if (place.get() === 'masters') templates.open();   // マスタの側で読み込んだとき
  function markDirty() { dirty = true; editRev++; $('#tab-preview').classList.toggle('stale', previewRev !== editRev); paintSaveState(); }
  // ヘッダの保存の状態（常に見えている）。「サイトに反映…」は保存済みで未保存の変更が無いときだけ出す（保存と取り違えない）
  function paintSaveState() {
    const st = $('#save-state'), pub = $('#btn-publish');
    st.classList.remove('saving', 'dirty', 'saved'); $('#week-pend').hidden = !(week && dirty);   // マスタを開いている間は「週報」の横の点で知らせる
    if (!week) { st.replaceChildren(); pub.hidden = true; $('#btn-export-pdf').disabled = $('#btn-export-json').disabled = true; return; }
    const at = savedAt ? new Date(savedAt) : null;
    const hm = at ? at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
    const when = at ? (at.toDateString() === new Date().toDateString() ? hm : `${at.getMonth() + 1}/${at.getDate()} ${hm}`) : '';
    const [cls, text] = saving ? ['saving', '保存しています…']
      : dirty && !version ? ['dirty', 'まだ保存していません']
      : dirty ? ['dirty', '未保存の変更があります']
      : ['saved', when ? `保存済み ${when}` : '保存済み'];
    st.classList.add(cls); st.replaceChildren(el('span', 'dot'), text);
    pub.hidden = saving || dirty || !version;
    $('#btn-export-pdf').disabled = $('#btn-export-json').disabled = !version;   // 保存済みの内容を渡すので、保存したことのある週だけ
  }
  const disp = (p) => (p && p.display) || '';
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const nth = (d) => Math.ceil(d.getDate() / 7);
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const fmtMD = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const fmtDay = (iso) => { const d = parseDate(iso); return d.getFullYear() === new Date().getFullYear() ? fmtMD(d) : `${d.getFullYear()}/${fmtMD(d)}`; };   // 知らせの中の週（今年でなければ年も）
  const fmtStamp = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso || '') : d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };   // 記録は UTC、表示はこの端末の時間帯
  const fmtDot = (d) => `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  const fmtJp = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  function bulletinNo(d) { const f = new Date(d.getFullYear(), 0, 1); while (f.getDay() !== 0) f.setDate(f.getDate() + 1); return Math.floor((d - f) / 864e5 / 7) + 1; }
  function calendar() {
    if (!week.date) return null;
    const d = parseDate(week.date); if (isNaN(d) || d.getDay() !== 0) return { bad: true };
    const r = boot.config.rules; const n = nth(d);
    let na = addDays(d, 7); while (!r.afternoon_weeks.includes(nth(na))) na = addDays(na, 7);
    const next = addDays(d, 7);
    return { d, n, ss: r.sunday_school_weeks.includes(n), af: r.afternoon_weeks.includes(n), nextAf: na, next, nextN: nth(next),
             nextSs: r.sunday_school_weeks.includes(nth(next)), nextAfHeld: r.afternoon_weeks.includes(nth(next)), wed: addDays(d, r.wednesday_offset_days) };
  }

  // ---------- 人物欄 ----------
  // data-filter で候補を絞る: "title:長老" / "name:〇〇,△△"（名簿の名前） / "flag:cs_teacher"。候補外の人が入っていれば「直接入力」として印刷どおりの文字を見せる
  function filterPeople(spec) {
    const all = boot.people.people;
    if (!spec) return all;
    const [kind, list] = spec.split(':'); const vals = (list || '').split(',').map(x => x.trim()).filter(Boolean);
    if (kind === 'title') return all.filter(p => vals.includes(p.title));
    if (kind === 'name') return vals.map(n => all.find(p => p.name === n)).filter(Boolean);   // 書いた順
    if (kind === 'flag') return all.filter(p => vals.some(f => (p.flags || []).includes(f)));
    return all;
  }
  function personWidget(span) {
    if (span._load) return;
    const path = span.dataset.person, notitle = !!span.dataset.notitle;
    const wrap = el('span', 'person'); const sel = el('select');
    sel.append(new Option('（未定）', ''));
    const candidates = filterPeople(span.dataset.filter);
    for (const p of candidates) sel.append(new Option(notitle ? p.name : p.name + p.title, p.id));
    sel.append(new Option('直接入力…', '__free'));
    const free = el('input'); free.placeholder = '氏名＋肩書'; free.style.display = 'none';
    if (span.dataset.required) sel.required = true;
    wrap.append(sel, free); span.append(wrap);
    const write = () => {
      if (sel.value === '__free') { free.style.display = ''; setPath(week, path, free.value ? { id: null, display: free.value } : null); }
      else { free.style.display = 'none'; const p = candidates.find(x => x.id === sel.value); setPath(week, path, p ? { id: p.id, display: notitle ? p.name : p.name + p.title } : null); }
      markDirty(); refreshRoles();
    };
    sel.addEventListener('change', write); free.addEventListener('input', write);
    span._load = () => {
      const v = getPath(week, path);
      if (!v) { sel.value = ''; free.style.display = 'none'; return; }
      const p = v.id && candidates.find(x => x.id === v.id);
      const masterText = p ? (notitle ? p.name : p.name + p.title) : null;
      if (p && (!v.display || v.display === masterText)) { sel.value = v.id; free.style.display = 'none'; }
      else { sel.value = '__free'; free.value = v.display || ''; free.style.display = ''; }   // 肩書が名簿と違う等：印刷どおりの文字を見せる
    };
    span._load();
  }

  // ---------- 聖書箇所（書名は一覧から選ぶ、章・節は選択） ----------
  // 値は従来どおり文字列（マタイ28:16-20 / 詩篇90篇 / エステル5:1-8:17）。api/bible/books の書名一覧・章数・節数で選択肢を作る
  let bible = null;   // { books:[{id,name,short,testament,chapters:[節数]}], aliases:{書き方: id} }
  let parseRef = null;
  const bookLabel = (b) => b.short;   // 印刷に使う書名（略称が無い書は正式名）
  function bookByText(t) {
    if (!bible || !t) return null;
    const k = t.trim().replace(/\s/g, '');
    const id = bible.aliases[k] ?? bible.aliases[t.trim()];
    return bible.books.find(b => b.id === id) || bible.books.find(b => b.short === k || b.name === k) || null;
  }
  function refWidget(span) {
    if (span._load) return;
    const path = span.dataset.ref;
    const wrap = el('span', 'ref');
    const book = el('input', 'book'); book.setAttribute('list', 'bible-books'); book.placeholder = '書名'; book.autocomplete = 'off';
    const ch = el('select', 'ch'), v1 = el('select', 'v1'), ch2 = el('select', 'ch2'), v2 = el('select', 'v2');
    const dash = el('span', 'sep', '–'), colon1 = el('span', 'sep', ':'), colon2 = el('span', 'sep', ':');
    const cross = el('button', 'tiny', '章をまたぐ'); cross.type = 'button'; cross.title = '終わりを別の章にする（例: エステル5:1-8:17）';
    const out = el('span', 'ref-out');
    wrap.append(book, ch, colon1, v1, dash, ch2, colon2, v2, cross, out); span.append(wrap);
    let cur = null;   // 選ばれている書
    const fill = (sel, n, blank) => { const keep = sel.value; sel.innerHTML = ''; if (blank) sel.append(new Option(blank, '')); for (let i = 1; i <= n; i++) sel.append(new Option(String(i), String(i))); sel.value = [...sel.options].some(o => o.value === keep) ? keep : (blank ? '' : '1'); };
    const isPsalm = () => cur && cur.id === 19;
    // 節の選択肢：先頭は空白（未選択）、次に「章全体」（詩篇は「篇全体」）、その後に 1〜n。
    // 未選択は「マタイ28:」、章全体は「マタイ28章」として保存する（未選択でも保存できる。入力の誤りにはしない。2026-10-16）
    const WHOLE = 'whole';
    const fillVerse = () => { const keep = v1.value; v1.innerHTML = ''; v1.append(new Option('', ''), new Option(isPsalm() ? '篇全体' : '章全体', WHOLE)); for (let i = 1; i <= nV(ch.value); i++) v1.append(new Option(String(i), String(i))); v1.value = [...v1.options].some(o => o.value === keep) ? keep : ''; };
    const hasVerse = () => /^\d+$/.test(v1.value);
    const nCh = () => cur ? cur.chapters.length : 0;
    const nV = (c) => cur ? (cur.chapters[Number(c) - 1] || 0) : 0;
    const crossing = () => ch2.style.display !== 'none';
    const layout = () => {
      const hasBook = !!cur;
      for (const e of [ch, v1]) e.style.display = hasBook ? '' : 'none';
      const hasV = hasBook && hasVerse();
      colon1.style.display = hasV ? '' : 'none';   // 未選択・章全体のときは : も – も出さない
      for (const e of [dash, v2]) e.style.display = hasV ? '' : 'none';
      cross.style.display = hasV && !crossing() ? '' : 'none';
      for (const e of [ch2, colon2]) e.style.display = hasV && crossing() ? '' : 'none';
    };
    const compose = () => {
      if (!cur || !ch.value) return '';
      const name = bookLabel(cur);
      if (v1.value === WHOLE) return `${name}${ch.value}${isPsalm() ? '篇' : '章'}`;
      if (!hasVerse()) return `${name}${ch.value}:`;   // 節が未選択
      if (v2.value === '') return `${name}${ch.value}:${v1.value}`;
      if (crossing() && ch2.value && ch2.value !== ch.value) return `${name}${ch.value}:${v1.value}-${ch2.value}:${v2.value}`;
      return `${name}${ch.value}:${v1.value}-${v2.value}`;
    };
    const refillV2 = () => {
      const c2 = crossing() && ch2.value ? ch2.value : ch.value;
      const from = c2 === ch.value ? (hasVerse() ? Number(v1.value) : 0) + 1 : 1;
      const keep = v2.value; v2.innerHTML = ''; v2.append(new Option('', ''));
      for (let i = from; i <= nV(c2); i++) v2.append(new Option(String(i), String(i)));
      v2.value = [...v2.options].some(o => o.value === keep) ? keep : '';
    };
    const write = () => {
      if (!span.isConnected) return;   // 行が消された後に届く change は無視（消した位置に書き戻さない）
      const text = compose(); out.textContent = text; setPath(week, path, text); markDirty();
      if (path.startsWith('sunday_school.')) refreshYouth();   // 中高科の欄に写す
      book.classList.toggle('bad', !!book.value && !cur);
      if (book.value && !cur) { out.textContent = '書名の一覧にありません。候補から選んでください'; out.classList.add('bad'); } else out.classList.remove('bad');
      if (cur) span.dispatchEvent(new CustomEvent('refbook', { bubbles: true, detail: { path, book: cur } }));   // ページ欄の新約/旧約を合わせる
    };
    book.addEventListener('input', () => { const b = bookByText(book.value); if (b && b !== cur) { cur = b; fill(ch, nCh(), null); fillVerse(); fill(ch2, nCh(), null); ch2.value = ch.value; refillV2(); layout(); write(); } else if (!b) { cur = null; layout(); write(); } });
    book.addEventListener('change', () => { const b = bookByText(book.value); cur = b; if (b) book.value = bookLabel(b); else if (book.value) out.textContent = ''; if (b) { fill(ch, nCh(), null); fillVerse(); fill(ch2, nCh(), null); refillV2(); } layout(); write(); });
    ch.addEventListener('change', () => { fillVerse(); if (!crossing() || Number(ch2.value) < Number(ch.value)) ch2.value = ch.value; refillV2(); layout(); write(); });
    v1.addEventListener('change', () => { refillV2(); layout(); write(); });
    ch2.addEventListener('change', () => { refillV2(); layout(); write(); });
    v2.addEventListener('change', write);
    cross.addEventListener('click', () => { ch2.style.display = ''; ch2.value = ch.value; refillV2(); layout(); });
    span._load = () => {
      const text = getPath(week, path) || '';
      const r = parseRef && text ? parseRef(text) : null;
      cur = r ? bookByText(r.book) : null;
      book.value = cur ? bookLabel(cur) : text;   // 解釈できない文字はそのまま見せる（印刷はされる）
      book.classList.toggle('bad', !!text && !cur);
      ch2.style.display = 'none';
      if (cur) {
        fill(ch, nCh(), null); ch.value = String(Math.min(r.chapter, nCh()));
        fillVerse(); v1.value = r.verse != null ? String(r.verse) : /[章篇]\s*$/.test(text) ? WHOLE : '';   // 節なし: 末尾が「章」「篇」なら章全体、そうでなければ未選択
        fill(ch2, nCh(), null); ch2.value = r.chapter2 != null ? String(r.chapter2) : ch.value;
        if (r.chapter2 != null && r.verse != null) ch2.style.display = '';
        refillV2(); v2.value = r.verse2 != null ? String(r.verse2) : '';
      }
      out.textContent = cur ? compose() : '';
      layout();
    };
    span._load();
  }
  // 聖書のページ「(2017新約p.64)」: 新約/旧約は二択、数字だけ入力。書名を選ぶと新約/旧約が合う
  function pageWidget(span) {
    if (span._load) return;
    const path = span.dataset.page;
    const wrap = el('span', 'page');
    const t = el('select'); t.append(new Option('新約', '新'), new Option('旧約', '旧'));
    const n = el('input'); n.type = 'number'; n.min = 1; n.max = 9999; n.placeholder = '頁';
    wrap.append(el('span', 'fixed', '(2017'), t, el('span', 'fixed', 'p.'), n, el('span', 'fixed', ')')); span.append(wrap);
    const write = () => { setPath(week, path, n.value ? `(2017${t.value}約p.${n.value})` : ''); markDirty(); };
    t.addEventListener('change', write); n.addEventListener('input', write);
    span._load = () => {
      const text = getPath(week, path) || '';
      const m1 = text.match(/(新|旧)約/), m2 = text.match(/[pｐ]\.?\s*([0-9０-９]+)/);
      t.value = m1 ? m1[1] : '新'; n.value = m2 ? m2[1].replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)) : '';
    };
    span._load();
    // 同じ区画の聖書朗読の書名が決まったら新約/旧約を合わせる（morning.scripture.ref → morning.scripture.page）
    document.addEventListener('refbook', (e) => { if (e.detail.path === path.replace(/\.page$/, '.ref')) { t.value = e.detail.book.testament === 1 ? '旧' : '新'; write(); } });
  }

  // ---------- 通常の入力欄（name で週データに結びつける） ----------
  function bindInputs(scope) {
    $$('[name]', scope).forEach(inp => {
      if (inp._bound) return; inp._bound = true;
      const path = inp.name;
      if (inp.dataset.lines) titleLines(inp);   // 題の欄：2 行にできる（紙面の改行位置。ARCHITECTURE.md §3.1・§14.7）
      inp.addEventListener('input', () => {
        let v = inp.value;
        if (inp.type === 'number') v = v === '' ? null : Number(v);
        setPath(week, path, v); if (inp.dataset.lines) { setPath(week, path + '_break', null); inp._lines.measure(); } markDirty();   // 1 行の欄で直したら 1 行
        if (inp.dataset.soft) softCount(inp);
        if (inp.classList.contains('num')) hymnTitle(inp);
        if (path === 'date') refreshAuto();
        if (path.startsWith('sunday_school.')) refreshYouth();
      });
      if (inp.dataset.soft && !inp.nextElementSibling?.classList?.contains('soft')) inp.after(el('span', 'soft'));
    });
  }
  function loadInput(inp) {
    let v = getPath(week, inp.name);
    inp.value = v == null ? '' : v;
    if (inp.dataset.soft) softCount(inp);
    if (inp.classList.contains('num')) hymnTitle(inp);
    if (inp._lines) inp._lines.load();
  }
  // ---------- 題の欄（2 行にできる） ----------
  // 題は 1 本の文字列のまま（スライド・サイトも使う）、紙面の改行位置を <題>_break（1 行目の字数）に持つ。
  // 「2 行」で 1 行目・2 行目の 2 つの欄に分け、「1 行に」で戻す。分けるときはカーソルの位置（無ければ最初の空白、無ければ真ん中）で切る
  const chars = (s) => [...(s || '')];
  function titleLines(inp) {
    const path = inp.name, max = inp.maxLength > 0 ? inp.maxLength : Infinity;
    const wrap = el('span', 'title-in'), lines = el('span', 'lines'), btn = el('button', 'small two', '2 行'), meter = el('span', 'fitmeter');
    btn.type = 'button'; btn.title = '紙面で 2 行にする（改行の位置を決める）';
    const l1 = el('input', 'inline'), l2 = el('input', 'inline');
    l1.placeholder = '1 行目'; l2.placeholder = '2 行目'; l1.setAttribute('aria-label', '1 行目'); l2.setAttribute('aria-label', '2 行目');
    lines.append(l1, l2); lines.hidden = true;
    inp.before(wrap); wrap.append(inp, lines, btn, meter);
    const measure = () => {   // 紙面の欄に入るか（字幅表が届く前と、fit の無い古いサーバーでは何も出さない）
      const r = titleFit(boot.fit, getPath(week, path) || '', getPath(week, path + '_break'));
      meter.textContent = r.text; meter.className = 'fitmeter' + (r.kind ? ' ' + r.kind : '');
    };
    const two = () => !lines.hidden;
    const paint = () => { inp.hidden = two(); btn.textContent = two() ? '1 行に' : '2 行'; btn.title = two() ? '紙面で 1 行に戻す' : '紙面で 2 行にする（改行の位置を決める）'; };
    const write = (from) => {   // 2 つの欄 → 題と改行位置。合わせて上限を超えたら、いま打った欄の後ろを削る
      const over = chars(l1.value + l2.value).length - max; if (over > 0) from.value = chars(from.value).slice(0, -over).join('');
      const t = l1.value + l2.value; inp.value = t;
      setPath(week, path, t); setPath(week, path + '_break', l1.value && l2.value ? chars(l1.value).length : null);
      markDirty(); measure(); if (path.startsWith('sunday_school.')) refreshYouth();
    };
    l1.addEventListener('input', () => write(l1)); l2.addEventListener('input', () => write(l2));
    const split = (n) => { const cs = chars(inp.value); l1.value = cs.slice(0, n).join(''); l2.value = cs.slice(n).join(''); };
    // カーソルの位置を覚えておく（ボタンを押すと欄からフォーカスが外れる。iPad では欄を離れるとカーソルも消える）
    let caret = -1; const keep = () => { if (inp.selectionStart != null) caret = chars(inp.value.slice(0, inp.selectionStart)).length; };
    ['input', 'keyup', 'click', 'select', 'blur'].forEach(ev => inp.addEventListener(ev, keep));
    btn.addEventListener('click', () => {
      if (two()) { inp.value = l1.value + l2.value; lines.hidden = true; paint(); setPath(week, path + '_break', null); markDirty(); measure(); inp.focus(); if (path.startsWith('sunday_school.')) refreshYouth(); return; }
      const cs = chars(inp.value);
      const sp = cs.findIndex(c => /\s/.test(c));
      split(caret > 0 && caret < cs.length ? caret : sp > 0 ? sp + 1 : Math.ceil(cs.length / 2));
      lines.hidden = false; paint(); write(l2); (l2.value ? l2 : l1).focus();
    });
    inp._lines = { load: () => {   // 週を開いたとき：改行位置が使えれば 2 行で
      caret = -1;
      const brk = getPath(week, path + '_break'), n = chars(inp.value).length;
      const ok = Number.isInteger(brk) && brk >= 1 && brk < n;
      lines.hidden = !ok; if (ok) split(brk); paint(); measure();
    }, measure };
  }
  function softCount(inp) {
    const s = inp.nextElementSibling; if (!s || !s.classList.contains('soft')) return;
    const n = [...inp.value].length, max = Number(inp.dataset.soft);
    s.textContent = n > max ? `${n}字（目安${max}字。自動で縮小）` : '';
    s.classList.toggle('over', n > max);
  }
  function hymnTitle(inp) {   // 番号の横の表示: マスタなし→「曲名が未登録」／マスタあり・pptx なし→「（曲名）pptx 未登録」／完備→「（曲名）」
    const t = inp.parentElement?.querySelector('.htitle'); if (!t) return;
    const kind = inp.dataset.master === 'readings' ? 'readings' : 'hymns'; const no = String(inp.value);
    t.textContent = ''; t.classList.remove('missing');
    if (!inp.value) return;
    const title = boot[kind][no];
    if (!title) {   // 押すと、マスタの新規にこの番号を入れて開く（週報の入力はそのまま残る）
      const a = el('a', null, `${kind === 'readings' ? '題' : '曲名'}が未登録（マスタで登録）`); a.href = '#masters'; a.title = 'マスタを開いて、新規の欄にこの番号を入れます';
      a.addEventListener('click', (e) => { e.preventDefault(); place.go('masters'); masterFiles.startNew(kind, no); });
      t.append(a); t.classList.add('missing'); return;
    }
    t.textContent = `（${title}）`;
    if (!(boot.files?.[kind] || {})[no]) t.append(' ', badge('nofile'));   // スライドの素材が無い（pptx 担当者の作業待ち）
  }


  // ---------- 役割 → 表示名（右列） ----------
  function roleText(section, role) {
    const m = week.morning;
    switch (role) {
      case 'prayer': return disp(m.prayer);
      case 'preacher': return disp(m.preacher);
      case 'offering': return disp(m.offering);
      case 'offering_prayer': return roleSlot(m.offering_prayer);
      case 'benediction': return roleSlot(m.benediction);
      case 'pastor': { const p = boot.people.people.find(x => (x.flags || []).includes('pastor')) || boot.people.people.find(x => x.title === '牧師'); return p ? p.name + p.title : disp(m.preacher); }
      case 'presider_preacher': return disp(section.presider_preacher);
      default: return '';
    }
  }
  const SLOT_KEYS = ['preacher', 'label_preacher', 'presider'];
  const roleSlot = (v) => v === 'presider' ? '司会者' : v === 'label_preacher' ? '説教者' : (!v || v === 'preacher') ? disp(week.morning.preacher) : String(v);   // 3 語以外は直接入力の文字
  function refreshRoles() {
    $$('[data-role]').forEach(e => { const sec = week[e.dataset.section] || {}; e.textContent = roleText(sec, e.dataset.role) || '（未定）'; });
  }

  // ---------- 式順（主日礼拝・午後礼拝・水曜祈祷会） ----------
  // 標準の式順は config.json。週データに <section>.program があればそれが正（「式の編集」で足す・並べ替える・外す）。
  function makeRow(labelText) {
    const row = el('div', 'prow'); const lbl = el('span', 'lbl'); const val = el('span', 'val'); const rgt = el('span', 'rgt');
    if (labelText) lbl.append(el('span', 'dist', labelText));
    row.append(lbl, val, rgt); return { row, lbl, val, rgt };
  }
  function contentInput(section, key, soft) {
    const inp = el('input', 'inline'); inp.name = `${section}.${key}`; if (soft) inp.dataset.soft = soft; return inp;
  }
  function numInput(val, section, key, master) {
    const inp = el('input', 'num'); inp.type = 'number'; inp.min = 1; inp.max = 999; inp.name = `${section}.${key}`;
    if (master === 'readings') inp.dataset.master = 'readings';
    val.append(inp, el('span', 'htitle'));
  }
  function rightCell(sectionName, r, rgt) {
    if (!r) return;
    if (!r.startsWith('role:')) { rgt.append(el('span', 'dist', r)); return; }
    const role = r.slice(5);
    if (sectionName === 'morning' && (role === 'prayer' || role === 'offering')) {
      const span = el('span'); span.dataset.person = `morning.${role}`; span.dataset.required = '1'; span.dataset.filter = role === 'prayer' ? 'title:長老' : 'title:執事'; rgt.append(span);   // 祈祷＝長老、献金＝執事
      if (role === 'offering') rgt.append(el('span', 'carry', '引き継ぎ'));
      return;
    }
    const t = el('span', 'ro'); t.dataset.role = role; t.dataset.section = sectionName; rgt.append(t);
    if (role === 'offering_prayer' || role === 'benediction') {   // 値: preacher | label_preacher | presider | 直接入力の文字
      const sel = el('select'); sel.dataset.slot = role;
      sel.append(new Option('説教者に同じ', 'preacher'), new Option('「説教者」と印字', 'label_preacher'), new Option('「司会者」と印字', 'presider'), new Option('直接入力…', '__free'));
      const free = el('input'); free.placeholder = '氏名＋肩書'; free.style.display = 'none'; free.className = 'inline'; free.style.width = '9em';
      sel.title = '印字する内容を選ぶ'; rgt.append(sel, free);
      const write = () => { if (sel.value === '__free') { free.style.display = ''; setPath(week, `morning.${role}`, free.value); } else { free.style.display = 'none'; setPath(week, `morning.${role}`, sel.value); } markDirty(); refreshRoles(); };
      sel.addEventListener('change', write); free.addEventListener('input', write);
      sel._load = () => { const v = getPath(week, `morning.${role}`) || 'preacher'; if (SLOT_KEYS.includes(v)) { sel.value = v; free.style.display = 'none'; } else { sel.value = '__free'; free.value = v; free.style.display = ''; } };
      sel._load();
    }
  }
  // 標準の項目の入力欄（content の種類ごと）
  const refSpan = (path) => { const sp = el('span'); sp.dataset.ref = path; return sp; };
  function stdContentCell(sectionName, val, c) {
    if (c === 'call_to_worship') val.append(refSpan(`${sectionName}.call_to_worship`));
    else if (c && c.startsWith('hymn:')) numInput(val, sectionName, `hymns.${c.slice(5)}`);
    else if (c === 'hymn') numInput(val, sectionName, 'hymn');
    else if (c === 'responsive_reading') numInput(val, sectionName, 'responsive_reading', 'readings');
    else if (c === 'scripture') val.append(refSpan(sectionName === 'afternoon' ? 'afternoon.scripture' : `${sectionName}.scripture.ref`));
    else if (c === 'sermon_title') { const i = contentInput(sectionName, 'sermon_title'); i.maxLength = 40; i.placeholder = '説教題'; i.dataset.lines = '2'; val.append(i); }   // 字数の目安の代わりに「入るか」を出す（§14.7）
    else if (c === 'doxology') val.append(el('span', 'ro', `${boot.config.doxology.number}（${boot.config.doxology.title}）`));
  }

  const SECTIONS = {
    morning:   { container: '#m-program', cfg: () => boot.config.morning.program, presets: () => boot.config.morning.extras_presets },
    afternoon: { container: '#a-program', cfg: () => boot.config.afternoon.program },
    wednesday: { container: '#w-program', cfg: () => boot.config.wednesday.program },
  };
  const programEdit = { morning: false, afternoon: false, wednesday: false };   // 「式の編集」モード
  const KNOWN = /^(call_to_worship|hymn:\d+|hymn|responsive_reading|scripture|sermon_title|doxology|worship_songs)$/;
  const normItem = (x) => (!x.preset && x.content && !KNOWN.test(x.content))
    ? { label: x.label || '', text: x.content, right: x.right === 'role:pastor' ? roleText(week.morning, 'pastor') : (x.right && !String(x.right).startsWith('role:') ? x.right : '') }   // 旧形式の「その他」を吸収
    : x;
  function effectiveItems(sectionName) {
    const sec = week[sectionName]; const S = SECTIONS[sectionName];
    if (Array.isArray(sec.program) && sec.program.length) { sec.program = sec.program.map(normItem); return sec.program; }
    const items = S.cfg().map(x => Object.assign({}, x));
    if (sectionName === 'morning') {
      const presets = S.presets();
      for (const ex of (sec.extras || [])) {
        const preset = presets[ex.preset] || {}; const after = ex.after || preset.after;
        const idx = items.findIndex(x => x.content === after || x.label === after);
        items.splice(idx + 1, 0, normItem(Object.assign({}, ex)));
      }
    }
    return items;
  }
  function materializeProgram(sectionName) {   // 編集を始めたら、式順を週データに固定する（以後この週はこのリストが正）
    const sec = week[sectionName];
    if (!Array.isArray(sec.program) || !sec.program.length) { sec.program = effectiveItems(sectionName).map(x => Object.assign({}, x)); if (sectionName === 'morning') sec.extras = []; }
    return sec.program;
  }
  // ワーシップ曲：入れた曲数＋空欄1つ（印刷は入れた曲数ぶんの行だけ）
  function worshipSongRows(container, it, editing) {
    const songs = (week.afternoon.worship_songs = (week.afternoon.worship_songs || []).filter(Boolean));
    const MAX = 8; let last = null;
    const addRow = (i) => {
      const r = makeRow(i === 0 ? it.label : '');
      const inp = el('input', 'inline'); inp.dataset.soft = 14; inp.value = songs[i] || ''; inp.placeholder = i === 0 ? 'ワーシップ曲名' : '（次の曲）';
      inp.addEventListener('input', () => {
        songs[i] = inp.value; markDirty(); softCount(inp);
        if (inp.value && i === songs.length - 1 && r.row === last && i + 1 < MAX) addRow(i + 1);   // 最後の欄が埋まったら次の空欄を出す
      });
      r.val.append(inp, el('span', 'soft')); softCount(inp);
      if (i === 0) rightCell('afternoon', it.right, r.rgt);
      if (editing) r.row.classList.add('editing');
      if (last) last.after(r.row); else container.append(r.row);
      last = r.row;
    };
    for (let i = 0; i <= Math.min(songs.length, MAX - 1); i++) addRow(i);
  }
  function buildEditableProgram(sectionName) {
    const S = SECTIONS[sectionName]; const container = $(S.container); container.innerHTML = '';
    const sec = week[sectionName]; const editing = programEdit[sectionName];
    const presets = S.presets ? S.presets() : {};
    const items = effectiveItems(sectionName);
    const bar = el('div', 'pedit-bar');
    const mutate = (fn) => { const list = materializeProgram(sectionName); fn(list); markDirty(); buildEditableProgram(sectionName); };
    const insertAfter = (i) => mutate(list => list.splice(i + 1, 0, { label: '', text: '', right: '' }));
    // 聖餐式（主日礼拝・月1回の定常）：説教の行の下の「＋ 聖餐式を追加」で入れる。番号は賛美と同じ扱い
    const communion = presets['聖餐式'];
    const hasCommunion = items.some(x => x.preset === '聖餐式');
    const addCommunion = () => mutate(list => { const i = list.findIndex(x => x.content === communion.after); list.splice((i < 0 ? list.length - 1 : i) + 1, 0, { preset: '聖餐式', hymn: null }); });
    const removeCommunion = () => mutate(list => { const at = list.findIndex(x => x.preset === '聖餐式'); if (at >= 0) list.splice(at, 1); });
    const tog = el('button', 'small', editing ? '式の編集を終える' : '式の編集（非定常の式を足す・並べ替える・外す）'); tog.type = 'button';
    tog.addEventListener('click', () => { programEdit[sectionName] = !editing; if (!editing) materializeProgram(sectionName); buildEditableProgram(sectionName); });
    bar.append(tog);
    if (editing) {
      const reset = el('button', 'small', '標準の式順に戻す'); reset.type = 'button';
      reset.addEventListener('click', () => { if (confirm('この週の式順を標準（追加項目なし）に戻します。よろしいですか？')) { sec.program = []; if (sectionName === 'morning') sec.extras = []; markDirty(); buildEditableProgram(sectionName); } });
      bar.append(reset, el('span', 'note', '各行の ＋ で下に行を追加（名称・内容・担当は自由入力）、↑↓ で並べ替え、削除で外す'));
    }
    container.append(bar);
    if (editing) { const top = el('div', 'prow addline'); const b = el('button', null, '＋ 先頭に追加'); b.type = 'button'; b.addEventListener('click', () => insertAfter(-1)); top.append(el('span'), b); container.append(top); }

    items.forEach((it, i) => {
      const ops = () => {
        if (!editing) return null;
        const o = el('span', 'pops');
        const mk = (t, fn, title) => { const b = el('button', null, t); b.type = 'button'; b.title = title; b.addEventListener('click', fn); return b; };
        o.append(mk('＋', () => insertAfter(i), 'この下に追加'),
                 mk('↑', () => mutate(l => { if (i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]]; }), '上へ'),
                 mk('↓', () => mutate(l => { if (i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]]; }), '下へ'),
                 mk('削除', () => mutate(l => l.splice(i, 1)), '外す'));
        return o;
      };
      if (it.content === 'worship_songs') {   // 午後礼拝のワーシップ曲（複数行）
        const before = container.childElementCount; worshipSongRows(container, it, editing);
        const first = container.children[before]; const o = ops(); if (o && first) first.append(o);
        return;
      }
      const { row, lbl, val, rgt } = makeRow('');
      const isStd = !!it.content || (!it.preset && it.text == null);
      if (it.preset) {
        row.classList.add('extra');
        const p = presets[it.preset] || {};
        lbl.append(el('span', 'dist', it.preset));
        if (p.content === 'param:hymn') {                      // 聖餐式：賛美と同じ（番号→曲名）
          const inp = el('input', 'num'); inp.type = 'number'; inp.min = 1; inp.max = 999; inp.value = it.hymn ?? '';
          inp.addEventListener('input', () => { it.hymn = inp.value === '' ? null : Number(inp.value); markDirty(); hymnTitle(inp); });
          val.append(inp, el('span', 'htitle')); hymnTitle(inp);
        } else if (p.content === 'param:person') {
          const inp = el('input', 'inline'); inp.placeholder = '対象者（氏名＋肩書）'; inp.value = it.person || '';
          inp.addEventListener('input', () => { it.person = inp.value; markDirty(); }); val.append(inp);
        }
        rgt.append(el('span', 'ro', roleText(week.morning, 'pastor')));
        if (it.preset === '聖餐式' && !editing) { const x = el('button', 'small', '外す'); x.type = 'button'; x.addEventListener('click', removeCommunion); rgt.append(x); }
      } else if (isStd) {
        lbl.append(el('span', 'dist', it.label));
        stdContentCell(sectionName, val, it.content);
        rightCell(sectionName, it.right, rgt);
      } else {                                                 // その他：名称・内容・担当を文字で
        row.classList.add('extra');
        const li = el('input', 'inline'); li.placeholder = '名称（例：転入会式）'; li.value = it.label || '';
        li.addEventListener('input', () => { it.label = li.value; markDirty(); });
        lbl.append(li);
        const ti = el('input', 'inline'); ti.placeholder = '内容（任意）'; ti.value = it.text || '';
        ti.addEventListener('input', () => { it.text = ti.value; markDirty(); });
        const ri = el('input', 'inline'); ri.placeholder = '担当（例：司会者）'; ri.value = it.right || ''; ri.style.width = '9em';
        ri.addEventListener('input', () => { it.right = ri.value; markDirty(); });
        val.append(ti); rgt.append(ri);
      }
      const o = ops(); if (o) { row.append(o); row.classList.add('editing'); }
      container.append(row);
      if (it.content === 'scripture' && sectionName !== 'afternoon') {   // ページ行 (2017新約p.64)
        const r3 = makeRow(''); const pg = el('span'); pg.dataset.page = `${sectionName}.scripture.page`; r3.val.append(pg); if (editing) r3.row.classList.add('editing'); container.append(r3.row);
      }
      if (communion && it.content === communion.after && !hasCommunion && !editing) {   // 説教の下：聖餐式の追加（定常なので編集モード不要）
        const ra = makeRow(''); ra.row.classList.add('addline'); const b = el('button', null, '＋ 聖餐式を追加'); b.type = 'button'; b.addEventListener('click', addCommunion); ra.val.append(b); container.append(ra.row);
      }
    });
    bindInputs(container); $$('[name]', container).forEach(loadInput); $$('[data-person]', container).forEach(personWidget);
    $$('[data-ref]', container).forEach(refWidget); $$('[data-page]', container).forEach(pageWidget);
    refreshRoles(); if (week) applySuspended();
  }

  // ---------- 本日の予定 ----------
  function buildSchedule() {
    const cal = calendar(); const s = boot.config.schedule; const t = $('#sch-rows'); t.innerHTML = '';
    $('#sch-title').textContent = s.title.replace('{day}', cal && cal.d ? cal.d.getDate() : '');
    for (const r of s.rows) {
      const tr = el('tr'); tr.append(el('td', 'lbl', r.label));
      const td = el('td');
      if (r.time_rule === 'sunday_school') { td.textContent = cal && !cal.bad ? (heldBy(week.sunday_school?.suspended, cal.ss) ? s.sunday_school_time : '休') : ''; td.append(el('span', 'auto-badge', '自動')); }
      else if (r.time_rule === 'afternoon') { td.textContent = cal && !cal.bad ? (heldBy(week.afternoon?.suspended, cal.af) ? s.afternoon_time : '休') : ''; td.append(el('span', 'auto-badge', '自動')); }
      else if (r.time_rule === 'carry') { const inp = el('input', 'inline'); inp.name = `schedule.${r.key}`; inp.dataset.soft = 5; inp.style.width = '5em'; td.append(inp, el('span', 'carry', '引き継ぎ')); }
      else td.textContent = r.time;
      tr.append(td, el('td', null, r.floor)); t.append(tr);
    }
    bindInputs(t); $$('[name]', t).forEach(loadInput);
  }

  // ---------- 先週の報告（表） ----------
  function buildLastWeek() {
    const cfg = boot.config.last_week; const t = $('#lw-table'); t.innerHTML = '';
    const tr = el('tr'); cfg.columns.forEach((h, i) => { const th = el('th', null, h); if (i === 3) th.append(el('span', 'carry', '項目名は引き継ぎ')); tr.append(th); }); t.append(tr);
    const off = week.last_week.offering ||= [];
    while (off.length < cfg.offering_rows) off.push({ name: '', amount: '' });
    cfg.attendance_rows.forEach((r, i) => {
      const row = el('tr');
      row.append(el('td', 'lbl', r.label), el('td', 'lbl', r.time));
      const a = el('td'); const ai = el('input', 'inline'); ai.name = `last_week.attendance.${r.key}`; ai.style.width = '4em'; ai.placeholder = '休'; a.append(ai);
      const n = el('td'); const ni = el('input', 'inline'); ni.name = `last_week.offering.${i}.name`; ni.placeholder = '項目名'; n.append(ni);
      const m = el('td', 'amt'); const mi = el('input', 'inline'); mi.type = 'number'; mi.min = 0; mi.name = `last_week.offering.${i}.amount`; mi.style.width = '7em'; m.append(mi);
      row.append(a, n, m); t.append(row);
    });
    bindInputs(t); $$('[name]', t).forEach(loadInput);
  }

  // ---------- 報告の段落 ----------
  function buildParas() {
    const box = $('#paras'); box.innerHTML = '';
    const body = week.announcements.body ||= [];
    body.forEach((t, i) => {
      const row = el('div', 'arow'); row.append(el('span', 'n', `${i + 2}.`));
      const ta = el('textarea'); ta.rows = 2; ta.value = t; ta.placeholder = '段落。改行もそのまま印刷されます';
      const grow = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
      ta.addEventListener('input', () => { body[i] = ta.value; markDirty(); grow(); });
      requestAnimationFrame(grow);
      const ops = el('span', 'ops');
      const mk = (label, fn) => { const b = el('button', null, label); b.type = 'button'; b.addEventListener('click', () => { fn(); markDirty(); buildParas(); }); return b; };
      ops.append(mk('↑', () => { if (i > 0) [body[i - 1], body[i]] = [body[i], body[i - 1]]; }), mk('↓', () => { if (i < body.length - 1) [body[i + 1], body[i]] = [body[i], body[i + 1]]; }), mk('削除', () => body.splice(i, 1)));
      row.append(ta, ops); box.append(row);
    });
    $('#pf-n').textContent = `${body.length + 2}.`;
  }
  $('#btn-para-add').addEventListener('click', () => { (week.announcements.body ||= []).push(''); markDirty(); buildParas(); $$('#paras textarea').at(-1)?.focus(); });

  // ---------- 説教中の引用聖句（1 行 1 箇所、聖書箇所の部品）。値は slides.sermon_refs: string[] ----------
  // 引用聖句（スライドタブの 4 エリア。ARCHITECTURE.md §18）。保存先は slides.<key>（主日礼拝は従来の sermon_refs）
  function buildRefs() { for (const a of SLIDE_AREAS) buildRefList(a.key); }
  function buildRefList(key) {
    const box = $(`[data-refs="${key}"]`); box.innerHTML = '';
    const refs = (week.slides ||= {})[key] ||= [];
    const buildRefs = () => buildRefList(key);   // 並べ替え・削除の後はこのエリアだけ作り直す
    refs.forEach((_, i) => {
      const row = el('div', 'arow'); row.append(el('span', 'n', `${i + 1}.`));
      const sp = el('span'); sp.dataset.ref = `slides.${key}.${i}`; row.append(sp);
      const ops = el('span', 'ops');
      // 先に入力欄の焦点を外す：書名欄の change が行の消去中に届いて、消した位置に書き戻すのを防ぐ
      const mk = (label, fn) => { const b = el('button', null, label); b.type = 'button'; b.addEventListener('click', () => { document.activeElement?.blur(); fn(); markDirty(); buildRefs(); }); return b; };
      ops.append(mk('↑', () => { if (i > 0) [refs[i - 1], refs[i]] = [refs[i], refs[i - 1]]; }), mk('↓', () => { if (i < refs.length - 1) [refs[i + 1], refs[i]] = [refs[i], refs[i + 1]]; }), mk('削除', () => refs.splice(i, 1)));
      row.append(ops); box.append(row);
      refWidget(sp);
    });
    if (!refs.length) box.append(el('div', 'hint', '引用聖句はまだありません'));
  }
  $$('[data-ref-add]').forEach(b => b.addEventListener('click', () => { const key = b.dataset.refAdd; ((week.slides ||= {})[key] ||= []).push(''); markDirty(); buildRefList(key); $$(`[data-refs="${key}"] .book`).at(-1)?.focus(); }));

  // ---------- 休止（ARCHITECTURE.md §16）----------
  // suspended は 3 通り：空＝暦どおり／true＝休止（暦に関係なく休み）／false＝休止しない（暦に関係なく開く。§16.1）。
  // 暦で休みの欄は最初チェックが付いた状態（「自動」）。外すと false（「臨時に開く」）、付け直すと空に戻る。
  // 暦で開く欄は、付けると true、外すと空。チェックを付けた欄はグレーにして触れなくする（入力は消さない。印刷しないだけ）
  function heldBy(suspended, byCalendar) { return suspended === true ? false : suspended === false ? true : byCalendar; }   // render.js と同じ規則
  const SUSP = {
    afternoon: { path: 'afternoon', box: '#box-afternoon', auto: (c) => !c.af },
    wednesday: { path: 'wednesday', box: '#box-wednesday', auto: () => false },
    nx_af:     { path: 'next_week.afternoon', box: '#nx-af', auto: (c) => !c.nextAfHeld },
    nx_ss:     { path: 'next_week.sunday_school', box: '#nx-ss', auto: (c) => !c.nextSs },
    nx_youth:  { path: 'next_week.youth', box: '#nx-youth', auto: () => false, dflt: true },   // 中高科は当分休会（未設定＝休止）
  };
  function isSuspended(k, cal) {
    const d = SUSP[k]; const v = getPath(week, d.path + '.suspended');
    if (d.dflt) return v !== false;   // 中高科：未設定は休止
    if (v === true || v === false) return v;
    return !!(cal && !cal.bad && d.auto(cal));   // 空＝暦どおり
  }
  function applySuspended() {
    if (!week) return;
    const cal = calendar();
    for (const [k, d] of Object.entries(SUSP)) {
      const auto = !!(cal && !cal.bad && d.auto(cal)), on = isSuspended(k, cal), v = getPath(week, d.path + '.suspended');
      const cb = $(`[data-susp="${k}"]`); cb.checked = on; cb.disabled = false;
      const badge = $(`[data-susp-auto="${k}"]`);   // 暦で休みの欄：暦どおりなら「自動」、外していれば「臨時に開く」
      badge.hidden = !auto || (v !== false && v != null); badge.textContent = v === false ? '臨時に開く' : '自動'; badge.classList.toggle('open', v === false);
      const box = $(d.box); box.classList.toggle('suspended', on);
      $$('input, select, textarea, button', box).forEach(c => { if (!c.closest('.susp, .nextdate')) c.disabled = on; });
    }
  }
  $$('[data-susp]').forEach(cb => cb.addEventListener('change', () => {
    const d = SUSP[cb.dataset.susp]; const cal = calendar(); const auto = !!(cal && !cal.bad && d.auto(cal));
    const value = d.dflt ? cb.checked : cb.checked ? (auto ? null : true) : (auto ? false : null);   // 暦と同じになる側は空（暦どおり）に戻す
    setPath(week, d.path + '.suspended', value);
    markDirty(); refreshAuto();
  }));
  // 午後礼拝の案内：ふだんは出さない。「案内を追加」で 3 行目を出し、「外す」で消す（担当者も消す）。
  // 担当者が入っている週は追加済み。紙面は担当者がいるときだけ印刷。次の週には引き継がない（ARCHITECTURE.md §16.4）
  function paintUsher() {
    const shown = !!(week.afternoon?.usher_shown || week.afternoon?.usher);
    $('#usher-row').hidden = !shown; $('#btn-usher-add').hidden = shown;
  }
  $('#btn-usher-add').addEventListener('click', () => { week.afternoon.usher_shown = true; markDirty(); paintUsher(); $('#usher-row select')?.focus(); });
  $('#btn-usher-remove').addEventListener('click', () => {
    week.afternoon.usher_shown = false; week.afternoon.usher = null;
    $('[data-person="afternoon.usher"]')._load?.(); markDirty(); paintUsher();
  });
  // 次回の午後礼拝（render.js と同じ規則）：次の第 2・4 日曜。次週が休止ならその日は飛ばす。手で直した日付があればそれ
  function nextAfternoon(cal) {
    if (week.afternoon?.next_date && /^\d{4}-\d{2}-\d{2}$/.test(week.afternoon.next_date)) return parseDate(week.afternoon.next_date);
    const r = boot.config.rules; const nx = week.next_week?.afternoon?.suspended;
    const heldOn = (x) => +x === +cal.next ? heldBy(nx, r.afternoon_weeks.includes(nth(x))) : r.afternoon_weeks.includes(nth(x));   // 次週は次週欄の休止・臨時に開くに従う
    let d = addDays(cal.d, 7);
    while (!heldOn(d)) d = addDays(d, 7);
    return d;
  }
  $('#af-next-edit').addEventListener('click', () => { $('#af-next-editor').hidden = false; $('#af-next-date').focus(); });
  $('#af-next-date').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v && parseDate(v).getDay() !== 0) return inlineMsg($('#af-next-reset'), '日曜日を選んでください');
    inlineMsg($('#af-next-reset'), ''); week.afternoon.next_date = v || null; markDirty(); refreshAuto();
  });
  $('#af-next-reset').addEventListener('click', () => { inlineMsg($('#af-next-reset'), ''); week.afternoon.next_date = null; $('#af-next-editor').hidden = true; markDirty(); refreshAuto(); });

  // ---------- 自動欄・読み取り専用欄 ----------
  function refreshAuto() {
    const cal = calendar();
    const bad = !cal || cal.bad;
    $('#date-view').textContent = week.date ? fmtDot(parseDate(week.date)) + '.' : '';
    $('#auto-no').textContent = bad ? (week.date ? '日曜ではありません' : '') : `NO.${bulletinNo(cal.d)}（第${cal.n}日曜）`;
    $('#auto-time').textContent = boot.config.morning.time_label;
    const ssHeld = !bad && heldBy(week.sunday_school?.suspended, cal.ss), ssS = week.sunday_school?.suspended;
    $('#jjs-note').textContent = bad ? '' : ssS === false && !cal.ss ? '今週は臨時に実施（前週の次週欄で決めたもの）' : ssS === true && cal.ss ? '今週は休止（前週の次週欄で決めたもの）。聖書・題は載り、司会・お話は印刷されません'
      : ssHeld ? '今週は実施（第1・第3日曜）' : '今週は休。聖書・題は載り、司会・お話は印刷されません';
    const afHeld = !bad && heldBy(week.afternoon?.suspended, cal.af);
    const nextAf = bad ? null : nextAfternoon(cal);
    $('#af-title').textContent = bad || afHeld ? '午後礼拝' : `午後礼拝（次回は${fmtMD(nextAf)}）`;
    $('#af-note').textContent = bad ? '' : afHeld ? (cal.af ? '今週は実施（第2・第4日曜）' : '今週は臨時に開く（暦では休み）') : cal.af ? '今週は休止。内容は印刷されず、前奏の行に「休会」' : '今週は休（第1・3・5日曜）。内容は印刷されず、前奏の行に「休会」';
    // 次回の日付：休みの週だけ出す。手で直した日付（afternoon.next_date）があれば「変更」
    $('#af-nextdate').hidden = bad || afHeld;
    if (!bad && !afHeld) { const manual = !!week.afternoon?.next_date; $('#af-next-view').textContent = fmtMD(nextAf); $('#af-next-auto').textContent = manual ? '手で変更' : '自動'; $('#af-next-date').value = week.afternoon?.next_date || ''; if (manual) $('#af-next-editor').hidden = false; }
    $('#wed-date').textContent = bad ? '' : fmtDot(cal.wed);
    $('#nx-title').textContent = bad ? '次週奉仕予定' : `次週（${cal.next.getFullYear()}/${cal.next.getMonth() + 1}/${cal.next.getDate()}）奉仕予定`;
    const nxNote = (v, byCal) => heldBy(v, byCal) ? (byCal ? '次週は実施' : '次週は臨時に開く（暦では休み）') : (byCal ? '休止（1 行目に「休会」と印刷）' : '次週は休（1 行目に「休会」と印刷）');
    $('#nx-af-note').textContent = bad ? '' : nxNote(week.next_week?.afternoon?.suspended, cal.nextAfHeld);
    $('#nx-ss-note').textContent = bad ? '' : nxNote(week.next_week?.sunday_school?.suspended, cal.nextSs);
    applySuspended();
    $('#cv-date').textContent = bad ? '' : fmtJp(cal.d); $('#cv-no').textContent = bad ? '' : `NO.${bulletinNo(cal.d)}`;
    buildSchedule();
  }
  function refreshYouth() {
    const ss = week.sunday_school, cs = chars(ss.title), b = ss.title_break, two = Number.isInteger(b) && b >= 1 && b < cs.length;
    $('#youth-scripture').textContent = ss.scripture || '';
    $('#youth-title').textContent = !ss.title ? '' : two ? `「${cs.slice(0, b).join('').trimEnd()}\n${cs.slice(b).join('').trimStart()}」` : `「${ss.title}」`;
  }
  function buildStatic() { renderPeople($('#people-list'), boot.people); }
  // 据え置きのデータ（聖句・標語・祈り課題・牧師連絡先・住所など）: 紙面の印刷される位置に置く。ふだんは非活性。「編集」で開き、「保存」で送る、「取消」で元に戻す
  function loadRare() {
    $('#prayer-items').value = (boot.prayer.items || []).join('\n'); fitRows($('#prayer-items'));
    $$('[data-church]').forEach(i => { i.value = boot.config.church[i.dataset.church] || ''; });
    const t = boot.texts || { cover_verse: [], motto: [] };
    $('#text-cover').value = (t.cover_verse || []).join('\n'); $('#text-motto0').value = (t.motto || [])[0] || ''; $('#text-motto1').value = (t.motto || [])[1] || '';
  }
  const fitRows = (ta) => { ta.rows = Math.max(3, ta.value.split('\n').length + 1); };   // 全項目が見える高さ（鍵が掛かっていても読めるように）
  $('#prayer-items').addEventListener('input', (e) => fitRows(e.target));
  function relock() { $$('fieldset.rare').forEach(fs => { fs.disabled = true; }); }
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => { const fs = $(`#edit-${b.dataset.edit}`); fs.disabled = false; fs.querySelector('textarea, input')?.focus(); }));
  $$('[data-cancel]').forEach(b => b.addEventListener('click', () => { loadRare(); $(`#edit-${b.dataset.cancel}`).disabled = true; }));
  $$('[data-save]').forEach(b => b.addEventListener('click', async () => {
    const kind = b.dataset.save; b.disabled = true;
    try {
      if (kind === 'verse' || kind === 'motto') {   // 据え置きの文（texts.json）。両方まとめて送る
        const texts = { cover_verse: $('#text-cover').value.split('\n').map(x => x.trim()).filter(Boolean), motto: [$('#text-motto0').value.trim(), $('#text-motto1').value.trim()] };
        const r = await fetch('api/masters/texts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(texts) });
        if (!r.ok) throw new Error((await r.json()).error); boot.texts = await r.json();
      } else if (kind === 'prayer') {
        const items = $('#prayer-items').value.split('\n').map(t => t.trim()).filter(Boolean);
        const r = await fetch('api/masters/prayer-list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) });
        if (!r.ok) throw new Error((await r.json()).error); boot.prayer = await r.json();
      } else {   // church（表紙の住所・連絡先・送金先）・contact（報告の末尾の牧師連絡先）。どちらも church.json の、その場所の項目だけ送る
        const church = {}; $$('[data-church]', $(`#edit-${kind}`)).forEach(i => { church[i.dataset.church] = i.value; });
        const r = await fetch('api/masters/church', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(church) });
        if (!r.ok) throw new Error((await r.json()).error); boot.config.church = await r.json();
      }
      buildStatic(); loadRare(); $(`#edit-${kind}`).disabled = true; previewRev = -1; $('#tab-preview').classList.add('stale');   // 紙面に載るのでプレビューは作り直し
      inlineMsg($(`[data-edit="${kind}"]`), '保存しました（全部の週に効きます）', 'ok');
    } catch (e) { notify(`保存できませんでした: ${why(e)}`, { kind: 'error', key: 'master' }); }
    finally { b.disabled = false; }
  }));

  $('#btn-export').addEventListener('click', () => { location.href = 'api/export'; });

  // ---------- 同期（手元の開発サーバ／recovery でだけ使える。本番の Worker には無い） ----------
  let syncRows = null;
  const STATE_JA = { same: '一致', differs: '違う', 'remote-only': '正本にだけある', 'local-only': '手元にだけある' };
  async function syncCheck() {
    $('#sync-msg').textContent = '確認しています…'; $('#btn-sync-check').disabled = true;
    try {
      const r = await fetch('api/sync/status'); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
      $('#sync-remote').textContent = `正本: ${j.remote}`;
      syncRows = [...j.objects.map(x => ({ ...x, kind: 'objects' })), ...j.files.map(x => ({ ...x, kind: 'files' }))];
      const t = $('#sync-table'); t.innerHTML = '';
      const tr = el('tr'); for (const h of ['', '状態', '正本', '手元', '']) tr.append(el('th', null, h)); t.append(tr);
      const fmt = (x) => x ? `${x.updated_at ? fmtStamp(x.updated_at) : ''} ${x.size != null ? Math.round(x.size / 1024) + 'KB' : ''}` : '—';
      const diffs = syncRows.filter(x => x.state !== 'same');
      for (const row of diffs.length ? diffs : syncRows.slice(0, 0)) {
        const r2 = el('tr'); r2.className = row.state;
        r2.append(el('td', 'key', (row.kind === 'files' ? 'files/' : '') + row.key), el('td', null, STATE_JA[row.state]), el('td', null, fmt(row.remote)), el('td', null, fmt(row.local)));
        const ops = el('td');
        if (row.remote) { const b = el('button', 'small', '取り込む'); b.type = 'button'; b.addEventListener('click', () => syncPull([row])); ops.append(b); }
        // ファイルの目次（index/）は送れない（指す中身が正本に無いことがある。docs/file-store.md）
        if (row.local && row.kind === 'objects' && row.state !== 'same' && !row.key.startsWith('index/')) { const b = el('button', 'small', '送る'); b.type = 'button'; b.addEventListener('click', () => syncPush([row])); ops.append(b); }
        r2.append(ops); t.append(r2);
      }
      const n = { same: 0, differs: 0, 'remote-only': 0, 'local-only': 0 }; syncRows.forEach(x => n[x.state]++);
      $('#sync-msg').textContent = `一致 ${n.same}・違う ${n.differs}・正本にだけ ${n['remote-only']}・手元にだけ ${n['local-only']}（${fmtStamp(j.at)} 時点）` + (diffs.length ? '' : ' — 差分はありません');
      $('#btn-sync-pull-all').disabled = !syncRows.some(x => x.state === 'differs' || x.state === 'remote-only');
    } catch (e) { $('#sync-msg').textContent = '失敗: ' + e.message; }
    finally { $('#btn-sync-check').disabled = false; }
  }
  async function syncPull(rows) {
    const body = { objects: rows.filter(r => r.kind === 'objects').map(r => r.key), files: rows.filter(r => r.kind === 'files').map(r => r.key) };
    $('#sync-msg').textContent = `取り込んでいます（${rows.length} 件）…`;
    try { const r = await fetch('api/sync/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); await syncCheck(); $('#sync-msg').textContent = `${j.pulled.length} 件を取り込みました。` + $('#sync-msg').textContent; boot.weeks = (await (await fetch('api/bootstrap')).json()).weeks; paintWeek(); }
    catch (e) { $('#sync-msg').textContent = '失敗: ' + e.message; }
  }
  async function syncPush(rows) {
    if (!confirm(`${rows.map(r => r.key).join(', ')} を正本に送ります（正本側の前の内容は history に残ります）。よろしいですか？`)) return;
    try { const r = await fetch('api/sync/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: rows.map(r => r.key) }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); await syncCheck(); $('#sync-msg').textContent = `${j.pushed.length} 件を正本に送りました。` + $('#sync-msg').textContent; }
    catch (e) { $('#sync-msg').textContent = '失敗: ' + e.message; }
  }
  $('#btn-sync-check').addEventListener('click', syncCheck);
  $('#btn-sync-pull-all').addEventListener('click', () => syncPull((syncRows || []).filter(x => x.state === 'differs' || x.state === 'remote-only')));

  // ---------- 週の読み込み ----------
  function loadAll() {
    week.morning.extras ||= []; week.slides ||= {}; week.announcements ||= {}; week.last_week ||= {}; week.sunday_school ||= {}; week.afternoon ||= {}; week.wednesday ||= {}; week.next_week ||= {};
    bindInputs($('#form')); $$('[name]', $('#form')).forEach(inp => { if (!inp.closest('.program, #sch-rows, #lw-table')) loadInput(inp); });
    $$('[data-person]', $('#form')).forEach(s => { if (s._load) s._load(); else personWidget(s); });
    $$('[data-ref]', $('#form')).forEach(s => { if (s.closest('.program, .refs')) return; if (s._load) s._load(); else refWidget(s); });
    for (const name of Object.keys(SECTIONS)) { programEdit[name] = false; buildEditableProgram(name); }
    $('#af-next-editor').hidden = !week.afternoon?.next_date; paintUsher();
    buildParas(); buildLastWeek(); buildRefs(); refreshAuto(); refreshYouth(); refreshRoles(); relock(); applySuspended();
  }
  // ---------- 編集権（同じブラウザプロファイル内で、日付ごとに1タブ） ----------
  const lockName = (date) => `shuho-week-${date}`;
  // 取れなければ待つ。取れたら解放関数を、待ちを取り消されたら null を返す。
  // 待っている間に別の週を開いたら、前の週の待ちは取り消す（残しておくと、相手のタブが閉じた瞬間に古い週が読み込まれて上書きされる）
  let lockWait = null;
  function acquireLock(date) {
    lockWait?.abort(); const ac = new AbortController(); lockWait = ac;
    return new Promise(resolve => {
      navigator.locks.request(lockName(date), { ifAvailable: true }, lock => {
        if (lock) { showBlocked(false); return new Promise(rel => resolve(rel)); }
        showBlocked(true, date);   // 取れない：待つ間は入力画面を隠す（ヘッダの週の一覧は使える）
        return navigator.locks.request(lockName(date), { signal: ac.signal }, () => new Promise(rel => { showBlocked(false); resolve(rel); }))
          .catch(() => resolve(null));   // 取り消された
      });
    });
  }
  function showBlocked(on, date) {
    $('#blocked').hidden = !on; $('#form').style.visibility = on ? 'hidden' : '';
    if (on && date) $('#blocked-title').textContent = `${fmtWeek(parseDate(date))}の週は、別のタブで編集中です`;
  }
  function dropLock() { if (releaseLock) { releaseLock(); releaseLock = null; } }

  let openSeq = 0;   // 後から開いた週が勝つ（待っている間に別の週を選んだら、前の openWeek は何もせずに終わる）
  async function openWeek(date, isNew, opts = {}) {   // opts: { from, mode, confirmed }（新しい週を作る窓から）
    if (dirty && !opts.confirmed && !confirm('保存していない変更があります。破棄して切り替えますか？')) return;
    const my = ++openSeq;
    dropLock();
    if (navigator.locks) { const rel = await acquireLock(date); if (my !== openSeq) { rel?.(); return; } if (!rel) return; releaseLock = rel; } else console.warn('Web Locks が無い：編集権の管理ができません（版の検査のみ）');
    let r;
    const q = isNew && opts.from ? `?from=${opts.from}&mode=${opts.mode || 'fresh'}` : '';
    try { r = await fetch(isNew ? `api/week/${date}/new${q}` : `api/week/${date}`); } catch (e) { dropLock(); return notify(`${date} を開けませんでした: ${why(e)}`, { kind: 'error', key: 'week' }); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); dropLock(); return notify(`${date} を開けませんでした: ${j.error || r.status}`, { kind: 'error', key: 'week' }); }
    ['week', 'save', 'date', 'import', 'preview'].forEach(dropNotice);   // 前の週についての知らせは片付ける
    const j = await r.json(); week = j.week; version = j.version; savedAt = j.saved_at || null; dirty = isNew; editRev = 0; previewRev = -1; clearPrep();
    $('#tab-preview').classList.remove('stale');
    loadAll(); paintWeek(); paintSaveState();   // 開いた・作ったことはヘッダの週と状態で分かる
    clearPdf(); $('#preview-title').textContent = 'プレビュー'; $('#overflow-msg').textContent = '';
  }
  // 日付の変更：作成時に決めた日付を、重複を確認したうえで付け替える
  $('#btn-date-change').addEventListener('click', async () => {
    closeMenus(); if (!week) return;
    const to = prompt('新しい日付（日曜）を YYYY-MM-DD で入力してください', week.date);
    if (!to || to === week.date) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || parseDate(to).getDay() !== 0) return notify(`日付を変更していません。日曜日を YYYY-MM-DD で入れてください（入力: ${to}）`, { kind: 'error', key: 'date' });
    const ex = await (await fetch(`api/week/${to}/exists`)).json();
    if (ex.exists) return notify(`日付を変更していません。${to} はすでに保存されています`, { kind: 'error', key: 'date' });
    // 移動先の編集権を取れるか（同じプロファイルの別タブが編集中なら不可）
    const got = navigator.locks ? await navigator.locks.request(lockName(to), { ifAvailable: true }, l => !!l) : true;
    if (!got) return notify(`日付を変更していません。${to} は別のタブで編集中です`, { kind: 'error', key: 'date' });
    if (version) {   // 保存済み：サーバー側で改名
      const r = await fetch(`api/week/${week.date}/rename`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to }) });
      const j = await r.json(); if (!r.ok) return notify(`日付を変更していません: ${j.error}`, { kind: 'error', key: 'date' });
      boot.weeks = boot.weeks.filter(d => d !== week.date).concat(to).sort();
      version = j.version;
    }
    const from = week.date; week.date = to; dropLock(); releaseLock = await acquireLock(to);
    markDirty(); refreshAuto(); paintWeek(); notify(version ? `日付を ${from} → ${to} に変更しました（保存済みの週を移しました。${from} はもうありません）` : `日付を ${from} → ${to} に変更しました（まだ保存していません）`, { kind: 'ok', key: 'date' });
  });
  // 手元の JSON（保存時にダウンロードしたもの）を読み込んで初期値にする。日付がサーバーにあれば「上書き」扱い（版を持って保存に行く）
  $('#btn-import').addEventListener('click', () => { closeMenus(); $('#file-import').click(); });
  $('#file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let obj; try { obj = JSON.parse(await f.text()); } catch { return notify(`${f.name} は JSON として読めません`, { kind: 'error', key: 'import' }); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(obj.date || '') || !obj.morning) return notify(`${f.name} は週報の JSON ではありません（date と morning が要ります）`, { kind: 'error', key: 'import' });
    if (dirty && !confirm('保存していない変更があります。破棄して読み込みますか？')) return;
    const my = ++openSeq; dropLock();
    if (navigator.locks) { const rel = await acquireLock(obj.date); if (my !== openSeq) { rel?.(); return; } if (!rel) return; releaseLock = rel; }
    const r = await fetch(`api/week/${obj.date}`); const cur = r.ok ? await r.json() : null; version = cur ? cur.version : null; savedAt = cur ? cur.saved_at || null : null;
    week = obj; dirty = true; editRev = 0; previewRev = -1; clearPrep(); $('#tab-preview').classList.remove('stale');
    loadAll(); paintWeek(); paintSaveState();
    clearPdf(); $('#preview-title').textContent = 'プレビュー'; $('#overflow-msg').textContent = '';
    notify(`${f.name} を読み込みました（まだ保存していません）` + (version ? `。保存すると、サーバーにある ${obj.date} の内容を上書きします` : ''), { kind: version ? 'warn' : 'ok', key: 'import' });
  });
  // ---------- ヘッダ：いま開いている週と、週の一覧（ポップアップ） ----------
  const fmtWeek = (d) => `${fmtJp(d)}（日）`;
  function paintWeek() {   // ヘッダの週の表示と、一覧の「いま開いている週」の印
    paintSlidesNeed();
    const ok = week && week.date && !isNaN(parseDate(week.date));
    if (ok) { const d = parseDate(week.date); $('#wk-date').replaceChildren(el('span', 'y', `${d.getFullYear()}年`), `${d.getMonth() + 1}月${d.getDate()}日（日）`); }   // 年は狭い幅では省く（CSS）
    else $('#wk-date').textContent = '週を選んでください';
    $('#wk-no').textContent = ok ? `第${bulletinNo(parseDate(week.date))}号` : '';
    const box = $('#week-list'); box.innerHTML = '';
    if (!boot.weeks.length) box.append(el('div', 'empty', 'まだありません'));
    for (const d of [...boot.weeks].reverse()) {
      const b = el('button', d === week?.date ? 'current' : null, fmtWeek(parseDate(d))); b.type = 'button';
      b.append(el('span', 'no', `第${bulletinNo(parseDate(d))}号`));
      b.addEventListener('click', () => { closeMenus(); if (d !== week?.date) openWeek(d, false); });
      box.append(b);
    }
  }
  function closeMenus() { $$('.menu').forEach(m => { m.hidden = true; }); $$('[aria-haspopup]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
  function toggleMenu(btn, menu) { const open = menu.hidden; closeMenus(); if (open) { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); } }
  $('#btn-week').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu($('#btn-week'), $('#week-menu')); });
  $('#btn-more').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu($('#btn-more'), $('#more-menu')); });
  $$('.menu').forEach(m => m.addEventListener('click', e => e.stopPropagation()));
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
  // ---------- 保存済みの週の PDF・控え（JSON）を保存（§4.8。保存ではダウンロードしないので、要るときにここから取る） ----------
  // サーバーから受け取ってから、最後にダウンロードする（ダウンロードの後に通信しない）
  async function fetchFile(date, kind) {
    const r = await fetch(kind === 'pdf' ? `api/pdf/${date}` : `api/week/${date}/json`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.blob();
  }
  async function exportSaved(kind) {
    closeMenus();
    const what = kind === 'pdf' ? 'PDF' : '控え（JSON）';
    if (!week || !version) return notify(`${what}を保存していません。この週はまだサーバーに保存されていません。先に「保存」を押してください`, { kind: 'warn', key: 'export' });
    const d = week.date;
    notify(`${fmtDay(d)} の${what}を用意しています…` + (dirty ? '（保存済みの内容です。画面の未保存の変更は入りません）' : ''), { kind: 'ok', key: 'export' });
    try { const blob = await fetchFile(d, kind); dropNotice('export'); download(blob, `${d}.${kind}`); }
    catch (e) { report('export', e); notify(`${what}を用意できませんでした: ${why(e)}`, { kind: 'error', key: 'export' }); }
  }
  $('#btn-export-pdf').addEventListener('click', () => exportSaved('pdf'));
  $('#btn-export-json').addEventListener('click', () => exportSaved('json'));

  // ---------- 新しい週を作る（窓。ARCHITECTURE.md §19） ----------
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const nextSunday = () => { const t = new Date(); return ymd(addDays(t, (7 - t.getDay()) % 7 || 7)); };   // 今日が日曜なら 7 日後
  const newMsg = (m) => { $('#new-msg').textContent = m; $('#new-msg').hidden = !m; };
  $('#btn-new-open').addEventListener('click', () => {
    closeMenus();
    const sel = $('#new-from'); sel.innerHTML = '';
    for (const d of [...boot.weeks].reverse()) sel.append(new Option(`${fmtWeek(parseDate(d))}　第${bulletinNo(parseDate(d))}号`, d));
    sel.value = week && version && boot.weeks.includes(week.date) ? week.date : (boot.weeks.at(-1) || '');   // 今開いている週（保存したことのある週）。無ければ一番新しい週
    $('#new-date').value = nextSunday();
    $('[name="new-mode"][value="fresh"]').checked = true; $('[name="new-mode"][value="copy"]').disabled = !boot.weeks.length;
    newMsg(''); paintNewPrune(); $('#new-dialog').showModal();
  });
  // 作る週を保存すると、残す範囲（新しい方から retain_weeks 週。§4.6）を超えて消える週を、作る前に知らせる。消える週の控えはここで保存できる
  function paintNewPrune() {
    const box = $('#new-prune'); box.replaceChildren(); box.hidden = true;
    const y = $('#new-date').value, n = boot.retain_weeks;
    if (!n || !/^\d{4}-\d{2}-\d{2}$/.test(y) || boot.weeks.includes(y)) return;
    const dates = [...boot.weeks, y].sort(), gone = dates.slice(0, Math.max(0, dates.length - n)), old = gone.filter(d => d !== y);
    if (gone.includes(y)) box.append(el('p', null, `この日付は、残す範囲（新しい方から ${n} 週）より古いので、保存してもサーバーからすぐに消えます。`));
    if (old.length) {
      box.append(el('p', null, `この週を保存すると、残す範囲（新しい方から ${n} 週）を超えるので、${old.map(fmtDay).join('・')} の週がサーバーから消えます。残すなら、先に控え（JSON）を保存してください。`));
      for (const d of old) {
        const b = el('button', 'small', `${fmtDay(d)} の控え（JSON）を保存`); b.type = 'button';
        b.addEventListener('click', async () => {
          inlineMsg(b, '用意しています…', 'busy');
          try { const blob = await fetchFile(d, 'json'); inlineMsg(b, ''); download(blob, `${d}.json`); }
          catch (e) { report('export', e); inlineMsg(b, `用意できませんでした: ${why(e)}`); }
        });
        box.append(b);
      }
    }
    box.hidden = !box.childElementCount;
  }
  $('#new-date').addEventListener('input', paintNewPrune);
  $('#new-cancel').addEventListener('click', () => $('#new-dialog').close());
  $('#new-ok').addEventListener('click', () => {
    const y = $('#new-date').value, from = $('#new-from').value, mode = $('[name="new-mode"]:checked').value;
    if (!y) return newMsg('作る日付を選んでください');
    if (parseDate(y).getDay() !== 0) return newMsg('日曜日を選んでください');
    if (boot.weeks.includes(y)) return newMsg('その週はもうあります');
    if (dirty && !confirm('保存していない変更は写されず、破棄されます。新しい週を作りますか？')) return;
    $('#new-dialog').close();
    openWeek(y, true, { from: from || null, mode, confirmed: true });
  });

  // ---------- 進み具合（PDF の生成・保存） ----------
  // 実際の進み具合はサーバーから取れない。ふだんの所要時間（estimate）を目安にバーを進め、目安に達したら 90% 付近で待つ。
  // 終わりは返事が来たことで決める（end）。短く終わるもの（写しを使ったとき）でちらつかないよう、delay までは出さない
  const est = { pdf: 12000, wake: 50000 };   // 目安（ミリ秒）。bootstrap の実測値で上書きし、生成のたびに更新する
  function startProgress(box, { label, doneLabel, estimate, note = '', delay = 400, format = null }) {
    const t0 = Date.now(); let visible = false;
    const bar = $('.pg-bar i', box), text = $('.pg-text', box), sub = $('.pg-note', box);
    box.classList.remove('done');
    const tick = () => {
      const t = Date.now() - t0, r = t / estimate;
      if (!visible && t >= delay) { visible = true; box.hidden = false; }
      const p = r < 1 ? 0.9 * r : 0.9 + 0.08 * (1 - Math.exp(-(r - 1)));   // 目安までに 90%、その後はゆっくり 98% に近づく
      bar.style.width = (p * 100).toFixed(1) + '%';
      text.textContent = format ? format(t) : `${label}… ${Math.floor(t / 1000)} 秒（ふだん約 ${Math.max(1, Math.round(estimate / 1000))} 秒）`;
      sub.textContent = r > 1.5 ? `いつもより時間がかかっています。そのままお待ちください${note ? '。' + note : ''}` : note;
    };
    tick(); const timer = setInterval(tick, 250);
    return {
      end(ok) {
        clearInterval(timer);
        if (!visible || !ok) { box.hidden = true; return; }
        bar.style.width = '100%'; box.classList.add('done'); text.textContent = doneLabel; sub.textContent = '';
        setTimeout(() => { box.hidden = true; }, 700);
      },
    };
  }
  const learnPdfTime = (ms, r) => { if (r.headers.get('x-pdf-cache') !== 'hit') est.pdf = Math.round((est.pdf * 3 + ms) / 4); };   // 写しを使った回は目安に入れない

  // ---------- PDF エンジンの準備（Render は 15 分使わないと眠る） ----------
  // api/engine を 1 回送って返事を待つ（Worker が Render の /health を呼ぶ。/health は Chromium の起動まで済ませてから返す）。
  // 返事が来た＝準備完了。時間で「眠っている」と判定はしない。1 秒たっても返事が無ければ「準備中」にしてバーを出す。
  // 準備中・失敗の間に押されたプレビュー・保存は、待たせずに棄却して理由を知らせる（準備の完了に操作を依存させない）。
  const engine = { sleeps: false, state: 'unknown', lastOk: 0, inflight: null, pg: null, rejected: null, netFails: 0, failNet: false };   // netFails: 続けて通信そのものが失敗した回数   // failNet: 失敗の理由が通信（エンジンではない）   // rejected: 最後に棄却した操作（準備ができた・できなかったときに知らせ直す）   // state: unknown | preparing | ready | failed
  const FRESH = 14 * 60 * 1000, KEEP_AWAKE = 10 * 60 * 1000;
  function paintEngineTab() {
    const tab = $('#tab-preview'); const waiting = engine.state === 'preparing' || engine.state === 'failed';
    tab.classList.toggle('waiting', waiting); tab.classList.toggle('failed', engine.state === 'failed');
    if (engine.state === 'failed') { $('#eng-progress').hidden = false; $('#eng-progress .pg-text').textContent = `${engine.failNet ? '通信できません' : 'PDF の準備ができませんでした'}（押すとやり直し）`; }
  }
  function checkEngine() {
    if (!engine.sleeps) { engine.state = 'ready'; return Promise.resolve(); }
    if (engine.inflight) return engine.inflight;
    if (engine.state === 'failed') { engine.state = 'preparing'; paintEngineTab(); }   // やり直し：失敗の表示をすぐ消す
    const toPreparing = setTimeout(() => { engine.state = 'preparing'; paintEngineTab(); }, 1000);
    engine.pg = startProgress($('#eng-progress'), { label: 'PDF の準備', doneLabel: '準備できました', estimate: est.wake, delay: 1000,
      format: (t) => `準備中 ${Math.floor(t / 1000)} 秒` });
    engine.inflight = (async () => {
      let e = null, net = false, lost = false;
      try { const r = await fetch('api/engine'); e = await r.json(); } catch (err) { if (err instanceof LoginExpired) lost = true; else net = true; e = { ready: false, error: String(err.message || err) }; }
      clearTimeout(toPreparing);
      if (lost) {   // 受付で止められた（ログインの期限切れ。§6.1）。エンジンの状態は分からないまま。ログインし直したら確かめ直す
        engine.pg.end(false); engine.inflight = null; engine.netFails = 0;
        if (engine.state !== 'ready') engine.state = 'unknown';
        paintEngineTab();
        return;
      }
      if (net && ++engine.netFails <= 3) {
        // 通信そのものが失敗した（電波が切れた、iOS のダウンロードの確認中だった、など。§4.8）。エンジンの故障とは限らないので、
        // 状態は変えずに少し後で確かめ直す（準備完了のままならプレビュー・保存はそのまま使える）。続けて 4 回届かなければ失敗とする
        engine.pg.end(false); engine.inflight = null;
        if (engine.state !== 'ready') { engine.state = 'preparing'; paintEngineTab(); }
        setTimeout(checkEngine, 3000 * engine.netFails);
        return;
      }
      engine.netFails = 0;
      if (e.ready) {
        engine.state = 'ready'; engine.lastOk = Date.now(); engine.pg.end(true);
        if (e.estimates?.wake_ms) est.wake = e.estimates.wake_ms;
        if (engine.rejected) notify(`PDF の準備ができました。もう一度「${engine.rejected}」を押してください`, { kind: engine.rejected === '保存' ? 'warn' : 'ok', key: 'engine' });   // 保存は未保存のまま。閉じるまで残す
        engine.rejected = null;
      } else {
        engine.state = 'failed'; engine.failNet = net; engine.pg.end(false);
        // 棄却した操作の知らせ（「準備中です」）を、失敗の知らせに置き換える。置き換えないと「準備中」と「できませんでした」が並ぶ（2026-10-24 の事象）
        const what = engine.rejected;
        if (what) notify(`${what}していません。${net ? '通信できません（インターネットの接続を確かめてください）' : 'PDF の準備ができませんでした（PDF エンジンが応答しません）'}。入力は画面に残っています。この画面を閉じずに、${net ? 'つながってから' : '少し待ってから'}、もう一度「${what}」を押してください`, { kind: 'error', key: 'engine' });
      }
      paintEngineTab(); showEngineNote(e);
      engine.inflight = null;
    })();
    return engine.inflight;
  }
  // プレビュー・保存の前に呼ぶ。準備完了なら true。そうでなければ（必要なら準備を始めて）理由を知らせて false
  function engineReady(what) {
    if (loginLost) { if (engine.rejected !== '保存') engine.rejected = what; showLoginNotice(); recheckLogin(); return false; }   // 別のタブでログインし直していれば、確かめ直しで知らせが変わる
    if (!engine.sleeps) return true;
    if (engine.state === 'ready' && Date.now() - engine.lastOk < FRESH) { dropNotice('engine'); return true; }
    if (engine.rejected !== '保存') engine.rejected = what;   // 保存を棄却したことは、プレビューの棄却で上書きしない
    if (engine.state === 'ready') engine.state = 'unknown';   // しばらく返事を受け取っていない（画面が裏に回っていた等）→ 確かめ直す
    if (!engine.inflight) checkEngine();
    if (engine.state === 'failed') { notify(`${what}できません。PDF の準備ができませんでした。もう一度準備しています。しばらくしてから、もう一度「${what}」を押してください`, { kind: 'error', key: 'engine' }); return false; }
    // 知らせの文は出したまま変わらないので、残りの秒数は書かない（進み具合は「プレビュー」の横のバー）
    notify(`${what}していません。PDF の準備中です（ふだん約 ${Math.max(1, Math.round(est.wake / 1000))} 秒）。準備ができたら、ここでお知らせします。そのあと、もう一度「${what}」を押してください`, { kind: 'warn', key: 'engine' });
    return false;
  }
  setInterval(() => { if (engine.sleeps && document.visibilityState === 'visible') checkEngine(); }, KEEP_AWAKE);   // 開いている間は起こしておく

  // ---------- 受付（Cloudflare Access）のログインの期限切れ（ARCHITECTURE.md §6.1） ----------
  // 切れたら知らせて、新しいタブでログインし直してもらう（この画面は読み込み直さないので、保存していない入力は残る）。
  // 新しいタブの relogin.html が知らせてくる・この画面が前に出たら確かめ直し、通れば知らせを消して、棄却した操作をもう一度押してもらう
  let loginLost = false;
  function showLoginNotice() {
    notify(`ログインの期限が切れました。${dirty ? '保存していない入力は、この画面に残っています。' : ''}この画面は閉じたり読み込み直したりせずに、「ログインし直す」を押してください。開いたタブでログインしたら、この画面に戻って続けてください`,
      { kind: 'error', key: 'login', actions: [{ label: 'ログインし直す', onClick: () => window.open('relogin.html', '_blank') }] });
  }
  const recheckLogin = () => fetch('api/auth/config', { cache: 'no-store' }).catch(() => {});   // 通れば guardLogin が「通れるようになった」と知らせる
  guardLogin((lost) => {
    loginLost = lost;
    if (lost) { dropNotice('engine'); showLoginNotice(); return; }   // 「PDF の準備中」の知らせは、ログイン切れの知らせと食い違うので消す
    dropNotice('login');
    if (engine.sleeps) checkEngine();   // 準備の状態を確かめ直す。棄却した操作があれば、そこで「もう一度押してください」を出す
    else if (engine.rejected) { notify(`ログインできました。もう一度「${engine.rejected}」を押してください`, { kind: 'warn', key: 'engine' }); engine.rejected = null; }
  });
  try { new BroadcastChannel('shuho-login').onmessage = () => { if (loginLost) recheckLogin(); }; } catch { /* 無ければ、この画面が前に出たときに確かめ直す */ }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (loginLost) recheckLogin();   // 別のタブでログインし直して戻ってきた
    else if (engine.sleeps && Date.now() - engine.lastOk > KEEP_AWAKE) checkEngine();   // 裏から戻った（iPad はタイマーが止まる）
  });

  // ---------- プレビュー・保存 ----------
  const fontSel = $('#font-select');
  fontSel.addEventListener('change', () => { previewRev = -1; $('#tab-preview').classList.add('stale'); });   // 入力の変更と同じ扱いにする
  // プレビュー＝サーバーで作った PDF（Cloudflare / Render の Chromium）。同じ入力なら KV の写しが返る（x-pdf-cache: hit）。
  // 表示は PDF.js で各ページを canvas に描く（iPad の Safari は iframe の PDF を 1 ページしか描かず、Android は inline 表示できないため）。
  let previewing = false;   // 作っている間に重ねて頼まない（タブの開き直し・作り直す・Ctrl+Enter）
  async function preview() {
    if (!week || previewing) return;
    if (!engineReady('プレビュー')) return;
    previewing = true; $('#btn-preview-refresh').disabled = true;
    const pg = startProgress($('#pv-progress'), { label: 'PDF を作っています', doneLabel: 'PDF ができました', estimate: est.pdf }); let ok = false;
    try {
      const t0 = Date.now();
      const r = await fetch('api/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ week, font: fontSel.value }) });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      learnPdfTime(Date.now() - t0, r); ok = true; pg.end(true);
      const pdf = await r.blob(); dropNotice('preview');
      previewRev = editRev; $('#tab-preview').classList.remove('stale');   // 表示欄はこの PDF を持った（描けなければ表示欄に理由と「もう一度表示」が出る）
      await showPdf(pdf, `プレビュー ${week.date}（${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}）— 今の入力内容。${dirty ? '保存はされていません' : '保存済みと同じ'}`, r);
    } catch (e) {
      if (e instanceof LoginExpired) { if (engine.rejected !== '保存') engine.rejected = 'プレビュー'; showLoginNotice(); }   // 受付で止められた。ログインし直したら、もう一度押してもらう
      else { report('preview', e); notify(`プレビューを作れませんでした: ${why(e)}`, { kind: 'error', key: 'preview' }); }
    }
    finally { if (!ok) pg.end(false); previewing = false; $('#btn-preview-refresh').disabled = false; }
  }
  // 保存（ARCHITECTURE.md §4.4）。保存の成否はサーバーの返事だけで決める。返事が来た後の処理（PDF の受け取り・表示）は後処理で、
  // 失敗しても「保存しました」は変えない。保存ではダウンロードしない（PDF と控え（JSON）は、知らせのボタンを押した分だけ渡す）
  async function save() {
    if (!week) return;
    if (!engineReady('保存')) return;
    const form = $('#form');
    if (!form.checkValidity()) {
      const bad = form.querySelector(':invalid'); const panel = bad && bad.closest('.panel');
      if (panel) $(`.tab[data-tab="${panel.id}"]`).click();
      form.reportValidity(); return notify('保存していません。必須の欄が空です（赤い枠の欄）。入れてから、もう一度「保存」を押してください', { kind: 'error', key: 'save' });
    }
    $('#btn-save').disabled = true; saving = true; paintSaveState();
    // 送った瞬間の内容を保存する。保存中に入力した分は未保存のまま残す（sentRev と比べる）
    const sent = { rev: editRev, json: JSON.stringify(week, null, 2) + '\n', date: week.date, font: fontSel.value };
    let pg = null, r = null;
    try {
      const post = (force) => {
        pg = startProgress($('#save-progress'), { label: '保存しています', doneLabel: '保存しました', estimate: est.pdf, note: 'この画面を閉じないでください', delay: 0 });
        return fetch('api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ week: JSON.parse(sent.json), font: sent.font, base_version: version, force }) });
      };
      let t0 = Date.now(); r = await post(false);
      if (r.status === 409) {
        pg.end(false);
        const j = await r.json();
        const ow = confirm(`${j.error}。\n\n「OK」＝この画面の内容で上書きする\n「キャンセル」＝保存をやめる（読み直すには週の一覧から開き直してください）`);
        if (!ow) { r = null; notify(`保存していません。${j.error}。サーバーの内容を見るには、週の一覧から開き直してください（この画面の入力は消えます）`, { kind: 'warn', key: 'save' }); return; }
        t0 = Date.now(); r = await post(true);
      }
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      learnPdfTime(Date.now() - t0, r); pg.end(true);
    } catch (e) {
      r = null; pg?.end(false);
      if (e instanceof LoginExpired) { engine.rejected = '保存'; showLoginNotice(); return; }   // 受付で止められた（サーバーには届いていない）。ログインし直したら、もう一度押してもらう
      report('save', e);
      notify(`保存できませんでした。入力は画面に残っています。この画面を閉じずに、もう一度「保存」を押してください（理由: ${why(e)}）`, { kind: 'error', key: 'save' });
      return;
    } finally { if (!r) { saving = false; paintSaveState(); $('#btn-save').disabled = false; } }
    // ここで保存は済んでいる（サーバーが書いた）。以下は後処理
    try { await afterSave(r, sent); }
    catch (e) { report('save:after', e); }
    finally { saving = false; paintSaveState(); $('#btn-save').disabled = false; }
  }
  async function afterSave(r, sent) {
    const overflow = overflowText(r.headers.get('x-overflow'));
    const pruned = (r.headers.get('x-pruned') || '').split(',').filter(Boolean);   // 保持の上限で消えた週（§4.6）
    const gone = pruned.includes(sent.date);   // いま保存した週自身が消えた（保持する週より古い日付）
    dirty = gone || editRev !== sent.rev;
    version = gone ? null : r.headers.get('x-version'); savedAt = gone ? null : (r.headers.get('x-saved-at') || new Date().toISOString());
    if (!gone && !boot.weeks.includes(sent.date)) { boot.weeks.push(sent.date); boot.weeks.sort(); }
    boot.weeks = boot.weeks.filter(d => !pruned.includes(d));
    paintWeek();
    let pdf = null; try { pdf = await r.blob(); } catch (e) { report('save:pdf', e); }   // 本文（PDF）を受け取り損ねても、保存は済んでいる
    const files = [
      ...(pdf ? [{ label: 'PDF を保存', onClick: () => download(pdf, `${sent.date}.pdf`) }] : []),
      { label: '控え（JSON）を保存', onClick: () => download(new Blob([sent.json], { type: 'application/json' }), `${sent.date}.json`) },
    ];
    if (gone) {
      notify(`保存しましたが、この週（${fmtDay(sent.date)}）は残す範囲（新しい方から ${boot.retain_weeks} 週）より古いので、サーバーからすぐに消えました。残すには、いま PDF と控え（JSON）を保存してください。` + (overflow ? `紙面に収まらない欄があります（赤枠）：${overflow}。` : ''), { kind: 'error', key: 'save', actions: files });
    } else {
      notify(`保存しました（${fmtDay(sent.date)}）。PDF と控え（JSON）が要るときは、右のボタンで保存してください。` + (overflow ? `紙面に収まらない欄があります（赤枠）：${overflow}。` : '') + (dirty ? '保存している間に入力した分は、まだ保存していません。' : '') + (pruned.length ? `残す範囲（新しい方から ${boot.retain_weeks} 週）を超えたので、${pruned.map(fmtDay).join('・')} の週はサーバーから消えました。` : ''),
        { kind: overflow || dirty || pruned.length ? 'warn' : 'ok', key: 'save', actions: files });
    }
    if (!pdf) return;
    if (!dirty) { previewRev = editRev; $('#tab-preview').classList.remove('stale'); }   // 表示欄はこの PDF を持つ（描けなければ表示欄に理由が出る）
    showPdf(pdf, `保存済み ${sent.date}`, r);   // 待たない: 表示は保存の結果に関わらない
  }
  // ---------- PDF の表示（ui/pdfview.mjs）。この画面ではエンジンの版と今日の生成回数も出す ----------
  async function showPdf(blob, title, response) {
    const [engine, version] = (response.headers.get('x-pdf-engine') || '').split('/'); const hit = response.headers.get('x-pdf-cache') === 'hit';
    $('#pdf-engine').textContent = engine ? `PDF: ${{ cloudflare: 'Cloudflare', render: 'Render', local: 'ローカル' }[engine] || engine} Chromium ${version}${hit ? '（写し）' : '（生成）'}` : '';
    const ok = await viewer.show(blob, { title, name: `${week.date}.pdf`, response });
    refreshStats();
    return ok;
  }
  function clearPdf() { viewer.clear(); $('#pdf-engine').textContent = ''; }
  async function refreshStats() {   // 今日の生成回数（無料枠の消費の実測）
    try { const st = await (await fetch('api/pdf-stats')).json(); $('#pdf-stats').textContent = `今日の PDF 生成 ${st.generated} 回（約 ${st.seconds} 秒）・写し ${st.hits} 回`; } catch { /* 表示だけ */ }
  }
  // PDF エンジンの状態：Render なら起こす。本番（Cloudflare）と Chromium の版が違えば赤で知らせる
  const ENGINE_NAME = { cloudflare: 'Cloudflare', render: 'Render', local: 'ローカル' };
  function showEngineNote(e) {
    const note = $('#engine-note');
    try {
      if (!e.current) { note.textContent = e.error ? `PDF エンジン: ${e.error}` : ''; note.classList.toggle('warn', !!e.error); return; }
      let t = `PDF: ${ENGINE_NAME[e.current.engine] || e.current.engine} Chromium ${e.current.version}`;
      if (e.production) t += e.mismatch ? `　⚠ 本番 Cloudflare は ${e.production.version}。版が違うので折り返しがずれ得ます（render/Dockerfile の ARG CHROME を合わせて push）` : `（本番 Cloudflare ${e.production.version} と一致）`;
      note.textContent = t; note.classList.toggle('warn', !!e.mismatch);
    } catch { /* 表示だけ */ }
  }
  // ---------- サイトに反映（保存済みの週 → public/current.json → サイト再ビルド） ----------
  // 公開用 JSON は 5 分キャッシュ付き（サイトのビルドが読む用）。画面では毎回取り直す
  function showPublished(c) { $('#publish-note').textContent = c ? `サイトに出ている週: ${c.date}（${fmtStamp(c.published_at)} に反映）` : 'サイトに出ている週: —'; }
  async function refreshPublished() {
    try { showPublished(await (await fetch(`api/public/current?_=${Date.now()}`, { cache: 'no-store' })).json()); } catch { /* 表示だけ */ }
  }
  // 反映後、サイトのビルドが終わるまで見届ける（成功／失敗を画面に出す）
  async function watchSiteBuild(since) {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10000));
      let j; try { j = await (await fetch('api/site-builds')).json(); } catch { continue; }
      const b = (j.builds || []).find(x => Date.parse(x.created) >= since - 5000);
      if (!b) continue;
      if (b.status !== 'stopped') { notify(`サイトを作り直しています…（${b.status === 'running' ? '実行中' : '順番待ち'}。1〜2 分）`, { kind: 'ok', key: 'publish' }); continue; }
      if (b.outcome === 'success') return notify('サイトに反映しました（公開済み）', { kind: 'ok', key: 'publish' });
      return notify(`サイトの作り直しに失敗しました（${b.outcome}）。管理者に連絡してください（Cloudflare の samplechurch → デプロイ にログがあります）`, { kind: 'error', key: 'publish' });
    }
    notify('サイトの作り直しの結果が確認できませんでした（時間切れ）。しばらくしてからサイトを見て、反映されていなければ管理者に連絡してください', { kind: 'warn', key: 'publish' });
  }
  $('#btn-publish').addEventListener('click', async () => {
    if (!week) return;
    if (dirty || !version) return notify('サイトに反映していません。先に保存してください（サイトには保存済みの内容を出します）', { kind: 'warn', key: 'publish' });
    if (!confirm(`${week.date} の内容（日付・司会・説教・聖書箇所・説教題）をサイトのトップページに反映します。よろしいですか？`)) return;
    $('#btn-publish').disabled = true; notify('サイトに反映しています…', { kind: 'ok', key: 'publish' });
    try {
      const r = await fetch('api/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: week.date, version }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
      showPublished(j.current);   // 反映した内容をそのまま出す（読み直しを待たない）
      if (!j.deploy) notify('内容は置きました（サイトの作り直しの設定がまだ無いので、次にサイトを作り直したときに反映されます）', { kind: 'warn', key: 'publish' });
      else if (!j.deploy.ok) { notify('内容は置きましたが、サイトの作り直しを始められませんでした。管理者に連絡してください', { kind: 'error', key: 'publish' }); console.warn('deploy', j.deploy); }
      else { notify('サイトを作り直しています…（1〜2 分）', { kind: 'ok', key: 'publish' }); watchSiteBuild(Date.parse(j.current.published_at)); }
    } catch (e) { notify(`サイトに反映できませんでした: ${why(e)}`, { kind: 'error', key: 'publish' }); }
    finally { $('#btn-publish').disabled = false; }
  });
  window.addEventListener('pagehide', dropLock);
  $('#btn-preview-refresh').addEventListener('click', preview);
  $('#btn-save').addEventListener('click', save);
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && place.get() === 'week') { e.preventDefault(); preview(); } });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  $$('.tab').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.tab === 't5' && !engineReady('プレビュー')) return;   // 準備中は切り替えない（棄却して知らせる）
    $$('.tab').forEach(x => x.classList.toggle('active', x === b)); $$('#form .panel').forEach(p => p.classList.toggle('active', p.id === b.dataset.tab));
    if (b.dataset.tab === 't6') paintSlidesNeed();   // 番号は他のタブで変わるので、開いたときに数え直す
    if (b.dataset.tab === 't5' && week && previewRev !== editRev) preview();   // 開いたとき、変更があれば作り直す
  }));

  // ---------- 礼拝スライド（pptx）: ブラウザ内で組み立ててダウンロード（ui/slide-maker.mjs） ----------
  function paintSlidesNeed() { paintSlidesNeedFor(week, boot); }
  const takeMasters = (b) => { for (const k of ['people', 'hymns', 'readings', 'files']) boot[k] = b[k]; buildStatic(); masterFiles.paint(); };   // 読み直したマスタ・名簿で画面も合わせる（週の一覧などは触らない）
  $$('[data-slides]').forEach(b => b.addEventListener('click', () => makeSlides({ week, kind: b.dataset.slides, onBoot: takeMasters })));
  $$('[data-slides-prep]').forEach(i => i.addEventListener('input', paintSlidesNeed));   // 準備賛美の曲名と「pptx 未登録」

  // ---------- ログイン（Sign in with Google → api/auth/google → Cookie） ----------
  async function ensureLogin() {
    const cfg = await (await fetch('api/auth/config')).json();
    if (!cfg.enabled) return true;
    const me = await fetch('api/auth/me');
    if (me.ok) { const j = await me.json(); $('#who-email').textContent = j.email; $('#who').hidden = false; return true; }
    // 未ログイン：Google のボタンを出して待つ
    $('#login').hidden = false; $('#form').style.visibility = 'hidden';
    await new Promise((resolve, reject) => {
      const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
      sc.onerror = () => reject(new Error('Google のログイン部品を読み込めません'));
      sc.onload = () => {
        google.accounts.id.initialize({ client_id: cfg.google_client_id, callback: async ({ credential }) => {
          $('#login-msg').textContent = '確認しています…';
          const r = await fetch('api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { $('#login-msg').textContent = j.error || 'ログインできませんでした'; return; }
          $('#who-email').textContent = j.email; $('#who').hidden = false; $('#login').hidden = true; $('#form').style.visibility = ''; resolve();
        } });
        google.accounts.id.renderButton($('#google-btn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ja' });
      };
      document.head.append(sc);
    });
    return true;
  }
  $('#btn-logout').addEventListener('click', async () => { await fetch('api/auth/logout', { method: 'POST' }); location.reload(); });

  // ---------- 起動 ----------
  reportUncaught();
  (async function init() {
    try { await ensureLogin(); } catch (e) { $('#login').hidden = false; $('#login-msg').textContent = e.message; return; }
    boot = await (await fetch('api/bootstrap')).json();
    loadGlyphWidths('ui/glyph-widths.json').then(() => $$('[data-lines]').forEach(i => i._lines?.measure())).catch(e => report('glyph-widths', e));   // 題の欄の「入るか」の表示に使う（届くまでは何も出さない）
    preparePdfEngine().catch(e => report('pdf-prepare', e));   // PDF の表示の用意（通信）を、いま済ませておく（§5.1）。失敗しても、表示するときにやり直す
    if (boot.estimates?.pdf_ms) est.pdf = boot.estimates.pdf_ms;
    try {   // 聖書の書名・章・節の選択肢。取れなければ書名は自由入力のまま
      ({ parseRef } = await import('./lib/bible.mjs'));
      bible = await (await fetch('api/bible/books')).json(); if (bible.error) throw new Error(bible.error);
      const dl = $('#bible-books'); dl.innerHTML = ''; for (const b of bible.books) dl.append(new Option(b.short === b.name ? b.name : `${b.short}（${b.name}）`, b.short));
    } catch (e) { bible = null; console.warn('聖書の書名一覧が取れません', e); }
    engine.sleeps = !!boot.engine_sleeps; if (boot.estimates?.wake_ms) est.wake = boot.estimates.wake_ms;
    buildStatic(); loadRare(); masterFiles.paint(); paintWeek(); refreshPublished();
    if (engine.sleeps) checkEngine(); else { engine.state = 'ready'; fetch('api/engine').then(r => r.json()).then(showEngineNote).catch(() => {}); }   // Render なら開いた時点で起こす
    if (engine.sleeps) fetch('api/engine/production').catch(() => {});   // 本番 Cloudflare の版の確かめ直し（1 日 1 回）。準備完了とは無関係に裏で
    if (boot.sync) $('#tab-sync').hidden = false;   // 手元（開発サーバ／recovery）でだけ同期タブ
    paintSaveState();   // 先に済ませる：最新の週が別のタブで編集中だと、下の openWeek はそのタブが閉じるまで待つ   // 週を開くまでは状態なし・「サイトに反映…」なし
    const latest = boot.weeks.at(-1);
    if (latest) await openWeek(latest, false); else notify('保存済みの週がありません。上の「週を選んでください」を押して、「新しい週を作る」から作ってください', { kind: 'ok', key: 'week' });
  })();
})();
