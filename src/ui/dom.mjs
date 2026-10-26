// 画面の小道具（牧師の画面と担当者ページで共通。docs/slides-role.md §5）。
// API・素材の URL は、どれもページの場所からの相対（api/…、vendor/…、lib/…）。2 つのページは同じ並びで置く
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
/** ページの場所からの相対 URL（モジュールの場所からではない） */
export const pageUrl = (p) => new URL(p, document.baseURI).href;
/** 部品の HTML を、ページの置き場（placeholder）と入れ替える。置き場の要素そのものは残さない */
export function mountHtml(placeholder, html) { const t = document.createElement('template'); t.innerHTML = html; placeholder.replaceWith(t.content); }

// メッセージは 3 通り: 結果は閉じるまで残る知らせ（notify）、入力の誤りや小さな結果はその場所の横（inlineMsg）、報告だけのものは出さない
export function inlineMsg(target, msg, kind = 'error') {   // target の直後に 1 行（同じ場所に出し直すと置き換え。空文字で消す）
  let m = target.nextElementSibling; if (!m || !m.classList.contains('inline-msg')) { m = el('span', 'inline-msg'); target.after(m); }
  m.textContent = msg; m.className = `inline-msg ${kind}`; m.hidden = !msg;
}
// 失敗の理由を、牧師に読める文にする（ブラウザの英語のエラー・ログイン画面への回り込みを言い換える）
export function why(e) {
  if (e && e.name === 'LoginExpired') return 'ログインの期限が切れました（「ログインし直す」を押してください）';
  const t = String(e && e.message || e || '');
  if (/Importing a module script failed|dynamically imported module|fake worker/i.test(t)) return '画面の部品を読み込めませんでした（通信が途中で切れた可能性があります）';   // Safari と Chromium の import() の失敗（ARCHITECTURE.md §4.8）
  if (/Failed to fetch|Load failed|NetworkError|network/i.test(t)) return '通信できませんでした（インターネットの接続か、ログインの期限切れの可能性があります）';
  if (/Unexpected token|JSON/i.test(t)) return 'サーバーから思わぬ返事が来ました（ログインの期限切れの可能性があります）';
  return t;
}

// ---------- 受付（Cloudflare Access）のログインの期限切れ（ARCHITECTURE.md §6.1） ----------
// 受付のログインは、ログインした時から決まった時間で切れる（使っても延びない）。切れた後も開いている画面はそのまま動くが、
// 通信は受付がログイン画面（別のドメイン）へ回すので、画面からは「通信の失敗」にしか見えない（2026-10-24 の事象）。
// X-Requested-With: XMLHttpRequest を付けた要求には、受付は回す代わりに 401（www-authenticate: Cloudflare-Access）を返す
// （Cloudflare の文書「Session management」）。この画面と同じ場所への fetch すべてにそれを付け、その 401 を LoginExpired にして投げる。
// onChange(切れた) は、切れた・通れるようになったときに 1 回ずつ呼ぶ（ページで 1 回、最初の通信より前に呼ぶ）
export class LoginExpired extends Error { constructor() { super('ログインの期限が切れました'); this.name = 'LoginExpired'; } }
export function guardLogin(onChange) {
  const raw = window.fetch.bind(window); let lost = false;
  const set = (v) => { if (v !== lost) { lost = v; onChange(v); } };
  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, document.baseURI);
    if (url.origin !== location.origin) return raw(input, init);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-requested-with', 'XMLHttpRequest');
    const r = await raw(input, { ...init, headers });
    if (r.status === 401 && /^Cloudflare-Access/i.test(r.headers.get('www-authenticate') || '')) { set(true); throw new LoginExpired(); }
    set(false);
    return r;
  };
}

// ---------- 閉じるまで残る知らせ（ページの #notices に出す） ----------
// key が同じ知らせは置き換える（同じ理由で何度押されても 1 つだけ）。actions は知らせの中のボタン（例: 保存したあとの「PDF を保存」）
export function notify(msg, { kind = 'warn', key = null, actions = [] } = {}) {
  const box = $('#notices');
  if (key) box.querySelector(`[data-key="${key}"]`)?.remove();
  const n = el('div', `notice ${kind}`); if (key) n.dataset.key = key;
  n.append(el('span', 'msg', msg));
  for (const a of actions) { const b = el('button', 'act', a.label); b.type = 'button'; b.addEventListener('click', () => a.onClick(b)); n.append(b); }
  const close = el('button', null, '閉じる'); close.type = 'button'; close.addEventListener('click', () => n.remove());
  n.append(close); box.append(n);
  return n;
}
export const dropNotice = (key) => $(`#notices [data-key="${key}"]`)?.remove();

// ダウンロードは、利用者が押した 1 回につき 1 つだけ。押した処理の中で、ダウンロードの後に通信を始めない（ARCHITECTURE.md §4.8）。
// iOS の Safari は「ダウンロードしますか？」の確認に答えるまでの間、ページが始めた通信を落とし、続けて出したダウンロードは先のものを消す。
// 中身の種類は伏せて（application/octet-stream）渡す。iOS の Safari は PDF など自分で表示できる種類だと、download 属性を無視して
// 確認なしに同じタブで開いてしまう（WebKit Bug 263608。サーバーが attachment で返しても同じ）。名前は download 属性のとおり残る（2026-10-23 に iPhone で確認）
export function download(blob, name) {
  const a = el('a'); a.href = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/** JSZip（pptx の検査・組み立て）。初めて使うときに読み込む */
export async function loadJSZip() {
  if (!window.JSZip) await new Promise((ok, ng) => { const sc = document.createElement('script'); sc.src = 'vendor/jszip.min.js'; sc.onload = ok; sc.onerror = () => ng(new Error('JSZip を読み込めません')); document.head.append(sc); });
  return window.JSZip;
}

// ---------- 画面で起きたエラーを Worker のログに残す（api/client-log。ARCHITECTURE.md §2.5） ----------
// 牧師の端末で何が起きたかを、スクリーンショットなしで後から見られるようにする。週データは送らない（場所・エラーの名前と文・端末の種類だけ）
let reported = 0;
export function report(where, e) {
  console.warn(where, e);
  if (/ResizeObserver loop/.test(String(e && e.message || e))) return;   // ブラウザが出す無害な警告（描き直しが 1 回の通知に収まらなかった）
  if (++reported > 20) return;   // 1 ページで 20 件まで（同じ失敗の繰り返しでログを埋めない）
  const err = e instanceof Error ? e : new Error(String(e && e.message || e));
  const body = { where, name: err.name, message: String(err.message).slice(0, 500), stack: String(err.stack || '').split('\n').slice(0, 6).join('\n').slice(0, 1500), page: location.pathname, ua: navigator.userAgent };
  try { fetch(pageUrl('api/client-log'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch { /* 記録だけ */ }
}
/** 拾い損ねたエラーも記録する（ページで 1 回呼ぶ） */
export function reportUncaught() {
  window.addEventListener('error', (ev) => report('window.error', ev.error || ev.message));
  window.addEventListener('unhandledrejection', (ev) => report('window.unhandledrejection', ev.reason));
}
