// テンプレに JSON を埋め込んで描画前 HTML を作る（純粋関数。Node と Worker で共用）。
// render.js はブラウザ側で動き、埋め込まれた JSON から DOM を組み立てる。
const esc = (obj) => JSON.stringify(obj).replace(/<\/script/g, '<\\/script');

/**
 * @param {string} template  src/template/index.html の中身
 * @param {object} data      { week, config, people, hymns, readings, prayer, fit }
 * @param {{font?: string, baseHref?: string}} opts
 *   baseHref を渡すと <base> を入れ、テンプレ外に置いても css/js/フォントが解決できる
 */
export function buildHtml(template, data, opts = {}) {
  let html = template;
  if (opts.baseHref) html = html.replace('<head>', `<head>\n<base href="${opts.baseHref}">`);
  const put = (id, obj) => { html = html.replace(`<script id="${id}" type="application/json"></script>`, `<script id="${id}" type="application/json">${esc(obj)}</script>`); };
  put('data-week', data.week); put('data-config', data.config); put('data-people', data.people); put('data-hymns', data.hymns);
  put('data-readings', data.readings); put('data-prayer', data.prayer); put('data-texts', data.texts || null); put('data-fit', data.fit); put('data-options', { font: opts.font || 'ipa' });
  return html;
}
