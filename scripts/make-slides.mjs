// 使い方: node scripts/make-slides.mjs <worship|afternoon|wednesday|other> data/weeks/2026-07-26.json [out/2026-07-26.pptx] [--prep 312]
// 週データ → 礼拝スライド pptx（ローカル: テンプレ一式・歌詞・交読文は data/index の目次 → data/files/blobs、聖書は data/bible.sqlite。docs/pptx-template.md・docs/file-store.md）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';
import { buildSlides } from '../src/lib/slides/build.mjs';
import { KINDS } from '../src/lib/slides/vocab.mjs';
import { lookupVerses } from '../src/lib/bible.mjs';
import { root, store, config } from '../src/lib/render.mjs';
import { fsFiles } from '../src/lib/store-fs.mjs';
import { createFileStore } from '../src/lib/file-store.mjs';

const args = process.argv.slice(2);
const prepIdx = args.indexOf('--prep');   // 準備賛美の番号（週データには無い）
const prepHymn = prepIdx >= 0 ? args.splice(prepIdx, 2)[1] : null;
const [kind, weekArg, outArg] = args;
if (!KINDS.includes(kind) || !weekArg) { console.error(`使い方: node scripts/make-slides.mjs <${KINDS.join('|')}> <週データの JSON> [出力] [--prep 番号]`); process.exit(2); }
const weekPath = resolve(weekArg);
const outPath = resolve(outArg || `out/${basename(weekPath, '.json')}${kind === 'worship' ? '' : '-' + kind}.pptx`);
const fileStore = createFileStore({ store, files: fsFiles(root) });
const getFile = async (key) => (await fileStore.get(key))?.bytes ?? null;
const db = new DatabaseSync(resolve(root, 'data/bible.sqlite'), { readOnly: true });
const bible = { all: async (sql, params) => db.prepare(sql).all(...params) };
const { pptx, warnings } = await buildSlides({
  kind, JSZip, getFile, week: JSON.parse(readFileSync(weekPath, 'utf8')), config: config(), prepHymn,
  people: JSON.parse(await store.get('masters/people.json')), hymnsMaster: JSON.parse(await store.get('masters/hymns.json')),
  lookup: (ref) => lookupVerses(bible, ref),
});
if (pptx) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, pptx); }
console.log(pptx ? `wrote ${outPath} ${(pptx.length / 1e6).toFixed(1)} MB` : '作るスライドがありません', warnings.length ? '\n注意: ' + warnings.join('\n      ') : '');
