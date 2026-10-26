// ① 値（docs/pptx-template.md §1.3・§5）。週のデータ・マスタ・聖書から、礼拝ごとの値の表を作る。pptx は知らない
import { SERVICES } from './vocab.mjs';

const z2 = (n) => String(n).padStart(2, '0');
const VERSE_PACK = 70;   // 短い節はこの字数までまとめて 1 枚に（7/19 の実例に合わせた）

/** 人物 {id, display} → 「名前」と「肩書」。名簿に無ければ display を分ける */
export function nameTitle(person, people) {
  if (!person) return { name: '', title: '' };
  const p = person.id && people?.people?.find(x => x.id === person.id);
  if (p) return { name: p.name, title: p.title || '' };
  const m = String(person.display || '').match(/^(.*?)(牧師|長老|執事|宣教師|先生|兄|姉|氏|スタッフ)?$/);
  return { name: m[1], title: m[2] || '' };
}
const nt = (person, people) => { const p = nameTitle(person, people); return `${p.name} ${p.title}`.trim(); };
/** 役割の欄（献金後の祈祷・祝祷）→ その人。値: preacher | label_preacher（説教者）| presider（司会者）| 直接入力の文字。スライドには役割の名前ではなく人の名前を出す */
function roleOf(m, key, people) {
  let v = m[key] || 'preacher';
  if (v === 'preacher' || v === 'label_preacher') v = m.preacher; else if (v === 'presider') v = m.presider; else if (typeof v === 'string') v = { display: v };
  return nt(v, people);
}
const refOf = (s) => (typeof s === 'string' ? s : s?.ref || '');
const num = (v) => (v == null || v === '' ? null : +v);

/** 聖句 → 1 枚分ずつ（1 節 1 枚、短い節は 70 字までまとめる。詩篇の表題＝0 節は 1 枚に分ける） */
export function verseGroups(found) {
  const groups = []; let cur = null;
  for (const v of found.verses) {
    if (cur && cur.本文.length + v.text.length <= VERSE_PACK && cur.chapter === v.chapter && v.verse > 0 && cur.from > 0) { cur.本文 += v.text; cur.to = v.verse; }
    else { cur = { chapter: v.chapter, from: v.verse, to: v.verse, 本文: v.text }; groups.push(cur); }
  }
  const psalm = found.book.id === 19;
  return groups.map(g => ({
    本文: g.本文, 書名: found.book.name,
    章: `${g.chapter}${psalm ? '篇' : '章'}`,
    節: g.from === 0 ? '' : g.from === g.to ? `${g.from}節` : `${g.from}～${g.to}節`,
  }));
}
/** 聖書朗読の箇所の表示（書名の略称＋章節）・旧新・ページ */
function readingRef(found, page) {
  const pm = String(page || '').match(/(旧約|新約)\s*p?\.?\s*(\d+)/);
  if (!found) return { 箇所: '', 旧新: pm ? pm[1] : '', ページ: pm ? pm[2] : '' };
  const pr = found.parsed;
  const range = pr.verse == null ? `${pr.chapter}` : `${pr.chapter}:${pr.verse}${pr.chapter2 ? '-' + pr.chapter2 + ':' + pr.verse2 : pr.verse2 ? '-' + pr.verse2 : ''}`;
  return { 箇所: `${found.book.short}${range}`, 旧新: pm ? pm[1] : (found.book.testament === 1 ? '旧約' : '新約'), ページ: pm ? pm[2] : '' };
}

/**
 * 礼拝 1 つ分の値の表
 * @param {object} o
 * @param {'worship'|'afternoon'|'wednesday'|'other'} o.kind
 * @param {object} o.week  週データ
 * @param {object} o.people  名簿
 * @param {object} o.hymnsMaster  番号→曲名
 * @param {object} o.config  設定（rules.wednesday_offset_days）
 * @param {number|string|null} [o.prepHymn]  準備賛美の番号（作る直前に画面で入れる。保存しない）
 * @param {(ref: string) => Promise<{book, parsed, verses}|null>} o.lookup  聖句
 * @returns {Promise<{text: Object<string,string>, 曲: Object<string, {番号: number|null, 曲名: string}|null>, 聖句: Object<string, () => Promise<{groups: object[], warnings: string[]}>>, 交読文: number|null, 報告: {番号: number, 本文: string}[], 祈りの対象: {番号: number, 見出し: string, 名前: string}|null, warnings: string[]}>}
 *   曲の値が null は「なし」（その週に無い。聖餐式）。聖句は使うときに読む（読めない箇所の注意は、使ったときだけ出す）
 */
export async function makeValues(o) {
  const { kind, week: w, people } = o;
  const svc = SERVICES[kind]; if (!svc) throw new Error(`礼拝の名前が違います: ${kind}`);
  const m = w.morning || {}, an = w.announcements || {};
  const sec = kind === 'afternoon' ? (w.afternoon || {}) : kind === 'wednesday' ? (w.wednesday || {}) : {};
  const cache = new Map();
  const lookup = async (ref) => { if (!ref) return null; if (!cache.has(ref)) cache.set(ref, o.lookup ? await o.lookup(ref) : null); return cache.get(ref); };
  const song = (no) => { const n = num(no); return { 番号: n, 曲名: (n != null && o.hymnsMaster?.[String(n)]) || '' }; };
  const verses = (refs) => async () => {
    const groups = [], warnings = [];
    for (const ref of refs.filter(Boolean)) { const f = await lookup(ref); if (f) groups.push(...verseGroups(f)); else warnings.push(`聖句を読めません: ${ref}`); }
    return { groups, warnings };
  };

  // 日付（水曜は週の日曜から設定の日数だけ後）
  const [y, mo, d] = w.date.split('-').map(Number);
  const day = new Date(y, mo - 1, d + (kind === 'wednesday' ? o.config.rules.wednesday_offset_days : 0));
  const text = { 日付: `${day.getFullYear()}年 ${z2(day.getMonth() + 1)}月${z2(day.getDate())}日` };
  const out = { text, 曲: {}, 聖句: {}, 交読文: null, 報告: [], 祈りの対象: null, warnings: [] };

  if (kind === 'worship') {
    const scripture = await lookup(m.scripture?.ref || '');
    if (m.scripture?.ref && !scripture) out.warnings.push(`聖書箇所を読めません: ${m.scripture.ref}`);
    const r = readingRef(scripture, m.scripture?.page);
    Object.assign(text, {
      司会: nt(m.presider, people), 説教者: nt(m.preacher, people), 説教題: m.sermon_title || '', 招詞: m.call_to_worship || '',
      祈祷: nt(m.prayer, people), 献金: nt(m.offering, people), 献金祈祷: roleOf(m, 'offering_prayer', people), 祝祷: roleOf(m, 'benediction', people),
      '聖書朗読.箇所': r.箇所, '聖書朗読.旧新': r.旧新, '聖書朗読.ページ': r.ページ,
    });
    const hymns = m.hymns || [];
    const communion = (m.program || []).find(x => x && x.preset === '聖餐式');
    Object.assign(out.曲, { 準備賛美: song(o.prepHymn), 賛美1: song(hymns[0]), 賛美2: song(hymns[1]), 賛美3: song(hymns[2]), 聖餐式: communion ? song(communion.hymn) : null });
    Object.assign(out.聖句, { 招詞: verses([m.call_to_worship]), 聖書朗読: verses([m.scripture?.ref]), 引用聖句: verses(w.slides?.sermon_refs || []) });
    out.交読文 = num(m.responsive_reading);
    const items = [an.lead, ...(an.body || [])].filter(Boolean);
    out.報告 = items.map((t, i) => ({ 番号: i + 1, 本文: t }));
    if (an.prayer_for_lead || an.prayer_for) out.祈りの対象 = { 番号: items.length + 1, 見出し: an.prayer_for_lead || '', 名前: an.prayer_for || '' };
  } else if (kind === 'afternoon' || kind === 'wednesday') {
    const ref = refOf(sec.scripture);
    const r = readingRef(await lookup(ref), kind === 'wednesday' ? sec.scripture?.page : '');
    Object.assign(text, { 説教者: nt(sec.presider_preacher, people), 説教題: sec.sermon_title || '', '聖書朗読.箇所': r.箇所, '聖書朗読.旧新': r.旧新, '聖書朗読.ページ': r.ページ });
    if (kind === 'afternoon') out.曲.賛美 = song(sec.hymn);
    else { const hy = sec.hymns || []; Object.assign(out.曲, { 賛美1: song(hy[0]), 賛美2: song(hy[1]) }); }
    Object.assign(out.聖句, { 聖書朗読: verses([ref]), 引用聖句: verses(w.slides?.[kind === 'afternoon' ? 'afternoon_refs' : 'wednesday_refs'] || []) });
  } else {
    out.聖句.引用聖句 = verses(w.slides?.other_refs || []);
  }
  return out;
}
