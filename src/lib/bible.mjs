// 聖書本文まわりの純粋関数（Node と Worker とブラウザで共用）。
// - stripVerseHtml: SKY2017.db の main_text（ルビ付き HTML）→ 素の文
// - bookAliases: 書名の言い換え（申命記 / 詩篇 / 詩編 / Ⅰコリント / 1コリント / 第一コリント …）→ book_id
// - parseRef: 「マタイ4:1-4」「詩篇114篇」「ルカ8:5-9:2」「申命記8:3」→ {book, chapter, verse, chapter2, verse2}

export function stripVerseHtml(html) {
  let s = html;
  s = s.replace(/<rt>[\s\S]*?<\/rt>/g, '');                       // ルビ（読み）を捨てる
  s = s.replace(/<span class="vn">[\s\S]*?<\/span>/g, '');        // 節番号の表示を捨てる
  s = s.replace(/<\/div>\s*<div[^>]*\bfor=/g, ' <div for=');       // 詩の行（for= の続き）は区切りを空白に
  s = s.replace(/<br\s*\/?>/g, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s+([。、，．！？：；）」』】〉》])/g, '$1').replace(/([（「『【〈《])\s+/g, '$1');
  return s.trim();
}

const NUM = { 'Ⅰ': ['1', '１', '第一', '一'], 'Ⅱ': ['2', '２', '第二', '二'], 'Ⅲ': ['3', '３', '第三', '三'] };
export function bookAliases(books) {
  const out = {};
  const add = (a, id) => { if (a) out[a] = id; };
  for (const b of books) {
    const short = b.book_name_ja_short || b.book_name_ja;   // 略称 NULL は「正式名をそのまま使う」
    add(b.book_name_ja, b.book_id); add(short, b.book_id);
    add(b.book_name_ja.replace(/\s/g, ''), b.book_id);
    const m = short.match(/^([ⅠⅡⅢ])(.+)$/);
    if (m) for (const alt of NUM[m[1]]) { add(alt + m[2], b.book_id); add(m[2] + alt, b.book_id); add(m[2] + '第' + alt.replace(/^第/, ''), b.book_id); }
    if (/記$/.test(short)) add(short.replace(/記$/, ''), b.book_id);   // 言い換えとして「記」抜き（ヨシュア, ネヘミヤ, レビ …）も引ける
  }
  Object.assign(out, { '詩編': 19, '詩': 19, '創世': 1, '出エジプト記': 2, 'レビ記': 3, '民数': 4, 'ヨシュア記': 6, 'ルツ記': 8, 'エズラ記': 15, 'ネヘミヤ記': 16, 'エステル記': 17, 'ヨブ記': 18, '伝道者の書': 21, '伝道': 21, '雅歌': 22, '哀歌': 25, '使徒の働き': 44, '使徒行伝': 44, 'ヨハネの黙示録': 66, '黙示': 66, 'マタイの福音書': 40, 'マルコの福音書': 41, 'ルカの福音書': 42, 'ヨハネの福音書': 43 });
  return out;
}

/** 「マタイ4:1-4」「詩篇114篇」「詩篇91:1～2」「ルカ8:5-9:2」「申命記8:3」。全角数字・～・〜・−・ー を受ける。 */
export function parseRef(ref) {
  const s = String(ref).trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[：]/g, ':').replace(/\s+/g, '')
    .replace(/(\d)[～〜−ー–—－](?=\d)/g, '$1-');   // 範囲の記号は数字の間だけ置き換える（書名の長音「ローマ」は触らない）
  const m = s.match(/^([1-3]?[^\d]+?)(\d+)(?:[:章](\d+)?)?(?:節)?(?:-(\d+)(?::(\d+))?)?(?:篇|章|節)?$/);
  if (!m) return null;
  const [, book, c1, v1, a, b] = m;
  const out = { book, chapter: +c1, verse: v1 ? +v1 : null, chapter2: null, verse2: null };
  if (a && b) { out.chapter2 = +a; out.verse2 = +b; }        // 8:5-9:2
  else if (a) { if (v1) out.verse2 = +a; else { out.chapter2 = +a; } }   // 4:1-4 ／ 詩篇1-2（章の範囲）
  return out;
}

/** 参照 → 節の一覧。db は { all(sql, params) → Promise<rows> } の形（D1 でも node:sqlite でも同じ SQL）。
 *  @returns {Promise<{book: {id, name, short, testament}, ref: string, verses: {chapter, verse, text}[]} | null>} */
export async function lookupVerses(db, refText) {
  const r = parseRef(refText);
  if (!r) return null;
  const book = (await db.all('SELECT b.book_id AS id, b.book_name_ja AS name, COALESCE(b.book_name_ja_short, b.book_name_ja) AS short, b.testament FROM BOOK_ALIASES a JOIN BOOKS b ON b.book_id = a.book_id WHERE a.alias = ?', [r.book]))[0];
  if (!book) return null;
  let where, params;
  if (r.chapter2 != null && r.verse2 != null && r.verse != null) {        // 8:5-9:2
    where = '((chapter = ? AND verse >= ?) OR (chapter > ? AND chapter < ?) OR (chapter = ? AND verse <= ?))';
    params = [r.chapter, r.verse, r.chapter, r.chapter2, r.chapter2, r.verse2];
  } else if (r.chapter2 != null) {                                          // 詩篇1-2（章の範囲）
    where = 'chapter BETWEEN ? AND ?'; params = [r.chapter, r.chapter2];
  } else if (r.verse != null) {                                             // 4:1-4 ／ 8:3
    where = 'chapter = ? AND verse BETWEEN ? AND ?'; params = [r.chapter, r.verse, r.verse2 ?? r.verse];
  } else {                                                                  // 詩篇114篇（章全体）
    where = 'chapter = ?'; params = [r.chapter];
  }
  const verses = await db.all(`SELECT chapter, verse, text FROM VERSES WHERE book_id = ? AND verse >= 0 AND ${where} ORDER BY chapter, verse`, [book.id, ...params]);   // -1（詩篇の巻名）は出さない。0（詩篇の表題）は章全体のとき含む
  return { book, ref: refText, parsed: r, verses };
}
/** 入力画面の書名・章・節の選択肢: [{id, name, short, testament, chapters:[各章の節数]}] と言い換え表 {alias: id} */
export async function bookIndex(db) {
  const books = await db.all('SELECT book_id AS id, book_name_ja AS name, COALESCE(book_name_ja_short, book_name_ja) AS short, testament FROM BOOKS ORDER BY book_id', []);
  const counts = await db.all('SELECT book_id, chapter, MAX(verse) AS n FROM VERSES WHERE verse >= 1 GROUP BY book_id, chapter ORDER BY book_id, chapter', []);
  const byBook = new Map(books.map(b => [b.id, b]));
  for (const c of counts) { const b = byBook.get(c.book_id); if (!b) continue; (b.chapters ||= [])[c.chapter - 1] = c.n; }
  const aliases = {}; for (const a of await db.all('SELECT alias, book_id FROM BOOK_ALIASES', [])) aliases[a.alias] = a.book_id;
  return { books, aliases };
}

export const d1Bible = (d1) => ({ all: async (sql, params) => (await d1.prepare(sql).bind(...params).all()).results });
