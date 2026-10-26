// 聖書 SQLite（SKY2017.db: BOOKS / VERSES、本文はルビ付き HTML）を D1 samplechurch-bible に取り込む。
// 使い方: node scripts/import-bible.mjs <SKY2017.db> [--remote] [--books-only]
//   BOOKS: 元のまま。略称（book_name_ja_short）が NULL の書（〜記・詩篇・箴言・雅歌・哀歌）は「正式名をそのまま使う」という DB 作者の設計。
//          引く側で COALESCE(short, name) する。VERSES: html（元のまま）と text（ルビ・タグを外した素の文）の 2 列。
//   BOOK_ALIASES: 週報の書き方（申命記, ヨシュア, 詩篇, 詩編, Ⅰコリント, 1コリント, 第一コリント …）→ book_id。
//   --books-only: BOOKS と BOOK_ALIASES だけ作り直す（VERSES は触らない）
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripVerseHtml, bookAliases } from '../src/lib/bible.mjs';

const [dbPath, ...flags] = process.argv.slice(2);
if (!dbPath) { console.error('使い方: node scripts/import-bible.mjs <SKY2017.db> [--remote]'); process.exit(1); }
const remote = flags.includes('--remote');
const booksOnly = flags.includes('--books-only');
const src = new DatabaseSync(dbPath, { readOnly: true });
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const books = src.prepare('SELECT book_id, book_name, testament, book_name_ja, book_name_ja_short FROM BOOKS ORDER BY book_id').all();

const sql = [
  booksOnly ? 'DROP TABLE IF EXISTS BOOKS; DROP TABLE IF EXISTS BOOK_ALIASES;' : 'DROP TABLE IF EXISTS VERSES; DROP TABLE IF EXISTS BOOKS; DROP TABLE IF EXISTS BOOK_ALIASES;',
  'CREATE TABLE BOOKS (book_id INTEGER PRIMARY KEY, book_name TEXT, testament INTEGER, book_name_ja TEXT, book_name_ja_short TEXT);',
  'CREATE TABLE BOOK_ALIASES (alias TEXT PRIMARY KEY, book_id INTEGER);',
];
if (!booksOnly) sql.push('CREATE TABLE VERSES (book_id INTEGER, chapter INTEGER, verse INTEGER, text TEXT, html TEXT, PRIMARY KEY (book_id, chapter, verse));');
for (const b of books) sql.push(`INSERT INTO BOOKS VALUES (${b.book_id}, ${q(b.book_name)}, ${b.testament}, ${q(b.book_name_ja)}, ${b.book_name_ja_short == null ? 'NULL' : q(b.book_name_ja_short)});`);
for (const [alias, id] of Object.entries(bookAliases(books))) sql.push(`INSERT INTO BOOK_ALIASES VALUES (${q(alias)}, ${id});`);
let n = 0;
if (!booksOnly) for (const v of src.prepare('SELECT book_id, chapter, verse, main_text FROM VERSES ORDER BY book_id, chapter, verse').all()) {
  const text = stripVerseHtml(v.main_text);
  sql.push(`INSERT OR REPLACE INTO VERSES VALUES (${v.book_id}, ${v.chapter}, ${v.verse}, ${q(text)}, ${q(v.main_text)});`);
  n++;
}
mkdirSync(resolve(import.meta.dirname, '../.wrangler'), { recursive: true });
const tmp = resolve(import.meta.dirname, '../.wrangler/bible.sql');
writeFileSync(tmp, sql.join('\n'));
// ローカル dev サーバ用に同じ表を data/bible.sqlite にも作る（Git 外）
const localDb = resolve(import.meta.dirname, '../data/bible.sqlite');
{ const db = new DatabaseSync(localDb); db.exec(sql.join('\n')); db.close(); console.log('wrote', localDb); }
console.log(`books ${books.length}, aliases ${Object.keys(bookAliases(books)).length}, verses ${n}, sql ${(sql.join('\n').length / 1e6).toFixed(1)} MB`);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'samplechurch-bible', '--file', tmp, remote ? '--remote' : '--local', '-y'], { stdio: 'inherit' });
