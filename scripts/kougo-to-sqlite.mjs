// 口語訳聖書（1954/1955 年版。日本では著作権の保護期間が満了）を、scripts/import-bible.mjs が読む形の SQLite（BOOKS / VERSES）にする。
// 出典: seven1m/open-bibles の jpn-kougo.osis.xml（Public Domain）。無ければ下の URL から取ってくる（約 13MB）。
// 使い方: node scripts/kougo-to-sqlite.mjs [jpn-kougo.osis.xml] [出力 .db]   → 既定は data/kougo.db（Git 外）
//   続けて: node scripts/import-bible.mjs data/kougo.db   （--remote が無ければ wrangler dev のローカル D1 と data/bible.sqlite に入る）
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const SOURCE = 'https://raw.githubusercontent.com/seven1m/open-bibles/3ca49fb73163f42297a32b7b1b1c40cf3dafd84b/jpn-kougo.osis.xml';
const root = resolve(import.meta.dirname, '..');
const [srcArg, outArg] = process.argv.slice(2);
const src = resolve(srcArg || resolve(root, 'data/jpn-kougo.osis.xml'));
const out = resolve(outArg || resolve(root, 'data/kougo.db'));

// [book_id, OSIS の書名, 英略号, 旧新（1/2）, 略称（null は正式名をそのまま使う。src/lib/bible.mjs の bookAliases）]
const BOOKS = [
  [1, 'Gen', 'gen', 1, null], [2, 'Exod', 'exo', 1, null], [3, 'Lev', 'lev', 1, null], [4, 'Num', 'num', 1, null], [5, 'Deut', 'deu', 1, null],
  [6, 'Josh', 'jos', 1, null], [7, 'Judg', 'jdg', 1, null], [8, 'Ruth', 'rut', 1, null], [9, '1Sam', '1sa', 1, 'Ⅰサムエル'], [10, '2Sam', '2sa', 1, 'Ⅱサムエル'],
  [11, '1Kgs', '1ki', 1, 'Ⅰ列王記'], [12, '2Kgs', '2ki', 1, 'Ⅱ列王記'], [13, '1Chr', '1ch', 1, 'Ⅰ歴代誌'], [14, '2Chr', '2ch', 1, 'Ⅱ歴代誌'], [15, 'Ezra', 'ezr', 1, null],
  [16, 'Neh', 'neh', 1, null], [17, 'Esth', 'est', 1, null], [18, 'Job', 'job', 1, null], [19, 'Ps', 'psa', 1, null], [20, 'Prov', 'pro', 1, null],
  [21, 'Eccl', 'ecc', 1, '伝道者'], [22, 'Song', 'sng', 1, null], [23, 'Isa', 'isa', 1, 'イザヤ'], [24, 'Jer', 'jer', 1, 'エレミヤ'], [25, 'Lam', 'lam', 1, null],
  [26, 'Ezek', 'ezk', 1, 'エゼキエル'], [27, 'Dan', 'dan', 1, 'ダニエル'], [28, 'Hos', 'hos', 1, 'ホセア'], [29, 'Joel', 'jol', 1, 'ヨエル'], [30, 'Amos', 'amo', 1, 'アモス'],
  [31, 'Obad', 'oba', 1, 'オバデヤ'], [32, 'Jonah', 'jon', 1, 'ヨナ'], [33, 'Mic', 'mic', 1, 'ミカ'], [34, 'Nah', 'nam', 1, 'ナホム'], [35, 'Hab', 'hab', 1, 'ハバクク'],
  [36, 'Zeph', 'zep', 1, 'ゼパニヤ'], [37, 'Hag', 'hag', 1, 'ハガイ'], [38, 'Zech', 'zec', 1, 'ゼカリヤ'], [39, 'Mal', 'mal', 1, 'マラキ'],
  [40, 'Matt', 'mat', 2, 'マタイ'], [41, 'Mark', 'mrk', 2, 'マルコ'], [42, 'Luke', 'luk', 2, 'ルカ'], [43, 'John', 'jhn', 2, 'ヨハネ'], [44, 'Acts', 'act', 2, '使徒'],
  [45, 'Rom', 'rom', 2, 'ローマ'], [46, '1Cor', '1co', 2, 'Ⅰコリント'], [47, '2Cor', '2co', 2, 'Ⅱコリント'], [48, 'Gal', 'gal', 2, 'ガラテヤ'], [49, 'Eph', 'eph', 2, 'エペソ'],
  [50, 'Phil', 'php', 2, 'ピリピ'], [51, 'Col', 'col', 2, 'コロサイ'], [52, '1Thess', '1th', 2, 'Ⅰテサロニケ'], [53, '2Thess', '2th', 2, 'Ⅱテサロニケ'], [54, '1Tim', '1ti', 2, 'Ⅰテモテ'],
  [55, '2Tim', '2ti', 2, 'Ⅱテモテ'], [56, 'Titus', 'tit', 2, 'テトス'], [57, 'Phlm', 'phm', 2, 'ピレモン'], [58, 'Heb', 'heb', 2, 'ヘブル'], [59, 'Jas', 'jas', 2, 'ヤコブ'],
  [60, '1Pet', '1pe', 2, 'Ⅰペテロ'], [61, '2Pet', '2pe', 2, 'Ⅱペテロ'], [62, '1John', '1jn', 2, 'Ⅰヨハネ'], [63, '2John', '2jn', 2, 'Ⅱヨハネ'], [64, '3John', '3jn', 2, 'Ⅲヨハネ'],
  [65, 'Jude', 'jud', 2, 'ユダ'], [66, 'Rev', 'rev', 2, '黙示録'],
];

if (!existsSync(src)) {
  console.log('取得:', SOURCE);
  const res = await fetch(SOURCE);
  if (!res.ok) { console.error(`取得できません（${res.status}）`); process.exit(1); }
  mkdirSync(dirname(src), { recursive: true });
  writeFileSync(src, Buffer.from(await res.arrayBuffer()));
}
const xml = readFileSync(src, 'utf8');
// 本文の <w gloss="よみ">漢字</w> は漢字だけ残す（読みは import-bible.mjs のルビの扱いと同じく捨てる）
const plain = (s) => s.replace(/<w\b[^>]*>([\s\S]*?)<\/w>/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

rmSync(out, { force: true });
const db = new DatabaseSync(out);
db.exec(`CREATE TABLE BOOKS (book_id INTEGER PRIMARY KEY, book_name TEXT, testament INTEGER, book_name_ja TEXT, book_name_ja_short TEXT);
CREATE TABLE VERSES (book_id INTEGER, chapter INTEGER, verse INTEGER, main_text TEXT, PRIMARY KEY (book_id, chapter, verse));`);
const addBook = db.prepare('INSERT INTO BOOKS VALUES (?, ?, ?, ?, ?)');
const addVerse = db.prepare('INSERT OR REPLACE INTO VERSES VALUES (?, ?, ?, ?)');
let verses = 0;
db.exec('BEGIN');
for (const [id, osis, code, testament, short] of BOOKS) {
  const m = xml.match(new RegExp(`<div type="book" osisID="${osis}">([\\s\\S]*?)(?=<div type="book"|</div>\\s*</div>\\s*</osisText>|$)`));
  if (!m) { console.error(`${osis} が見つかりません`); process.exit(1); }
  const name = plain((m[1].match(/<title type="main">([\s\S]*?)<\/title>/) || [])[1] || '');
  addBook.run(id, code, testament, name, short);
  // 節は 2 通りの書き方がある: <verse osisID>…</verse>（散文）と、詩の行（<l>）をまたぐ <verse sID/>…<verse eID/>
  for (const v of m[1].matchAll(new RegExp(`<verse osisID="${osis}\\.(\\d+)\\.(\\d+)">([\\s\\S]*?)</verse>`, 'g'))) {
    addVerse.run(id, +v[1], +v[2], plain(v[3])); verses++;
  }
  for (const v of m[1].matchAll(new RegExp(`<verse sID="${osis}\\.(\\d+)\\.(\\d+)"[^>]*/>([\\s\\S]*?)<verse eID="${osis}\\.\\1\\.\\2"/>`, 'g'))) {
    addVerse.run(id, +v[1], +v[2], plain(v[3])); verses++;
  }
}
db.exec('COMMIT');
db.close();
console.log(`wrote ${out}（${BOOKS.length} 書、${verses} 節）`);
