// 讃頌歌・交読文のマスタと pptx（requirements-todo.md 項目 10）。牧師の画面と担当者ページで共通（docs/slides-role.md §5）。
// 一覧（高さ固定）＋選んだ 1 行の操作（docs/design/master-files-options.html 案 A）
// 番号ごとの状態: ok＝マスタも pptx もある／nofile＝マスタだけ（pptx 担当者の作業待ち）／orphan＝pptx だけ（マスタを消した後）
import { $, $$, el, inlineMsg, why, mountHtml } from './dom.mjs';
import { inspectFile } from './replace.mjs';

export const MF = { hymns: { name: '讃頌歌', title: '曲名' }, readings: { name: '交読文', title: '題' } };
export const badge = (state) => el('span', `badge ${state}`, state === 'nofile' ? 'pptx 未登録' : 'マスタ未登録');

const HTML = `
      <h2>讃頌歌・交読文 <span class="hint">番号と題（マスタ）と、スライドの素材（pptx）。マスタに登録してから pptx を置きます</span></h2>
      <div class="mf">
        <div class="mf-bar">
          <span class="mf-kinds"><button type="button" data-mf-kind="hymns">讃頌歌</button><button type="button" data-mf-kind="readings">交読文</button></span>
          <span class="spacer"></span>
          <span class="mf-kinds">表示 <button type="button" class="small" data-mf-filter="all">すべて</button><button type="button" class="small" data-mf-filter="nofile">pptx 未登録</button><button type="button" class="small" data-mf-filter="orphan">マスタ未登録</button></span>   <!-- name 属性は週データの欄に使うので付けない -->
          <label>番号 <input type="number" id="mf-q" min="1" max="999"></label>
        </div>
        <div class="mf-bar">新規 <label>番号 <input type="number" id="mf-new-no" min="1" max="999"></label> <label><span data-mf-title-label>曲名</span> <input id="mf-new-title" size="24"></label> <button type="button" class="small" id="mf-new">登録</button><span class="spacer"></span><button type="button" class="small" id="mf-lock">削除を有効にする</button></div>
        <div class="mf-list"><table class="mf-table" id="mf-table"></table></div>
        <div class="mf-detail" id="mf-detail" hidden>
          <div class="mf-h" id="mf-h"></div>
          <div class="mf-row"><span class="lbl">マスタ</span><span id="mf-master"></span><input id="mf-title" size="28"> <button type="button" class="small" id="mf-title-save">題を更新</button> <button type="button" class="small del" id="mf-del-master" disabled>マスタだけ削除</button></div>
          <div class="mf-row"><span class="lbl">pptx</span><span id="mf-file"></span> <a id="mf-open" class="small">開く</a> <button type="button" class="small del" id="mf-del-file" disabled>pptx だけ削除</button></div>
          <div class="mf-row" id="mf-up"><span class="lbl"></span><input type="file" id="mf-up-file" accept=".pptx"> <button type="button" class="small" id="mf-up-send" disabled>アップロード</button> <span id="mf-up-info" class="hint"></span></div>
          <div class="mf-row" id="mf-up-no"><span class="lbl"></span><span class="hint">pptx を置くには、先にマスタに登録してください（上の「新規」に番号を入れました）</span></div>
          <div class="mf-row"><span class="spacer"></span><button type="button" class="small del" id="mf-del-both" disabled>両方削除</button></div>
        </div>
      </div>`;

/** 名簿の表示（閲覧のみ） */
export function renderPeople(box, people) {
  box.innerHTML = '';
  const labels = people.flag_labels || {};
  for (const p of people.people) { const d = el('div', null, `${p.name}${p.title}`); if (p.flags?.length) d.append(el('span', 'flag', ' ' + p.flags.map(f => labels[f] || f).join('・'))); box.append(d); }
}

const ratioName = (x) => Math.abs(x - 1.78) < 0.02 ? '16:9' : Math.abs(x - 1.33) < 0.02 ? '4:3' : `比率 ${x}`;
const fileInfo = (f) => [f.slides != null ? `${f.slides} 枚` : '', f.ratio ? ratioName(f.ratio) : '', f.modified || ''].filter(Boolean).join('・');

/**
 * マスタと pptx の欄を placeholder の位置に置く。
 * @param {{getBoot: () => object, onMasterChanged?: () => void, afterPaint?: () => void}} hooks
 *   getBoot: api/bootstrap の内容（hymns・readings・files を読み書きする）／onMasterChanged: 題が変わった（紙面に効く）／afterPaint: 一覧を描き直した後
 * @returns {{paint: () => void, relock: () => void, startNew: (kind: string, no: string) => void}}
 *   relock: 「削除を有効にする」を戻す（マスタを離れたとき）／startNew: 新規の欄にその種類・番号を入れて、題の欄へ（週の欄の「曲名が未登録」から）
 */
export function mountMasterFiles(placeholder, { getBoot, onMasterChanged, afterPaint } = {}) {
  mountHtml(placeholder, HTML);
  const mf = { kind: 'hymns', filter: 'all', sel: null };
  let mfUp = null;   // 選んだ pptx の検査結果（inspectFile）
  let mfUnlocked = false;   // 「削除を有効にする」を押した後か（タブを移ると戻る）
  const mfMaster = (kind) => Object.fromEntries(Object.entries(getBoot()[kind] || {}).filter(([k]) => /^\d{1,3}$/.test(k)));   // _note などの説明は除く
  const mfFiles = (kind) => (getBoot().files || {})[kind] || {};
  function mfRows(kind) {
    const m = mfMaster(kind), f = mfFiles(kind);
    return [...new Set([...Object.keys(m), ...Object.keys(f)])].sort((a, b) => a - b).map(no => ({ no, title: m[no] ?? null, file: f[no] || null }));
  }
  const mfState = (r) => r.title == null ? 'orphan' : r.file ? 'ok' : 'nofile';
  function paintMf() {
    if (!getBoot()) return;
    for (const b of $$('[data-mf-kind]')) {
      const k = b.dataset.mfKind; const rows = mfRows(k); const n = rows.filter(r => mfState(r) === 'nofile').length;
      b.textContent = `${MF[k].name} ${rows.filter(r => r.title != null).length}${n ? ` ⚠${n}` : ''}`; b.classList.toggle('on', k === mf.kind);
    }
    $('[data-mf-title-label]').textContent = MF[mf.kind].title;
    const rows = mfRows(mf.kind);
    for (const b of $$('[data-mf-filter]')) {
      const st = b.dataset.mfFilter; b.classList.toggle('on', st === mf.filter);
      if (st !== 'all') b.textContent = `${st === 'nofile' ? 'pptx 未登録' : 'マスタ未登録'} ${rows.filter(r => mfState(r) === st).length}`;
    }
    const q = $('#mf-q').value.trim();
    const shown = rows.filter(r => (mf.filter === 'all' || mfState(r) === mf.filter) && (!q || r.no.startsWith(q)));
    const t = $('#mf-table'); t.innerHTML = '';
    const head = el('tr'); head.append(el('th', 'no', '番号'), el('th', null, MF[mf.kind].title), el('th', null, 'pptx')); t.append(head);
    for (const r of shown) {
      const tr = el('tr'); tr.dataset.no = r.no; tr.classList.toggle('sel', r.no === mf.sel);
      const title = el('td'); if (r.title != null) title.textContent = r.title; else title.append(badge('orphan'));
      const file = el('td'); if (r.file) file.textContent = fileInfo(r.file); else file.append(badge('nofile'));
      tr.append(el('td', 'no', r.no), title, file); t.append(tr);
    }
    if (!shown.length) { const tr = el('tr'); const td = el('td', 'none', '該当する番号はありません'); td.colSpan = 3; tr.append(td); t.append(tr); }
    paintMfDetail(); afterPaint?.();   // 週の入力欄・スライドの「pptx 未登録」も合わせる
  }
  function paintMfDetail() {
    const r = mf.sel ? mfRows(mf.kind).find(x => x.no === mf.sel) : null;
    $('#mf-detail').hidden = !r; if (!r) return;
    $('#mf-h').textContent = `${MF[mf.kind].name} ${r.no}`;
    const m = $('#mf-master'); m.innerHTML = ''; if (r.title == null) m.append(badge('orphan'));
    const ti = $('#mf-title'); ti.hidden = r.title == null; ti.value = r.title ?? ''; $('#mf-title-save').hidden = r.title == null; $('#mf-title-save').disabled = true;
    const f = $('#mf-file'); f.innerHTML = ''; if (r.file) f.textContent = `${fileInfo(r.file)}（${r.file.source || ''}）`; else f.append(badge('nofile'));
    const open = $('#mf-open'); open.hidden = !r.file; open.href = `api/files/${mf.kind}/${r.no}.pptx`; open.download = `${r.no}.pptx`;
    $('#mf-up').hidden = r.title == null; $('#mf-up-no').hidden = r.title != null;   // pptx はマスタにある番号にだけ置ける
    if (r.title == null && $('#mf-new-no').value !== r.no) { $('#mf-new-no').value = r.no; $('#mf-new-title').value = ''; }
    mfUp = null; $('#mf-up-file').value = ''; $('#mf-up-info').textContent = ''; $('#mf-up-info').className = 'hint';
    $('#mf-up-send').textContent = r.file ? '上書きアップロード' : '新規アップロード'; $('#mf-up-send').disabled = true;
    ['#mf-title-save', '#mf-up-send'].forEach(id => inlineMsg($(id), ''));
    $('#mf-del-master').disabled = !mfUnlocked || r.title == null;
    $('#mf-del-file').disabled = !mfUnlocked || !r.file;
    $('#mf-del-both').disabled = !mfUnlocked || r.title == null || !r.file;
  }
  function mfLock(unlocked) { mfUnlocked = unlocked; $('.mf').classList.toggle('unlocked', unlocked); $('#mf-lock').textContent = unlocked ? '削除を無効に戻す' : '削除を有効にする'; paintMfDetail(); }
  function mfSelect(no) {   // その番号の行を選び、見える位置へ（絞り込みで隠れていれば外す）
    mf.sel = no;
    if (!$(`#mf-table tr[data-no="${no}"]`)) { mf.filter = 'all'; $('#mf-q').value = ''; }
    paintMf(); $(`#mf-table tr[data-no="${no}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function mfMasterChanged(map) {   // マスタは紙面の題に効く（番号の横の表示とプレビュー）
    getBoot()[mf.kind] = map; onMasterChanged?.();
  }
  async function mfSend(url, opts) { const r = await fetch(url, opts); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; }
  $$('[data-mf-kind]').forEach(b => b.addEventListener('click', () => { mf.kind = b.dataset.mfKind; mf.sel = null; paintMf(); }));
  $$('[data-mf-filter]').forEach(b => b.addEventListener('click', () => { mf.filter = b.dataset.mfFilter; paintMf(); }));
  $('#mf-q').addEventListener('input', paintMf);
  // 新規（マスタ）。既にある番号は上書きせず、その行を選ぶ
  $('#mf-new').addEventListener('click', async () => {
    const at = $('#mf-new'); const raw = $('#mf-new-no').value.trim(); const title = $('#mf-new-title').value.trim(); const name = MF[mf.kind].name;
    if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) return inlineMsg(at, '番号（1〜999）を入れてください');
    const no = String(Number(raw));
    if (no in mfMaster(mf.kind)) { mfSelect(no); return inlineMsg(at, `${name} ${no} は既にあります（下で直せます）`); }
    if (!title) return inlineMsg(at, `${MF[mf.kind].title}を入れてください`);
    if (!confirm(`${name} ${no}「${title}」を登録します。よろしいですか？`)) return;
    at.disabled = true;
    try {
      mfMasterChanged(await mfSend(`api/masters/${mf.kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [no]: title }) }));
      $('#mf-new-no').value = ''; $('#mf-new-title').value = ''; mfSelect(no); inlineMsg(at, `${name} ${no} を登録しました`, 'ok');
    } catch (e) { inlineMsg(at, `登録できませんでした: ${why(e)}`); }
    finally { at.disabled = false; }
  });
  // 題の更新（上書き。控えは残さない）
  $('#mf-title').addEventListener('input', () => { const r = mfRows(mf.kind).find(x => x.no === mf.sel); const v = $('#mf-title').value.trim(); $('#mf-title-save').disabled = !r || !v || v === r.title; });
  $('#mf-title-save').addEventListener('click', async () => {
    const at = $('#mf-title-save'); const no = mf.sel; const before = mfMaster(mf.kind)[no]; const after = $('#mf-title').value.trim(); const kind = MF[mf.kind];
    if (!after || after === before) return;
    if (!confirm(`${kind.name} ${no} の${kind.title}を「${before}」から「${after}」に変更します。よろしいですか？`)) return;
    at.disabled = true;
    try { mfMasterChanged(await mfSend(`api/masters/${mf.kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [no]: after }) })); paintMf(); inlineMsg($('#mf-title-save'), '変更しました', 'ok'); }
    catch (e) { at.disabled = false; inlineMsg(at, `変更できませんでした: ${why(e)}`); }
  });
  // pptx のアップロード（新規・上書き）。検査（zip・比率・枚数・指紋）は「ファイルの差し替え」と同じ inspectFile
  $('#mf-up-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; mfUp = null; $('#mf-up-send').disabled = true; const info = $('#mf-up-info'); info.className = 'hint'; info.textContent = '';
    if (!f) return;
    try {
      if (!/\.pptx$/i.test(f.name)) throw new Error('pptx だけ受け付けます');
      const x = await inspectFile(f); const notes = [];
      if (!x.meta.ratio || Math.abs(x.meta.ratio - 1.78) >= 0.02) notes.push('16:9 ではありません');
      if (x.no && String(Number(x.no)) !== mf.sel) notes.push(`ファイル名の番号（${Number(x.no)}）と違います`);
      mfUp = { ...x, notes }; info.textContent = `${x.info}${notes.length ? ' — 注意: ' + notes.join('、') : ''}`; info.classList.toggle('warn', notes.length > 0);
      $('#mf-up-send').disabled = false;
    } catch (err) { info.textContent = '受け付けられません: ' + err.message; info.classList.add('warn'); }
  });
  $('#mf-up-send').addEventListener('click', async () => {
    if (!mfUp) return;
    const at = $('#mf-up-send'); const kind = mf.kind; const no = mf.sel; const name = MF[kind].name; const cur = mfFiles(kind)[no]; const meta = mfUp.meta;
    const neu = [meta.source, meta.slides != null ? `${meta.slides} 枚` : '', meta.ratio ? ratioName(meta.ratio) : ''].filter(Boolean).join('・');
    const note = mfUp.notes.length ? `\n注意: ${mfUp.notes.join('、')}` : '';
    const msg = cur ? `${name} ${no} の pptx を上書きします（今: ${fileInfo(cur)} → 新: ${neu}）。前の内容は 14 日残ります。よろしいですか？${note}`
                    : `${name} ${no} の pptx を登録します（${neu}）。よろしいですか？${note}`;
    if (!confirm(msg)) return;
    at.disabled = true; inlineMsg(at, '送っています…', 'busy');
    try {
      await mfSend(`api/files/${kind}/${no}.pptx`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-file-meta': encodeURIComponent(JSON.stringify(meta)) }, body: mfUp.bytes });
      const boot = getBoot(); ((boot.files ||= {})[kind] ||= {})[no] = { source: meta.source, modified: new Date().toISOString().slice(0, 10), slides: meta.slides ?? null, ratio: meta.ratio ?? null };   // api/bootstrap の files と同じ形（サーバーは目次の行から作る）
      paintMf(); inlineMsg($('#mf-up-send'), cur ? '上書きしました' : '登録しました', 'ok');
    } catch (e) { at.disabled = false; inlineMsg(at, `送れませんでした: ${why(e)}`); }
  });
  // 削除（マスタだけ／pptx だけ／両方）。両方は pptx → マスタの順（途中で止まっても「マスタ未登録」は残らない）
  $('#mf-lock').addEventListener('click', () => { inlineMsg($('#mf-lock'), ''); mfLock(!mfUnlocked); });
  const mfDelMaster = async (kind, no) => mfMasterChanged(await mfSend(`api/masters/${kind}/${no}`, { method: 'DELETE' }));
  const mfDelFile = async (kind, no) => { await mfSend(`api/files/${kind}/${no}.pptx`, { method: 'DELETE' }); delete mfFiles(kind)[no]; };
  for (const [id, what] of [['#mf-del-master', 'master'], ['#mf-del-file', 'file'], ['#mf-del-both', 'both']]) $(id).addEventListener('click', async () => {
    if (!mfUnlocked) return;
    const kind = mf.kind; const no = mf.sel; const name = `${MF[kind].name} ${no}`; const hasFile = !!mfFiles(kind)[no];
    const msg = what === 'master' ? `${name} のマスタを削除します。${hasFile ? 'pptx は残ります。' : ''}よろしいですか？`
              : what === 'file' ? `${name} の pptx を削除します。マスタは残ります（pptx の前の内容は 14 日残ります）。よろしいですか？`
              : `${name} のマスタと pptx を両方削除します。よろしいですか？`;
    if (!confirm(msg)) return;
    const at = $(id); at.disabled = true;
    try {
      if (what !== 'master') await mfDelFile(kind, no);
      if (what !== 'file') await mfDelMaster(kind, no);
      paintMf(); inlineMsg($('#mf-lock'), `${name} の${what === 'master' ? 'マスタ' : what === 'file' ? ' pptx' : 'マスタと pptx'}を削除しました`, 'ok');
    } catch (e) { paintMf(); inlineMsg($('#mf-lock'), `削除できませんでした: ${why(e)}`); }
  });
  $('#mf-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-no]'); if (!tr) return;
    mf.sel = tr.dataset.no; $$('#mf-table tr[data-no]').forEach(x => x.classList.toggle('sel', x === tr)); paintMfDetail();
  });
  function startNew(kind, no) {
    mf.kind = kind; mf.sel = null;
    if (mfFiles(kind)[no]) mfSelect(no); else paintMf();   // pptx だけある番号（マスタ未登録）は、その行も選ぶ
    $('#mf-new-no').value = no; $('#mf-new-title').value = ''; inlineMsg($('#mf-new'), ''); $('#mf-new-title').focus();
  }
  return { paint: paintMf, relock: () => { if (mfUnlocked) mfLock(false); }, startNew };
}
