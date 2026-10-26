// ファイルの差し替え（正本 KV・D1 へ）。牧師の画面と担当者ページで共通（docs/slides-role.md §5）。
// pptx の検査（zip・比率・枚数）と指紋はブラウザで計算し、付箋として送る
import { $, mountHtml, loadJSZip } from './dom.mjs';

const HTML = `
      <h2>ファイルの差し替え <span class="hint">名簿などの JSON を、正本（D1）に置き換える。置換前の内容は 14 日残る。歌詞・交読文の pptx は上の「讃頌歌・交読文」、スライドのテンプレは上の「テンプレ」で</span></h2>
      <div class="replace">
        <p><input type="file" id="rep-file" accept=".json"></p>
        <div id="rep-info" class="hint"></div>
        <p id="rep-target" hidden>置換先
          <select id="rep-kind"><option value="masters/people.json">名簿 masters/people.json</option><option value="masters/hymns.json">曲名 masters/hymns.json</option><option value="masters/readings.json">交読文の題 masters/readings.json</option><option value="church.json">教会情報 church.json</option><option value="prayer-list.json">祈り課題 prayer-list.json</option><option value="texts.json">据え置き文 texts.json</option></select>
          <button type="button" id="btn-replace" class="primary">置換</button> <span id="rep-msg"></span>
        </p>
      </div>`;

const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
/** 選んだファイルを調べる（json・pptx）。json は置き先の候補（kind）、どちらも送る付箋（meta）を返す。pptx は歌詞・交読文の pptx の検査（ui/masters.mjs）に使う */
export async function inspectFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
  const name = file.name;
  if (/\.pptx$/i.test(name)) {
    const zip = await (await loadJSZip()).loadAsync(bytes);
    const pres = zip.file('ppt/presentation.xml'); if (!pres) throw new Error('pptx として読めません（ppt/presentation.xml が無い）');
    const xml = await pres.async('string');
    const sz = xml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/); const ratio = sz ? Math.round((Number(sz[1]) / Number(sz[2])) * 100) / 100 : null;
    const slides = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
    const no = (name.match(/^(\d{1,3})/) || [])[1] || '';
    return { bytes, kind: '', no, meta: { source: name, size: bytes.length, sha256, slides, ratio }, info: `pptx: ${slides} 枚、比率 ${ratio}（${ratio && Math.abs(ratio - 1.78) < 0.02 ? '16:9' : ratio && Math.abs(ratio - 1.33) < 0.02 ? '4:3' : '不明'}）、${Math.round(bytes.length / 1024)} KB` };
  }
  if (/\.json$/i.test(name)) {
    let obj; try { obj = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('JSON として読めません'); }
    const kind = /people/.test(name) ? 'masters/people.json' : /hymn/.test(name) ? 'masters/hymns.json' : /reading/.test(name) ? 'masters/readings.json' : /church/.test(name) ? 'church.json' : /prayer/.test(name) ? 'prayer-list.json' : /texts/.test(name) ? 'texts.json' : 'masters/people.json';
    const summary = obj && Array.isArray(obj.people) ? `名簿 ${obj.people.length} 人` : obj && Array.isArray(obj.items) ? `${obj.items.length} 件` : obj && typeof obj === 'object' ? `${Object.keys(obj).length} 項目` : '';
    return { bytes, kind, no: '', meta: { source: name, size: bytes.length, sha256 }, info: `json: ${summary}、${Math.round(bytes.length / 1024)} KB`, json: true };
  }
  throw new Error('pptx / json だけ受け付けます');
}

/**
 * 差し替えの欄を placeholder の位置に置く。
 * @param {{onJsonReplaced?: () => Promise<void>|void}} hooks  JSON（名簿・曲名など）を置き換えた後（画面の候補を読み直す）
 */
export function mountReplace(placeholder, { onJsonReplaced } = {}) {
  mountHtml(placeholder, HTML);
  let repState = null;   // { file, bytes, kind, meta }
  $('#rep-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; repState = null; $('#rep-target').hidden = true; $('#rep-msg').textContent = '';
    if (!f) return;
    if (!/\.json$/i.test(f.name)) { $('#rep-info').textContent = '受け付けられません: ここは JSON だけです（スライドのテンプレは上の「テンプレ」の欄から）'; return; }
    try {
      repState = await inspectFile(f); repState.file = f;
      $('#rep-info').textContent = `${f.name} — ${repState.info}`;
      $('#rep-kind').value = repState.kind; $('#rep-target').hidden = false;
    } catch (err) { $('#rep-info').textContent = '受け付けられません: ' + err.message; }
  });
  $('#btn-replace').addEventListener('click', async () => {
    if (!repState) return;
    const key = $('#rep-kind').value;
    const isJson = key.endsWith('.json') && !key.startsWith('manifest');
    if ((isJson && !repState.json) || (!isJson && repState.json)) return ($('#rep-msg').textContent = 'ファイルの種類と置換先が合いません');
    if (!confirm(`${key} を置き換えます（前の内容は 14 日残ります）。よろしいですか？`)) return;
    $('#btn-replace').disabled = true; $('#rep-msg').textContent = '送っています…';
    try {
      const r = isJson
        ? await fetch(`api/sync/object/${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: repState.bytes })
        : await fetch(`api/files/${key}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-file-meta': encodeURIComponent(JSON.stringify(repState.meta)) }, body: repState.bytes });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
      $('#rep-msg').textContent = `${key} を${j.replaced ? '置き換え' : '新しく置き'}ました`;
      if (isJson) await onJsonReplaced?.();
    } catch (err) { $('#rep-msg').textContent = '失敗: ' + err.message; }
    finally { $('#btn-replace').disabled = false; }
  });
}
