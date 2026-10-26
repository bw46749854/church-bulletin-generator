// 週報 API 本体。Web 標準の Request/Response で書き、ローカル dev サーバ（Node）と Cloudflare Worker で同じコードを使う。
// 違いは注入するもの: store（FS / D1）、renderPdf（Playwright / Browser Rendering）、テンプレの読み方。
import { buildHtml } from './html.mjs';
import { newWeekFrom, copyWeekFrom } from './week.mjs';
import { lookupVerses, bookIndex } from './bible.mjs';
import { logClientError } from './client-log.mjs';
import { writableFile, readableFile, TEMPLATE_DELETABLE } from './file-keys.mjs';
import { createFileStore, NotYetError } from './file-store.mjs';
let bookIndexCache = null;   // 聖書の書名一覧（変わらないのでプロセス内に保持）

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// 差し替え・同期で正本に入れる JSON の形の検査（壊れたものを正本に入れない）
function validateObject(key, v) {
  const isStr = (x) => typeof x === 'string';
  const numMap = (o) => o && typeof o === 'object' && !Array.isArray(o) && Object.entries(o).every(([k, t]) => /^\d{1,3}$/.test(k) && isStr(t));
  if (key === 'masters/people.json') return v && Array.isArray(v.titles) && Array.isArray(v.people) && v.people.every(p => p && isStr(p.id) && isStr(p.name) && isStr(p.title) && (p.flags == null || Array.isArray(p.flags))) ? null : '名簿は {titles:[…], people:[{id,name,title,flags}]} の形が必要です';
  if (key === 'masters/hymns.json' || key === 'masters/readings.json') return numMap(v) ? null : '{"番号": "題"} の形が必要です';
  if (key === 'church.json') return v && typeof v === 'object' && Object.values(v).every(isStr) ? null : '教会情報は文字列の項目だけの形が必要です';
  if (key === 'prayer-list.json') return v && Array.isArray(v.items) && v.items.every(isStr) ? null : '祈り課題は {items:[…]} の形が必要です';
  if (key === 'texts.json') return v && Array.isArray(v.cover_verse) && Array.isArray(v.motto) ? null : '据え置き文は {cover_verse:[…], motto:[…]} の形が必要です';
  if (key.startsWith('weeks/')) return v && typeof v === 'object' && DATE.test(v.date || '') && v.morning ? null : '週データは date と morning が必要です';
  return null;
}
const SYNC_KEY = /^(?:weeks\/\d{4}-\d{2}-\d{2}\.json|masters\/(?:people|hymns|readings)\.json|(?:church|prayer-list|texts)\.json|public\/[\w-]+\.json)$/;   // 同期で触れるキー
const SYNC_READ = (key) => SYNC_KEY.test(key) || /^index\/[\p{L}\p{N}_./-]+\.json$/u.test(key);   // 写し（pull）で読むものにはファイルの目次も入れる（書き込みは files/ の API で）
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const attachment = (name) => ({ 'content-disposition': `attachment; filename="${name}"` });
async function sha1(text) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
export async function sha256Bytes(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** キー順を固定した JSON 文字列（同じ内容なら必ず同じ文字列＝指紋が安定する） */
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
/** 週データの中に出てくる番号（賛美・交読文の番号）を全部拾う。曲名マスタを「その週が使う分だけ」に絞るため。多めに拾っても害はない */
function numbersIn(v, out = new Set()) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1000) out.add(String(v));
  else if (typeof v === 'string' && /^\d{1,3}$/.test(v)) out.add(v);
  else if (Array.isArray(v)) v.forEach(x => numbersIn(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => numbersIn(x, out));
  return out;
}
const pick = (obj, keys) => Object.fromEntries([...keys].filter(k => obj[k] != null).map(k => [k, obj[k]]));
const today = () => new Date().toISOString().slice(0, 10);
const PREVIEW_TTL = 24 * 3600, SAVED_TTL = 90 * 24 * 3600;

/**
 * @param {object} o
 * @param {object} o.store          get/put/delete/list（store-fs / store-d1）
 * @param {object} o.config         data/config.json（Git 管理。church は store から足す）
 * @param {object} o.fit            fit-policy.json
 * @param {() => Promise<string>} o.template   テンプレ HTML の中身
 * @param {(html: string) => Promise<{pdf: Uint8Array, overflow: string[]}>} o.renderPdf
 * @param {(request: Request) => string|undefined} [o.renderBase]  PDF 化する HTML の <base>（Worker では自分の公開 URL）
 * @param {number} [o.retainWeeks]  保存後に残す週の数（本番は wrangler.jsonc の RETAIN_WEEKS。ローカルは無制限）
 * @param {(info: {week, pdf, data, font}) => Promise<void>} [o.afterSave]  ローカルで out/ に書く用
 * @param {boolean} [o.rawPdf]      POST api/_pdf（HTML→PDF の素通し）を開ける。wrangler dev から Playwright を借りる用
 * @param {{get(key): Promise<Uint8Array|null>, put?(key, bytes, metadata): Promise<void>, delete?(key): Promise<void>, list?(): Promise<{key, size, sha256}[]>}} [o.files]   ファイルの中身（KV / ローカル data/files）。キーは blobs/<指紋>（目次は D1。src/lib/file-store.mjs）
 * @param {{get(key): Promise<{bytes: Uint8Array, metadata: object}|null>, put(key, bytes, opts: {metadata, ttl}): Promise<void>}} [o.cache]
 *        PDF の写し（KV）。無ければ毎回生成
 * @param {() => Promise<string>} [o.templateVersion]  テンプレ（HTML/CSS/JS/縮小規則/フォント）の版。指紋に入れる
 * @param {() => Promise<{engine: string, version: string}|null>} [o.engineInfo]  PDF エンジンの種類と Chromium の版（Render の /health など）。無ければ生成結果から学ぶ
 * @param {() => Promise<string>} [o.productionVersion]  本番エンジン（Cloudflare）の Chromium の版を取る（1 日 1 回、Render と比べる用）
 * @param {() => Promise<{ok, status, body}>} [o.deployHook]  サイトの再ビルドを起こす（反映ボタン）
 * @param {() => Promise<object>} [o.siteBuilds]  サイトの直近のビルド状況
 * @param {{all(sql, params): Promise<object[]>}} [o.bible]  聖書本文（D1 / ローカル data/bible.sqlite）
 * @param {(request: Request) => Promise<{who?: string|null, via?: string}>|{who?: string|null, via?: string}} [o.actor]
 *        誰が・どの入口から（変更の記録に使う。docs/slides-role.md §7）。入口が渡す: 週報 Worker＝受付の証明、担当者の窓口＝担当者、開発サーバ＝手元
 */
export function createApi(o) {
  const retain = o.retainWeeks ?? Infinity;
  const weekKey = (d) => `weeks/${d}.json`;
  const getJson = async (key) => { const t = await o.store.get(key); return t == null ? null : JSON.parse(t); };
  const need = async (key) => { const v = await getJson(key); if (v == null) throw new Error(`${key} がありません（初期データを投入してください）`); return v; };
  const versionOf = async (d) => { const t = await o.store.get(weekKey(d)); return t == null ? null : await sha1(t); };
  const listWeeks = async () => (await o.store.list('weeks/')).map(k => k.slice(6, 16)).filter(d => DATE.test(d)).sort();
  const readWeek = async (d) => { const w = await getJson(weekKey(d)); if (w) w.date = d; return w; };   // ファイル名が識別子。中身の date は従わせる
  const writeWeek = async (w) => { const t = JSON.stringify(w, null, 2) + '\n'; await o.store.put(weekKey(w.date), t); return sha1(t); };
  // ---------- 書き込みの記録と退避（docs/slides-role.md §7）----------
  // 正本への書き込み（マスタ・素材・週・公開用）はすべて下の関数を通す。前の内容を history/ に残し（マスタ・素材）、
  // 「いつ・誰が・どの入口から・何を」を meta/changes/<日付>.json に足す。本番（D1・KV）でも手元（data/）でも同じ。
  // 日ごとの表を読んで足して書くので、同じ瞬間の 2 件は片方が落ち得る（書き込みは週に数回なので許す）
  const now = () => new Date().toISOString();
  async function recordChange(request, what) {
    const a = (await o.actor?.(request)) || {};
    const key = `meta/changes/${today()}.json`; const cur = (await getJson(key)) || [];
    cur.push({ at: now(), who: a.who || null, via: a.via || null, ...what });
    await o.store.put(key, JSON.stringify(cur));
  }
  /** JSON の正本を書く。前と違えば history/ に残す。@returns {Promise<boolean>} 前の内容があったか */
  async function writeObject(request, key, text, what = {}) {
    const prev = await o.store.get(key);
    if (prev != null && prev !== text) await o.store.put(`history/${key}/${now()}`, prev);
    await o.store.put(key, text);
    await recordChange(request, { op: 'put', key, ...what });
    return prev != null;
  }
  const writeMaster = (request, key, obj, what) => writeObject(request, key, JSON.stringify(obj, null, 2) + '\n', what);
  /** JSON の正本を消す。前の内容は history/ に残す。@returns {Promise<boolean>} 前の内容があったか */
  async function removeObject(request, key, what = {}) {
    const prev = await o.store.get(key);
    if (prev == null) return false;
    await o.store.put(`history/${key}/${now()}`, prev);
    await o.store.delete(key);
    await recordChange(request, { op: 'delete', key, ...what });
    return true;
  }
  // ファイル（歌詞・交読文・テンプレ）の置き場: 中身は KV に指紋の名前で、今の版の目次は D1（docs/file-store.md）。目次の行は上の共通部品で書く
  const fileStore = o.files ? createFileStore({ store: o.store, files: o.files, writeObject, removeObject }) : null;
  /** 歌詞・交読文の pptx の有無（画面の「pptx 未登録」）: 番号 → {source, modified, slides, ratio} */
  const materialsOf = async (kind) => Object.fromEntries((fileStore ? await fileStore.list(`${kind}/`) : []).map(f => [f.key.slice(kind.length + 1, -'.pptx'.length), { source: f.source ?? null, modified: f.modified ?? null, slides: f.slides ?? null, ratio: f.ratio ?? null }]));

  // 入力画面向け：マスタを丸ごと（候補一覧に使う）
  async function loadData(week) {
    const church = await need('church.json');
    return {
      week,
      config: { ...o.config, church },
      people: await need('masters/people.json'),
      hymns: await need('masters/hymns.json'),
      readings: await need('masters/readings.json'),
      prayer: await need('prayer-list.json'),
      texts: (await getJson('texts.json')) || { cover_verse: [], motto: [] },
      fit: o.fit,
    };
  }
  // 描く側（render.js）向け：その週の印刷に必要な分だけ（射影）。指紋はこの JSON に掛けるので、
  // ここに無いものは印刷に影響できない＝「指紋に入れ忘れたのに印刷が変わる」事故が起きない
  async function renderData(week) {
    const all = await loadData(week);
    const nums = numbersIn(week);
    const pastor = (all.people.people || []).find(p => (p.flags || []).includes('pastor')) || (all.people.people || []).find(p => p.title === '牧師');
    return {
      week,
      config: all.config,
      people: { people: pastor ? [pastor] : [] },
      hymns: pick(all.hymns, nums),
      readings: pick(all.readings, nums),
      prayer: all.prayer,
      texts: all.texts,
      fit: all.fit,
    };
  }
  // PDF エンジンの種類と Chromium の版。Render なら /health で聞ける。Cloudflare は生成結果から学んで meta/engine.json に覚える
  async function knownEngine() {
    if (o.engineInfo) { try { const e = await o.engineInfo(); if (e) return e; } catch { /* 眠っている等 → 生成時に分かる */ } }
    return getJson('meta/engine.json');
  }
  // 本番（Cloudflare）の Chromium の版。cloudflare で生成したときに覚え、Render 使用中は 1 日 1 回だけ聞きに行く
  async function productionVersion() {
    const cur = await getJson('meta/cf-chromium.json');
    if (cur && Date.now() - Date.parse(cur.checked) < 24 * 3600 * 1000) return cur;
    if (!o.productionVersion) return cur;
    try { const version = await o.productionVersion(); const rec = { version, checked: new Date().toISOString() }; await o.store.put('meta/cf-chromium.json', JSON.stringify(rec)); return rec; }
    catch (e) { return cur || { version: '', checked: '', error: String(e.message || e) }; }
  }
  async function rememberEngine(e) {
    if (e.engine === 'cloudflare' && e.version) await o.store.put('meta/cf-chromium.json', JSON.stringify({ version: e.version, checked: new Date().toISOString() }));
    const cur = await getJson('meta/engine.json');
    if (!cur || cur.engine !== e.engine || cur.version !== e.version) await o.store.put('meta/engine.json', JSON.stringify({ ...e, since: new Date().toISOString() }));
  }
  const fingerprint = async (data, font, tv, eng) => 'pdf/' + await sha256(canonical(data) + '|' + (font || 'ipa') + '|' + tv + '|' + eng.engine + '/' + eng.version);   // エンジンごとに別の写し（フォントの出どころが違う: Cloudflare は URL、Render は焼き込み）
  async function logPdf(entry) {   // 1 日 1 件の JSON に追記（無料枠の消費を実測する）
    const key = `meta/pdf-log/${today()}.json`;
    const cur = (await getJson(key)) || [];
    cur.push(entry); await o.store.put(key, JSON.stringify(cur));
    if (!entry.hit) {   // 進み具合のバーの目安（直近 20 回の生成時間）
      const d = (await getJson('meta/pdf-durations.json')) || [];
      d.push(entry.ms); await o.store.put('meta/pdf-durations.json', JSON.stringify(d.slice(-20)));
    }
  }
  /** 進み具合のバーの目安（ミリ秒）。記録が無いうちは既定値 */
  async function estimates() {
    const avg = (a) => a && a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    return { pdf_ms: avg(await getJson('meta/pdf-durations.json')) || 12000, wake_ms: avg(await getJson('meta/render-wake.json')) || 50000 };
  }
  /**
   * PDF を得る。指紋（描く JSON＋フォント＋テンプレ版＋エンジン版）で KV の写しを引き、無ければ生成して置く。
   * @returns {Promise<{pdf, overflow, data, engine:{engine,version}, key, hit:boolean}>}
   */
  async function render(week, font, request, { ttl = PREVIEW_TTL } = {}) {
    const t0 = Date.now();
    const data = await renderData(week);
    const tv = o.templateVersion ? await o.templateVersion() : 'dev';
    let eng = await knownEngine();
    if (eng && o.cache) {
      const key = await fingerprint(data, font, tv, eng);
      const hit = await o.cache.get(key);
      if (hit) {
        if (ttl > PREVIEW_TTL) await o.cache.put(key, hit.bytes, { metadata: hit.metadata, ttl });   // 保存：期限を延ばす
        await logPdf({ t: new Date().toISOString(), week: week.date, engine: eng.engine, version: eng.version, ms: Date.now() - t0, hit: true });
        return { pdf: hit.bytes, overflow: hit.metadata.overflow || [], data, engine: eng, key, hit: true };
      }
    }
    const html = buildHtml(await o.template(), data, { font, baseHref: o.renderBase?.(request) });
    const r = await o.renderPdf(html);
    eng = { engine: r.engine || 'unknown', version: r.version || '' };
    await rememberEngine(eng);
    const key = await fingerprint(data, font, tv, eng);
    if (o.cache) await o.cache.put(key, r.pdf, { metadata: { overflow: r.overflow, engine: eng.engine, version: eng.version, created: new Date().toISOString() }, ttl });
    await logPdf({ t: new Date().toISOString(), week: week.date, engine: eng.engine, version: eng.version, ms: Date.now() - t0, hit: false });
    return { pdf: r.pdf, overflow: r.overflow, data, engine: eng, key, hit: false };
  }
  const pdfResponse = (r, extra = {}) => new Response(r.pdf, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-overflow': encodeURIComponent(r.overflow.join(',')), 'x-pdf-engine': `${r.engine.engine}/${r.engine.version}`, 'x-pdf-cache': r.hit ? 'hit' : 'miss', ...extra } });

  /** @param {Request} request  @param {string} path  api/ から後ろ（例 'week/2026-07-19'） */
  return async function handle(request, path) {
    const m = request.method;
    try { path = decodeURIComponent(path); } catch { return json({ error: 'パスが読めません' }, 400); }   // テンプレの部品の名前は日本語（URL ではエンコードされて届く）
    const body = async () => request.json();
    let r;
    if (path === 'bootstrap' && m === 'GET') {
      const d = await loadData(null);
      const files = { hymns: await materialsOf('hymns'), readings: await materialsOf('readings') };   // pptx の有無（マスタはあるが pptx が無い番号を画面に出す）
      return json({ config: d.config, people: d.people, hymns: d.hymns, readings: d.readings, files, prayer: d.prayer, texts: d.texts, fit: o.fit || null, weeks: await listWeeks(),   // fit: 題の欄の「入るか」の表示（_title_fields と縮小の規則）
        retain_weeks: Number.isFinite(retain) ? retain : null, estimates: await estimates(), engine_sleeps: !!o.engineInfo });
    }
    if ((r = path.match(/^week\/(\d{4}-\d{2}-\d{2})$/)) && m === 'GET') {
      const w = await readWeek(r[1]); if (!w) return json({ error: 'not found' }, 404);
      return json({ week: w, version: await versionOf(r[1]), saved_at: o.store.stamp ? await o.store.stamp(weekKey(r[1])) : null });
    }
    if ((r = path.match(/^week\/(\d{4}-\d{2}-\d{2})\/json$/)) && m === 'GET') {   // JSON のダウンロード（牧師の手元保管用）
      const w = await readWeek(r[1]); if (!w) return json({ error: 'not found' }, 404);
      return new Response(JSON.stringify(w, null, 2) + '\n', { headers: { 'content-type': 'application/json; charset=utf-8', ...attachment(`${r[1]}.json`) } });
    }
    if ((r = path.match(/^week\/(\d{4}-\d{2}-\d{2})\/new$/)) && m === 'GET') {
      if (await o.store.get(weekKey(r[1])) != null) return json({ error: 'その週はすでに保存されています' }, 409);
      // もとにする週 X（from）と写し方（mode: fresh＝①新しい週として／copy＝②丸ごと複製）。ARCHITECTURE.md §19。
      // from を省くと、Y より前で一番新しい保存済みの週（以前の動き）
      const q = new URL(request.url).searchParams; const from = q.get('from'); const mode = q.get('mode') === 'copy' ? 'copy' : 'fresh';
      let prev = null;
      if (from) { if (!DATE.test(from)) return json({ error: 'もとにする週の日付が不正です' }, 400); prev = await readWeek(from); if (!prev) return json({ error: `${from} の週は保存されていません` }, 404); }
      else { const prevDates = (await listWeeks()).filter(d => d < r[1]); prev = prevDates.length ? await readWeek(prevDates.at(-1)) : null; }
      if (mode === 'copy' && !prev) return json({ error: '複製するもとの週がありません' }, 400);
      return json({ week: mode === 'copy' ? copyWeekFrom(prev, r[1]) : newWeekFrom(prev, r[1]), version: null, from: prev ? prev.date : null, mode });
    }
    if ((r = path.match(/^week\/(\d{4}-\d{2}-\d{2})\/exists$/)) && m === 'GET') {
      return json({ exists: await o.store.get(weekKey(r[1])) != null });
    }
    if ((r = path.match(/^week\/(\d{4}-\d{2}-\d{2})\/rename$/)) && m === 'POST') {   // 日付の変更（保存済みの週）
      const { to } = await body();
      if (!DATE.test(to || '')) return json({ error: '日付が不正です' }, 400);
      const w = await readWeek(r[1]); if (!w) return json({ error: 'not found' }, 404);
      if (await o.store.get(weekKey(to)) != null) return json({ error: `${to} はすでにあります` }, 409);
      w.date = to; const version = await writeWeek(w); await o.store.delete(weekKey(r[1]));
      await recordChange(request, { op: 'rename', key: weekKey(r[1]), to: weekKey(to) });
      await o.afterRename?.(r[1], to);
      return json({ week: w, version });
    }
    if (path === 'client-log' && m === 'POST') {   // 画面で起きたエラー（src/ui/dom.mjs の report）。Workers Logs に 1 行残すだけ。週データは受け取らない
      logClientError(await body().catch(() => ({})));
      return new Response(null, { status: 204 });
    }
    if (path === 'preview' && m === 'POST') {
      const { week, font } = await body();
      if (!week || !DATE.test(week.date || '')) return json({ error: 'date が不正です' }, 400);
      return pdfResponse(await render(week, font, request));
    }
    if (path === 'save' && m === 'POST') {   // 成功時は PDF 本体を返す（x-version, x-overflow 付き）。PDF は保存しない＝再生成できるので置かない
      const { week, font, base_version, force } = await body();
      if (!week || !DATE.test(week.date || '')) return json({ error: 'date が不正です' }, 400);
      const current = await versionOf(week.date);
      if (!force && (current || null) !== (base_version || null)) {
        return json({ error: current ? '別の場所で保存されています' : 'サーバー側の週が削除されています', current_version: current }, 409);
      }
      const res = await render(week, font, request, { ttl: SAVED_TTL });
      const version = await writeWeek(week);
      await o.store.put(`meta/pdf/${week.date}.json`, JSON.stringify({ key: res.key, engine: res.engine, font: font || 'ipa', saved: new Date().toISOString() }));   // しおり：この週の正式な PDF はこれ
      const pruned = [];   // 保持の上限で消した週（画面に知らせる。いま保存した週自身のこともある＝§4.6 の落とし穴）
      if (Number.isFinite(retain)) {   // 累積しない：新しい方から retain 週だけ残す
        const dates = await listWeeks();
        for (const d of dates.slice(0, Math.max(0, dates.length - retain))) { await o.store.delete(weekKey(d)); await o.store.delete(`meta/pdf/${d}.json`); pruned.push(d); }
      }
      await recordChange(request, { op: 'save', key: weekKey(week.date), ...(pruned.length ? { pruned } : {}) });
      await o.afterSave?.({ week, pdf: res.pdf, data: res.data, font });
      return pdfResponse(res, { 'x-version': version, 'x-saved-at': new Date().toISOString(), 'x-pruned': pruned.join(','), ...attachment(`${week.date}.pdf`) });
    }
    if ((r = path.match(/^pdf\/(\d{4}-\d{2}-\d{2})$/)) && m === 'GET') {   // 保存済みの週の PDF（しおり → 写し。無ければ作り直す）
      const w = await readWeek(r[1]); if (!w) return json({ error: 'not found' }, 404);
      const font = new URL(request.url).searchParams.get('font') || undefined;
      const mark = await getJson(`meta/pdf/${r[1]}.json`);
      if (mark && o.cache && (font || 'ipa') === mark.font) {
        const hit = await o.cache.get(mark.key);
        if (hit) return pdfResponse({ pdf: hit.bytes, overflow: hit.metadata.overflow || [], engine: hit.metadata, hit: true }, attachment(`${r[1]}.pdf`));
      }
      return pdfResponse(await render(w, font, request, { ttl: SAVED_TTL }), attachment(`${r[1]}.pdf`));
    }
    // ---------- サイトへの反映：保存済みの週から公開用 JSON を作り、サイトの再ビルドを起こす ----------
    if (path === 'publish' && m === 'POST') {
      const { date, version } = await body();
      if (!DATE.test(date || '')) return json({ error: 'date が不正です' }, 400);
      const w = await readWeek(date); if (!w) return json({ error: 'その週は保存されていません。先に保存してください' }, 400);
      const cur = await versionOf(date); if (version && cur !== version) return json({ error: '画面の内容と保存済みの内容が違います。保存してからもう一度' }, 409);
      const d = new Date(date + 'T00:00:00'); const m0 = w.morning || {};
      const current = {
        date, date_ja: `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`, time: o.config.morning?.time_label || '',
        presider: m0.presider?.display || '', preacher: m0.preacher?.display || '',
        scripture: typeof m0.scripture === 'string' ? m0.scripture : (m0.scripture?.ref || ''), sermon_title: m0.sermon_title || '',
        published_at: new Date().toISOString(),
      };
      await writeObject(request, 'public/current.json', JSON.stringify(current, null, 2) + '\n', { date });
      let deploy = null;
      if (o.deployHook) { try { deploy = await o.deployHook(); } catch (e) { deploy = { ok: false, status: 0, body: String(e.message || e) }; } }
      return json({ ok: true, current, deploy });
    }
    if (path === 'public/current' && m === 'GET') {   // サイト（ビルド時）が読む。誰でも読める・キャッシュ 5 分
      const t = await o.store.get('public/current.json');
      return new Response(t || 'null', { headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' } });
    }
    if (path === 'site-builds' && m === 'GET') {   // サイトの直近のビルド（反映が効いたかを見る）
      if (!o.siteBuilds) return json({ error: 'サイトの再ビルドは未設定です' }, 501);
      return json(await o.siteBuilds());
    }
    if (path === 'engine/production' && m === 'GET') {   // 本番 Cloudflare の Chromium の版を確かめ直す（1 日 1 回。画面が裏で呼ぶ）
      return json(await productionVersion());
    }
    if (path === 'engine' && m === 'GET') {   // いまの PDF エンジンと本番 Cloudflare の版。違えば mismatch
      // 眠るエンジン（Render）は /health の返事が来たら準備完了（ready）。返事を待つ間に起こす。時間で判定はしない
      let current = null, error = null, ready = true, waited = 0;
      if (o.engineInfo) {
        const t0 = Date.now();
        try { current = await o.engineInfo(); } catch (e) { error = String(e.message || e); ready = false; }
        waited = Date.now() - t0;
        if (ready && waited >= 10000) {   // 起こした回だけ記録（進み具合のバーの目安。直近 20 回）
          const w = (await getJson('meta/render-wake.json')) || [];
          w.push(waited); await o.store.put('meta/render-wake.json', JSON.stringify(w.slice(-20)));
        }
      } else current = await getJson('meta/engine.json');
      // 本番 Cloudflare の版は覚えている値だけ使う（確かめ直しはブラウザを起こすので数秒〜失敗があり得る。準備完了をそれに巻き込まない）。
      // 確かめ直しは engine/production で別に行う
      const prod = current && current.engine !== 'cloudflare' ? await getJson('meta/cf-chromium.json') : null;
      const mismatch = !!(prod && prod.version && current && current.version && prod.version !== current.version);
      return json({ current, production: prod, mismatch, error, ready, waited_ms: waited, estimates: await estimates() });
    }
    // ---------- 同期（正本の写し）: 一覧・1 件の取得・1 件の置換 ----------
    if (path === 'sync/manifest' && m === 'GET') {   // 全 JSON（本文の指紋）と全ファイル（KV の付箋）。手元の写しと比べる材料
      const objects = [];
      for (const e of await o.store.entries()) objects.push({ key: e.key, size: e.body.length, sha256: await sha256(e.body), updated_at: e.updated_at });
      const files = o.files?.list ? await o.files.list() : [];
      return json({ at: new Date().toISOString(), objects, files });
    }
    if ((r = path.match(/^sync\/object\/(.+)$/)) && SYNC_READ(r[1]) && m === 'GET') {
      const t = await o.store.get(r[1]); if (t == null) return json({ error: 'not found' }, 404);
      return new Response(t, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if ((r = path.match(/^sync\/object\/(.+)$/)) && SYNC_KEY.test(r[1]) && m === 'PUT') {   // 手元で作った週などを正本へ。置換前は history/ に残す
      const text = await request.text(); let parsed;
      try { parsed = JSON.parse(text); } catch { return json({ error: 'JSON として読めません' }, 400); }
      const bad = validateObject(r[1], parsed); if (bad) return json({ error: bad }, 400);
      const replaced = await writeObject(request, r[1], text, { by: 'replace' });
      return json({ ok: true, key: r[1], replaced });
    }
    if (path === 'pdf-stats' && m === 'GET') {   // 今日の生成回数・所要時間（無料枠の消費の実測）と、いまのエンジン
      const log = (await getJson(`meta/pdf-log/${today()}.json`)) || [];
      const gen = log.filter(x => !x.hit);
      return json({ date: today(), generated: gen.length, hits: log.length - gen.length, seconds: Math.round(gen.reduce((a, x) => a + x.ms, 0) / 1000), engine: await knownEngine() });
    }
    if (path === 'masters/texts' && m === 'POST') {   // 据え置きの文（主日礼拝の聖句・表紙の標語）。年に 1 回程度
      const b = await body(); const cur = (await getJson('texts.json')) || { cover_verse: [], motto: [] };
      const lines = (v) => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : null;
      if (lines(b.cover_verse)) cur.cover_verse = lines(b.cover_verse);
      if (Array.isArray(b.motto)) cur.motto = b.motto.slice(0, 2).map(x => String(x).trim());
      await writeMaster(request, 'texts.json', cur);
      return json(cur);
    }
    if ((r = path.match(/^masters\/(hymns|readings)$/)) && m === 'POST') {   // 曲名・交読文の題の追加・修正（{"番号": "題"}。前の内容は history/ に残す）
      const key = `masters/${r[1]}.json`; const cur = await need(key);
      const b = await body();
      for (const [k, v] of Object.entries(b)) if (!/^\d{1,3}$/.test(k) || typeof v !== 'string' || !v.trim()) return json({ error: `番号（1〜3 桁）と題が要ります: ${k}` }, 400);
      const titles = {};   // 変更の記録: 番号 → [前の題, 後の題]（新規は前が null）
      for (const [k, v] of Object.entries(b)) { titles[k] = [cur[k] ?? null, v.trim()]; cur[k] = v.trim(); }
      await writeMaster(request, key, cur, { titles });
      return json(cur);
    }
    if ((r = path.match(/^masters\/(hymns|readings)\/(\d{1,3})$/)) && m === 'DELETE') {   // マスタの 1 件を削除（pptx には触らない）
      const key = `masters/${r[1]}.json`; const cur = await need(key);
      if (!(r[2] in cur)) return json({ error: `${r[2]} はマスタにありません` }, 404);
      const titles = { [r[2]]: [cur[r[2]], null] };   // 削除は後が null
      delete cur[r[2]];
      await writeMaster(request, key, cur, { op: 'delete', titles });
      return json(cur);
    }
    if (path === 'masters/prayer-list' && m === 'POST') {   // 覚えて祈りましょう（更新は稀。画面の「編集」から）
      const { items } = await body();
      if (!Array.isArray(items) || !items.every(x => typeof x === 'string')) return json({ error: 'items（文字列の配列）が要ります' }, 400);
      const cur = { items: items.map(x => x.trim()).filter(Boolean) };
      await writeMaster(request, 'prayer-list.json', cur);
      return json(cur);
    }
    if (path === 'masters/church' && m === 'POST') {   // 住所・口座・牧師連絡先
      const b = await body(); const cur = await need('church.json');
      for (const k of Object.keys(cur)) if (typeof b[k] === 'string') cur[k] = b[k].trim();
      await writeMaster(request, 'church.json', cur);
      return json(cur);
    }
    if (path === 'changes' && m === 'GET') {   // 変更の記録（新しい順）。?days=7（最大 92）
      const days = Math.min(92, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 7));
      const out = [];
      for (let i = 0; i < days; i++) out.push(...((await getJson(`meta/changes/${new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)}.json`)) || []).reverse());
      return json({ days, changes: out });
    }
    if (path === 'export' && m === 'GET') {   // マスタ一式のバックアップ（正本は store 側だけなので、手元に控えを取る）
      const bundle = {
        exported_at: new Date().toISOString(),
        church: await getJson('church.json'),
        masters: { people: await getJson('masters/people.json'), hymns: await getJson('masters/hymns.json'), readings: await getJson('masters/readings.json') },
        prayer_list: await getJson('prayer-list.json'),
        texts: await getJson('texts.json'),
      };
      return new Response(JSON.stringify(bundle, null, 2) + '\n', { headers: { 'content-type': 'application/json; charset=utf-8', ...attachment(`shuho-masters-${bundle.exported_at.slice(0, 10)}.json`) } });
    }
    if (path === 'templates' && m === 'GET') {   // テンプレ一式の一覧（管理画面。docs/pptx-template.md §1.1）。付箋（大きさ・指紋・置いた時刻）だけ
      return json({ files: fileStore ? await fileStore.list('template/') : [], cleanup: await getJson('meta/cleanup/last.json') });   // cleanup: 最後の片付け（docs/file-store.md §3）
    }
    if ((r = path.match(/^files\/(.+)$/)) && writableFile(r[1]) && m === 'PUT') {   // 素材の差し替え（歌詞・交読文・テンプレ一式）。検査はブラウザ側で済ませ、付箋（x-file-meta）と一緒に送る
      if (!fileStore || !o.files.put) return json({ error: 'ファイル置き場に書けません' }, 501);
      const key = r[1]; const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) return json({ error: 'ファイルが空か、25MB を超えています' }, 400);
      if (key.endsWith('.pptx') && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) return json({ error: 'pptx（zip）ではありません' }, 400);
      if (key.endsWith('.json')) { try { JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { return json({ error: `JSON として読めません（${e.message}）` }, 400); } }
      let meta = {}; try { meta = JSON.parse(decodeURIComponent(request.headers.get('x-file-meta') || '{}')); } catch { /* 付箋なし */ }   // ファイル名に日本語があるので URL エンコードで運ぶ
      const sha = await sha256Bytes(bytes);
      if (meta.sha256 && meta.sha256 !== sha) return json({ error: '送られた内容と指紋が一致しません（送信中に壊れた可能性）' }, 400);
      const mm = key.match(/^(hymns|readings)\/(\d+)\.pptx$/);
      if (mm && !(mm[2] in ((await getJson(`masters/${mm[1]}.json`)) || {}))) return json({ error: `${mm[2]} はマスタにありません。先にマスタに登録してください` }, 400);
      const uploaded = new Date().toISOString();
      const row = mm ? { sha256: sha, size: bytes.length, uploaded, source: meta.source || `${mm[2]}.pptx`, modified: uploaded.slice(0, 10), slides: meta.slides ?? null, ratio: meta.ratio ?? null }
                     : { sha256: sha, size: bytes.length, uploaded, source: meta.source || null };
      const replaced = await fileStore.put(request, key, bytes, row);   // 中身は blobs/<指紋>、目次の行に元のファイル名など（docs/file-store.md）
      return json({ ok: true, key, size: bytes.length, replaced });
    }
    if ((r = path.match(/^files\/(.+)$/)) && TEMPLATE_DELETABLE.test(r[1]) && m === 'DELETE') {   // テンプレの部品・古い置き場を消す（前の内容は history/ に写す。背景・式順は差し替えるだけ）
      if (!fileStore) return json({ error: 'ファイル置き場から消せません' }, 501);
      if (!(await fileStore.remove(request, r[1]))) return json({ error: `${r[1]} はありません` }, 404);
      return json({ ok: true, key: r[1] });
    }
    if ((r = path.match(/^files\/(hymns|readings)\/(\d{1,3})\.pptx$/)) && m === 'DELETE') {   // 歌詞・交読文の pptx を削除（前の内容は history/ に写す。マスタには触らない）
      if (!fileStore) return json({ error: 'ファイル置き場から消せません' }, 501);
      const key = `${r[1]}/${r[2]}.pptx`;
      if (!(await fileStore.remove(request, key))) return json({ error: `${key} はありません` }, 404);
      return json({ ok: true, key });
    }
    if ((r = path.match(/^files\/(blobs\/([0-9a-f]{64}))$/)) && m === 'GET') {   // 版の中身そのもの（写し・同期用。名前と中身が変わらないので、そのまま返す）
      const bytes = o.files ? await o.files.get(r[1]) : null;
      if (!bytes) return json({ error: 'not found' }, 404);
      return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', etag: `"${r[2]}"` } });
    }
    if ((r = path.match(/^files\/(.+)$/)) && readableFile(r[1]) && m === 'GET') {   // スライド素材（テンプレ一式・歌詞・交読文）。今の版は目次で決まる
      if (!fileStore) return json({ error: 'ファイル置き場が設定されていません' }, 501);
      const row = await fileStore.stat(r[1]);
      if (!row) return json({ error: 'not found' }, 404);
      const type = r[1].endsWith('.json') ? 'application/json; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      // 素材は別の端末で差し替えられ得るので、ブラウザには「使う前に毎回、指紋が変わっていないか聞く」ようにさせる（no-cache＋ETag）。
      // 指紋は目次の行（D1。書いた瞬間から最新）。同じなら 304 で本文を送らない（KV も読まない）
      const etag = `"${row.sha256}"`;
      const headers = { 'content-type': type, 'cache-control': 'private, no-cache', etag };
      const seen = (request.headers.get('if-none-match') || '').split(',').map(x => x.trim().replace(/^W\//, ''));   // 圧縮の途中で弱い ETag（W/"…"）に変わることがある
      if (seen.includes(etag)) return new Response(null, { status: 304, headers });
      try { return new Response(await fileStore.read(row, r[1]), { headers }); }
      catch (e) { if (e instanceof NotYetError) return json({ error: e.message }, 503); throw e; }
    }
    if (path === 'bible/books' && m === 'GET') {   // 書名・章数・各章の節数・言い換え表（入力画面の選択肢）
      if (!o.bible) return json({ error: '聖書 DB が設定されていません' }, 501);
      bookIndexCache ||= await bookIndex(o.bible);
      return json(bookIndexCache);
    }
    if (path === 'bible' && m === 'GET') {   // ?ref=マタイ4:1-4 → 節の一覧
      if (!o.bible) return json({ error: '聖書 DB が設定されていません' }, 501);
      const ref = new URL(request.url).searchParams.get('ref') || '';
      const found = await lookupVerses(o.bible, ref);
      if (!found) return json({ error: `聖書箇所を読めません: ${ref}` }, 400);
      return json(found);
    }
    if (o.rawPdf && path === '_pdf' && m === 'POST') {   // 開発用：HTML をそのまま PDF に
      const r = await o.renderPdf(await request.text());
      return pdfResponse({ pdf: r.pdf, overflow: r.overflow, engine: { engine: r.engine || 'local', version: r.version || '' }, hit: false });
    }
    return json({ error: 'not found' }, 404);
  };
}
