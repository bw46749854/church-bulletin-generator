// 見出しの「週報｜マスタ」の切り替え（docs/design/master-place-options.html 案 A）。牧師の画面と担当者ページで共通。
// マスタは週データに書かない（どの週にも共通）ので、週の欄（タブ）には置かず、見出しの高さで週報と並べる。
// どちらを開いているかは body の data-place と URL の末尾（#masters）に出す。出し分けは CSS の .for-week／.for-masters
import { $$ } from './dom.mjs';

/**
 * 切り替えのボタン（.place の中の [data-place="week"|"masters"]）を動かし、いまの側を body に出す。
 * @param {{onChange?: (place: 'week'|'masters') => void}} hooks  onChange: 切り替えたとき（ブラウザの「戻る」も。読み込んだときは呼ばない）
 * @returns {{get: () => 'week'|'masters', go: (place: 'week'|'masters') => void}}  go: ボタンを押したのと同じ
 */
export function mountPlace({ onChange } = {}) {
  const get = () => location.hash === '#masters' ? 'masters' : 'week';
  const buttons = $$('.place [data-place]');
  function paint() {
    const p = get(); document.body.dataset.place = p;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.place === p));
    return p;
  }
  function go(p) {
    if (p === get()) return;
    history.pushState(null, '', p === 'masters' ? '#masters' : location.pathname + location.search);   // 「戻る」で前の側に戻れるように
    onChange?.(paint());
  }
  for (const b of buttons) b.addEventListener('click', () => go(b.dataset.place));
  window.addEventListener('popstate', () => onChange?.(paint()));   // ブラウザの「戻る」・URL の末尾を書き換えたとき
  paint();
  return { get, go };
}
