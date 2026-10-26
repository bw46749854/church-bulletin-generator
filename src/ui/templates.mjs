// テンプレの管理（docs/pptx-template.md。デザイン案 C: docs/design/template-manager-options.html）。牧師の画面と担当者ページで共通。
// 背景と色（背景.pptx・背景.json）・式順 4 つ・部品を、ダウンロード・差し替え・追加・削除する。差し替える前にその場で確かめ（§6）、
// 作れなくなる礼拝・注意を確認の文に出す。マスタの側を開いたときに初めて読む（週報だけ使うときは読まない）
import { $, el, mountHtml, inlineMsg, why, download, loadJSZip, pageUrl } from './dom.mjs';

const SVC = [['worship', '主日礼拝'], ['afternoon', '午後礼拝'], ['wednesday', '水曜祈祷会'], ['other', 'その他']];
const BG = 'template/背景.pptx', COLORS = 'template/背景.json', ORDER = (k) => `template/式順/${k}.json`, PART = (n) => `template/部品/${n}.pptx`;
const PART_PREFIX = 'template/部品/';
const enc = (k) => k.split('/').map(encodeURIComponent).join('/');
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const kb = (n) => (n == null ? '' : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fileName = (key) => key.split('/').pop();

const HTML = `
      <h2>テンプレ <span class="hint">スライドの背景と色・式順・部品。変えると次に作るスライドから効きます。前の版は 14 日残ります</span></h2>
      <div class="tpl">
        <div class="tpl-check" id="tpl-check"><b>確かめ</b> <span class="muted">マスタを開くと読みます</span></div>
        <div class="tpl-box">
          <h3>背景と色 <span class="hint">全部のスライドに効きます</span></h3>
          <div class="tpl-colors">
            <div class="tpl-mini" id="tpl-mini"><span class="t1">賛　美</span><span class="t2">ローマ人への手紙 3章23節</span></div>
            <div>
              <div class="tpl-crow"><span class="lbl">背景色</span><input type="color" id="tpl-bg"><code id="tpl-bg-code"></code><label><input type="checkbox" id="tpl-bg-keep"> 背景.pptx の背景のまま（写真のとき）</label></div>
              <div class="tpl-crow"><span class="lbl">基本の文字</span><input type="color" id="tpl-base"><code id="tpl-base-code"></code></div>
              <div class="tpl-crow"><span class="lbl">強調の文字</span><input type="color" id="tpl-accent"><code id="tpl-accent-code"></code><span class="hint">聖句の出典・交読文の一方の声</span></div>
              <p class="tpl-actions"><button type="button" class="primary" id="tpl-colors-save" disabled>色を保存</button> <button type="button" data-tpl-dl="${COLORS}">背景.json をダウンロード</button> <button type="button" id="tpl-colors-replace">背景.json を差し替え…</button></p>
              <p class="tpl-actions"><span class="hint" id="tpl-bg-meta"></span> <button type="button" data-tpl-dl="${BG}">背景.pptx をダウンロード</button> <button type="button" id="tpl-bg-replace">背景.pptx を差し替え…</button></p>
            </div>
          </div>
        </div>
        <div class="tpl-box">
          <h3>式順 <span class="hint">並びと、行ごとの曲・聖句（JSON）</span></h3>
          <div class="tpl-orders" id="tpl-orders"></div>
        </div>
        <div class="tpl-box">
          <h3>部品 <span class="hint" id="tpl-parts-hint">中身（図形と目印）だけを使い、背景は上の背景になります</span> <button type="button" id="tpl-part-add">部品を追加…</button></h3>
          <div class="tpl-tiles" id="tpl-tiles"></div>
          <p class="tpl-actions"><button type="button" id="tpl-zip">テンプレ一式をダウンロード（zip）</button> <span class="hint" id="tpl-cleanup"></span></p>
        </div>
        <input type="file" id="tpl-file" hidden>
      </div>`;

/** @returns {{open: () => Promise<void>}}  open: マスタの側を開いたとき（初めてなら読む） */
export function mountTemplates(placeholder) {
  mountHtml(placeholder, HTML);
  let lib = null;          // { C: check, P: pptx, V: vocab, JSZip }
  let st = null;           // { list: Map<key, {size, sha256, uploaded}>, orders: {kind: 行の配列|Error}, colors: {…}|Error, parts: 名前[] }
  let result = null;       // 確かめの結果 { res: [{k, name, errors, warnings}], notes: [], markers: Map }
  let loading = null;
  const cache = new Map(); // key → { sha, opened }（指紋が同じなら読み直さない）

  async function libs() {
    if (!lib) {
      const [C, P, V, JSZip] = await Promise.all([import(pageUrl('lib/slides/check.mjs')), import(pageUrl('lib/slides/pptx.mjs')), import(pageUrl('lib/slides/vocab.mjs')), loadJSZip()]);
      lib = { C, P, V, JSZip };
    }
    return lib;
  }
  async function getBytes(key) {
    const r = await fetch(`api/files/${enc(key)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${fileName(key)}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async function openFile(key) {
    const sha = st.list.get(key)?.sha256; const c = cache.get(key);
    if (c && sha && c.sha === sha) return c.opened;
    const b = await getBytes(key); if (!b) return null;
    const opened = await lib.P.openPptx(lib.JSZip, b); cache.set(key, { sha, opened }); return opened;
  }
  async function put(key, bytes, source) {
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
    const r = await fetch(`api/files/${enc(key)}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-file-meta': encodeURIComponent(JSON.stringify({ source, size: bytes.length, sha256 })) }, body: bytes });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `${r.status}`); return j;
  }
  async function del(key) {
    const r = await fetch(`api/files/${enc(key)}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `${r.status}`);
  }
  const usedBy = (name) => SVC.filter(([k]) => Array.isArray(st.orders[k]) && st.orders[k].some(e => e.部品 === name));

  // ---------- 読む・確かめる ----------
  async function load() {
    await libs();
    const r = await fetch('api/templates'); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `テンプレの一覧を読めません: ${r.status}`);
    const list = new Map(j.files.map(f => [f.key, f]));
    const text = async (k) => { const b = list.has(k) ? await getBytes(k) : null; return b ? new TextDecoder().decode(b) : null; };
    const orders = {};
    for (const [k, name] of SVC) { const t = await text(ORDER(k)); try { orders[k] = t == null ? new lib.C.TemplateError(`${name}の式順（${ORDER(k)}）がありません`) : lib.C.parseOrder(t, k); } catch (e) { orders[k] = e; } }
    let colors; try { const t = await text(COLORS); colors = t == null ? new lib.C.TemplateError(`色の設定（${COLORS}）がありません`) : lib.C.parseColors(t); } catch (e) { colors = e; }
    const parts = [...list.keys()].filter(k => k.startsWith(PART_PREFIX)).map(k => k.slice(PART_PREFIX.length, -'.pptx'.length)).sort((a, b) => a.localeCompare(b, 'ja'));
    st = { list, orders, colors, parts, cleanup: j.cleanup || null };
    paint();
    await check();
  }
  async function check() {
    const box = $('#tpl-check'); box.replaceChildren(el('b', null, '確かめ'), el('span', 'muted', '部品を読んで確かめています…'));
    const markers = new Map(); const notes = [];
    const names = new Set([...st.parts, ...SVC.flatMap(([k]) => (Array.isArray(st.orders[k]) ? st.orders[k].map(e => e.部品) : []))]);
    for (const n of names) {
      const p = st.list.has(PART(n)) ? await openFile(PART(n)) : null;
      markers.set(n, p ? lib.C.partMarkers(p) : undefined);
      if (p) {
        for (const s of lib.C.splitMarkers(p)) notes.push(`部品「${n}」の目印 ${s} が書式の境目をまたいでいます（入れた文字は最初の文字の書式になります）`);
        if (!usedBy(n).length) for (const m of markers.get(n)) if (!lib.V.knownMarker(m)) notes.push(`部品「${n}」の目印 {{${m}}} は表にありません`);   // 使っている部品は式順の確かめで出る
      }
    }
    const common = [];
    if (!st.list.has(BG)) common.push(`背景（${BG}）がありません`); else common.push(...lib.C.checkBackground(await openFile(BG)));
    if (st.colors instanceof Error) common.push(st.colors.message);
    const res = SVC.map(([k, name]) => {
      const o = st.orders[k];
      if (o instanceof Error) return { k, name, errors: [...common, o.message], warnings: [] };
      const r = lib.C.checkOrder(k, o, markers, { markers: true });
      return { k, name, errors: [...common, ...r.errors], warnings: r.warnings };
    });
    result = { res, notes, markers };
    paintCheck(); paintOrders();
  }

  // ---------- 描く ----------
  function paintCheck() {
    const box = $('#tpl-check'); box.replaceChildren(el('b', null, '確かめ'));
    for (const r of result.res) box.append(el('span', r.errors.length ? 'ng' : r.warnings.length ? 'warnc' : 'ok', `● ${r.name} ${r.errors.length ? '作れない' : '作れる'}`));
    const lines = [...result.res.flatMap(r => [...r.errors.map(e => `${r.name}: ${e}`), ...r.warnings.map(w => `${r.name}: ${w}`)]), ...result.notes];
    box.append(el('span', 'muted', lines.length ? `注意 ${lines.length} 件` : '注意なし'));
    const again = el('button', null, '確かめ直す'); again.type = 'button'; again.addEventListener('click', () => open(true)); box.append(again);
    if (lines.length) { const ul = el('ul', 'tpl-notes'); for (const l of lines) ul.append(el('li', null, l)); box.append(ul); }
  }
  function paint() {
    // 背景と色
    const c = st.colors instanceof Error ? null : st.colors;
    $('#tpl-bg').value = '#' + (c?.背景色 || '0000FF'); $('#tpl-base').value = '#' + (c?.文字色.基本 || 'FFFFFF'); $('#tpl-accent').value = '#' + (c?.文字色.強調 || 'FFFF00');
    $('#tpl-bg-keep').checked = !!c && c.背景色 === null;
    paintColors(); $('#tpl-colors-save').disabled = true;
    const bg = st.list.get(BG); $('#tpl-bg-meta').textContent = bg ? `背景.pptx（${kb(bg.size)}・${day(bg.uploaded)}）` : '背景.pptx がありません';
    paintOrders();
    // 部品
    $('#tpl-parts-hint').textContent = `${st.parts.length} 個。中身（図形と目印）だけを使い、背景は上の背景になります`;
    const cl = st.cleanup, at = cl && new Date(cl.at);   // 控えの片付け（毎朝 3:00。docs/file-store.md §3）
    $('#tpl-cleanup').textContent = `前の版の控えは 14 日残し、毎朝 3:00 に片付けます（${cl ? `最後: ${at.getMonth() + 1}/${at.getDate()} ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}、控え ${cl.history} 件・中身 ${cl.blobs} 件${cl.more ? '。残りは翌朝' : ''}` : 'まだ動いていません'}）`;
    const tiles = $('#tpl-tiles'); tiles.replaceChildren();
    for (const n of st.parts) {
      const f = st.list.get(PART(n)); const used = usedBy(n);
      const t = el('div', 'tpl-tile'); t.dataset.part = n;
      t.append(el('div', 'nm', n), el('div', 'meta', `${kb(f.size)}・${day(f.uploaded)}`));
      const chips = el('div', 'chips');
      if (used.length === SVC.length) chips.append(el('span', 'chip', '4 つとも')); else if (used.length) for (const [, nm] of used) chips.append(el('span', 'chip', nm)); else chips.append(el('span', 'chip none', '使っていない'));
      const b = el('div', 'b');
      b.append(button('ダウンロード', () => downloadKey(PART(n))), button('差し替え…', (at) => choose('.pptx', (file) => replacePart(n, file, at))));
      if (!used.length) b.append(button('削除', (at) => removePart(n, at), 'del'));
      t.append(chips, b); tiles.append(t);
    }
  }
  function paintOrders() {
    const box = $('#tpl-orders'); box.replaceChildren();
    for (const [k, name] of SVC) {
      const o = st.orders[k]; const r = result?.res.find(x => x.k === k);
      const d = el('div'); d.dataset.order = k;
      d.append(el('b', null, name), ' ', el('span', 'muted', Array.isArray(o) ? `${o.length} 行` : 'ありません'), el('br'));
      d.append(el('span', !r ? 'muted' : r.errors.length ? 'ng' : 'ok', !r ? '確かめています…' : r.errors.length ? '● 作れない' : '● 作れる'));
      const b = el('div', 'b');
      if (st.list.has(ORDER(k))) b.append(button('ダウンロード', () => downloadKey(ORDER(k))));
      b.append(button('差し替え…', (at) => choose('.json', (file) => replaceOrder(k, file, at))));
      d.append(b); box.append(d);
    }
  }
  function button(label, fn, cls) { const b = el('button', cls || null, label); b.type = 'button'; b.addEventListener('click', () => fn(b)); return b; }
  const code = (id) => $(id).value.slice(1).toUpperCase();
  function paintColors() {
    const keep = $('#tpl-bg-keep').checked; $('#tpl-bg').disabled = keep;
    const mini = $('#tpl-mini'); mini.style.background = keep ? 'repeating-linear-gradient(45deg, #ddd 0 10px, #eee 10px 20px)' : '#' + code('#tpl-bg');
    mini.querySelector('.t1').style.color = '#' + code('#tpl-base'); mini.querySelector('.t2').style.color = '#' + code('#tpl-accent');
    $('#tpl-bg-code').textContent = keep ? '（背景.pptx のまま）' : code('#tpl-bg'); $('#tpl-base-code').textContent = code('#tpl-base'); $('#tpl-accent-code').textContent = code('#tpl-accent');
  }
  for (const id of ['#tpl-bg', '#tpl-base', '#tpl-accent', '#tpl-bg-keep']) $(id).addEventListener('input', () => { paintColors(); $('#tpl-colors-save').disabled = false; });

  // ---------- 操作 ----------
  let pending = null;
  function choose(accept, fn) { const f = $('#tpl-file'); f.accept = accept; f.value = ''; pending = fn; f.click(); }
  $('#tpl-file').addEventListener('change', async (e) => { const file = e.target.files[0]; const fn = pending; pending = null; if (file && fn) await fn(file); });
  const run = async (at, work, done) => {
    at.disabled = true; inlineMsg(at, '送っています…', 'busy');
    try { await work(); inlineMsg(at, ''); await open(true); inlineMsg($('#tpl-check'), done, 'ok'); }
    catch (err) { inlineMsg(at, `できませんでした: ${err?.name === 'TemplateError' ? err.message : why(err)}`); }
    finally { at.disabled = false; }
  };
  async function downloadKey(key) {
    try { const b = await getBytes(key); if (!b) throw new Error(`${fileName(key)} がありません`); download(new Blob([b]), fileName(key)); }
    catch (err) { inlineMsg($('#tpl-check'), `ダウンロードできませんでした: ${why(err)}`); }
  }
  /** 部品を差し替えた（足した）ら、その部品を使う礼拝で何が起きるか */
  function partNotes(name, part) {
    const ms = lib.C.partMarkers(part); const notes = [];
    for (const m of ms) if (!lib.V.knownMarker(m)) notes.push(`目印 {{${m}}} は表にありません（空になります）`);
    for (const s of lib.C.splitMarkers(part)) notes.push(`目印 ${s} が書式の境目をまたいでいます（入れた文字は最初の文字の書式になります）`);
    const markers = new Map(result?.markers || []); markers.set(name, ms);
    for (const [k, nm] of usedBy(name)) {
      const r = lib.C.checkOrder(k, st.orders[k], markers, { markers: true }); const mine = (t) => t.includes(`（${name}）`);
      r.errors.filter(mine).forEach(e => notes.push(`${nm}が作れなくなります: ${e}`)); r.warnings.filter(mine).forEach(w => notes.push(`${nm}: ${w}`));
    }
    return notes;
  }
  async function replacePart(name, file, at, isNew = false) {
    const bytes = new Uint8Array(await file.arrayBuffer()); let part;
    try { part = await lib.P.openPptx(lib.JSZip, bytes); } catch { return inlineMsg(at, `${file.name} は pptx として読めません`); }
    const used = usedBy(name).map(([, nm]) => nm);
    const notes = partNotes(name, part);
    const head = isNew ? `部品「${name}」を ${file.name} から足します（${part.slides.length} 枚）。` : `部品「${name}」を ${file.name} で置き換えます（${part.slides.length} 枚。前の版は 14 日残ります）。${used.length ? `\n使っている礼拝: ${used.join('・')}` : ''}`;
    if (!confirm(head + (notes.length ? '\n\n注意:\n' + notes.join('\n') : '') + '\n\nよろしいですか？')) return;
    await run(at, () => put(PART(name), bytes, file.name), `部品「${name}」を${isNew ? '足し' : '置き換え'}ました`);
  }
  async function replaceOrder(kind, file, at) {
    const name = SVC.find(([k]) => k === kind)[1]; const text = await file.text(); let order;
    try { order = lib.C.parseOrder(text, kind); } catch (err) { return inlineMsg(at, `受け付けられません: ${err.message}`); }
    const r = lib.C.checkOrder(kind, order, result?.markers || new Map(), { markers: true });
    const notes = [...r.errors.map(e => `作れません: ${e}`), ...r.warnings];
    if (!confirm(`${name}の式順を ${file.name} で置き換えます（${order.length} 行。前の版は 14 日残ります）。` + (notes.length ? '\n\n注意:\n' + notes.join('\n') : '') + '\n\nよろしいですか？')) return;
    await run(at, () => put(ORDER(kind), new TextEncoder().encode(text), file.name), `${name}の式順を置き換えました`);
  }
  $('#tpl-bg-replace').addEventListener('click', () => { const at = $('#tpl-bg-replace'); choose('.pptx', async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer()); let bg;
    try { bg = await lib.P.openPptx(lib.JSZip, bytes); } catch { return inlineMsg(at, `${file.name} は pptx として読めません`); }
    const errs = lib.C.checkBackground(bg); if (errs.length) return inlineMsg(at, `受け付けられません: ${errs.join(' ')}`);
    if (!confirm(`背景.pptx を ${file.name} で置き換えます（全部のスライドに効きます。前の版は 14 日残ります）。よろしいですか？`)) return;
    await run(at, () => put(BG, bytes, file.name), '背景.pptx を置き換えました');
  }); });
  $('#tpl-colors-replace').addEventListener('click', () => { const at = $('#tpl-colors-replace'); choose('.json', async (file) => {   // 色の組をファイルで（季節の色を取っておいて戻す など）
    const text = await file.text(); let c;
    try { c = lib.C.parseColors(text); } catch (err) { return inlineMsg(at, `受け付けられません: ${err.message}`); }
    if (!confirm(`背景.json を ${file.name} で置き換えます（背景色 ${c.背景色 ?? '背景.pptx のまま'}・基本 ${c.文字色.基本}・強調 ${c.文字色.強調}。全部のスライドに効きます。前の版は 14 日残ります）。よろしいですか？`)) return;
    await run(at, () => put(COLORS, new TextEncoder().encode(text), file.name), '背景.json を置き換えました');
  }); });
  $('#tpl-colors-save').addEventListener('click', async () => {
    const at = $('#tpl-colors-save');
    const obj = { 背景色: $('#tpl-bg-keep').checked ? null : code('#tpl-bg'), 文字色: { 基本: code('#tpl-base'), 強調: code('#tpl-accent') } };
    const text = JSON.stringify(obj, null, 2) + '\n';
    try { lib.C.parseColors(text); } catch (err) { return inlineMsg(at, err.message); }
    if (!confirm(`色を保存します（背景色 ${obj.背景色 ?? '背景.pptx のまま'}・基本 ${obj.文字色.基本}・強調 ${obj.文字色.強調}。全部のスライドに効きます）。よろしいですか？`)) return;
    await run(at, () => put(COLORS, new TextEncoder().encode(text), '背景.json'), '色を保存しました');
  });
  $('#tpl-part-add').addEventListener('click', () => { const at = $('#tpl-part-add'); choose('.pptx', async (file) => {
    const name = (prompt('部品の名前（式順から呼ぶ名前。日本語・英数字・「-」「_」）', file.name.replace(/\.pptx$/i, '')) || '').trim();
    if (!name) return;
    if (!lib.C.validPartName(name)) return inlineMsg(at, `「${name}」は部品の名前に使えません（スペースや記号は使えません）`);
    if (st.parts.includes(name) && !confirm(`部品「${name}」はもうあります。置き換えますか？`)) return;
    await replacePart(name, file, at, !st.parts.includes(name));
  }); });
  async function removePart(name, at) {
    if (usedBy(name).length) return inlineMsg(at, '式順で使っている部品は消せません');
    if (!confirm(`部品「${name}」を消します（どの式順でも使っていません。前の版は 14 日残ります）。よろしいですか？`)) return;
    await run(at, () => del(PART(name)), `部品「${name}」を消しました`);
  }
  $('#tpl-zip').addEventListener('click', async () => {
    const at = $('#tpl-zip'); at.disabled = true; inlineMsg(at, 'まとめています…', 'busy');
    try {
      const zip = new lib.JSZip();
      for (const key of st.list.keys()) { const b = await getBytes(key); if (b) zip.file(key.slice('template/'.length), b); }
      const d = new Date(); const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      download(new Blob([await zip.generateAsync({ type: 'uint8array' })], { type: 'application/zip' }), `テンプレ一式-${ymd}.zip`); inlineMsg(at, '');
    } catch (err) { inlineMsg(at, `まとめられませんでした: ${why(err)}`); }
    finally { at.disabled = false; }
  });
  for (const b of $('.tpl').querySelectorAll('button[data-tpl-dl]')) b.addEventListener('click', () => downloadKey(b.dataset.tplDl));

  async function open(force = false) {
    if (loading && !force) return loading;
    loading = load().catch(err => { $('#tpl-check').replaceChildren(el('b', null, '確かめ'), el('span', 'ng', `テンプレを読めませんでした: ${why(err)}`)); loading = null; });
    return loading;
  }
  return { open };
}
