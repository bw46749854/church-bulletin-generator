// 画面で起きたエラー（src/ui/dom.mjs の report → api/client-log）を Workers Logs に 1 行残す。週データは受け取らない（ARCHITECTURE.md §2.5）。
// 牧師の画面（週報 Worker の API）と担当者ページ（担当者用 Worker）で共通。who は担当者用 Worker が受付で分かった人
export function logClientError(j, { who } = {}) {
  const cut = (v, n) => String(v ?? '').slice(0, n);
  console.warn('[画面のエラー]', JSON.stringify({ where: cut(j?.where, 80), name: cut(j?.name, 80), message: cut(j?.message, 500), stack: cut(j?.stack, 1500), page: cut(j?.page, 200), ua: cut(j?.ua, 300), ...(who ? { who: cut(who, 200) } : {}) }));
}
