// 目印と値の表（docs/pptx-template.md §5）。礼拝ごとに使える目印・曲・聖句の名前。値（values.mjs）・展開（fill.mjs）・確かめ（check.mjs）が同じ表を見る

/** 礼拝（式順のファイル名）→ 使える目印 */
export const SERVICES = {
  worship: {
    name: '主日礼拝',
    text: ['日付', '司会', '説教者', '説教題', '招詞', '祈祷', '献金', '献金祈祷', '祝祷', '聖書朗読.箇所', '聖書朗読.旧新', '聖書朗読.ページ'],
    曲: ['準備賛美', '賛美1', '賛美2', '賛美3', '聖餐式'],
    聖句: ['招詞', '聖書朗読', '引用聖句'],
    交読文: true, 報告: true, 祈りの対象: true,
  },
  afternoon: {
    name: '午後礼拝',
    text: ['日付', '説教者', '説教題', '聖書朗読.箇所', '聖書朗読.旧新', '聖書朗読.ページ'],
    曲: ['賛美'],
    聖句: ['聖書朗読', '引用聖句'],
  },
  wednesday: {
    name: '水曜祈祷会',
    text: ['日付', '説教者', '説教題', '聖書朗読.箇所', '聖書朗読.旧新', '聖書朗読.ページ'],
    曲: ['賛美1', '賛美2'],
    聖句: ['聖書朗読', '引用聖句'],
  },
  other: { name: 'その他', text: ['日付'], 曲: [], 聖句: ['引用聖句'] },
};
export const KINDS = Object.keys(SERVICES);

/** 部品の中で使う、まとまりの目印（区分 → 項目） */
export const GROUPS = { 曲: ['番号', '曲名', '歌詞'], 聖句: ['本文', '書名', '章', '節'], 報告: ['番号', '本文'], 祈りの対象: ['番号', '見出し', '名前'] };
/** 場所の目印（そのスライドが歌詞・交読文に置き換わる） */
export const PLACE = new Set(['曲.歌詞', '交読文']);

/** どの礼拝にも無い名前なら false（打ち間違いなど） */
export function knownMarker(name) {
  if (name === '交読文') return true;
  const [g, item] = name.split('.');
  if (item && GROUPS[g]?.includes(item)) return true;
  return KINDS.some(k => SERVICES[k].text.includes(name));
}
/** その礼拝の式順で使える目印か（曲・聖句の目印は、式順の行で値を選ぶので常に可） */
export function markerAllowed(kind, name) {
  const s = SERVICES[kind];
  if (name === '交読文') return !!s.交読文;
  const g = name.split('.')[0];
  if (g === '曲' || g === '聖句') return knownMarker(name);
  if (g === '報告' || g === '祈りの対象') return !!s[g] && knownMarker(name);
  return s.text.includes(name);
}
