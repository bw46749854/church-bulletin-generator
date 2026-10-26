// 使い方: node scripts/new-week.mjs 2026-09-20
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from '../src/lib/render.mjs';
import { newWeekFrom, isSunday } from '../src/lib/week.mjs';
const dir = resolve(root, 'data/weeks');
const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { console.error('使い方: node scripts/new-week.mjs YYYY-MM-DD'); process.exit(1); }
if (!isSunday(date)) console.warn(`注意: ${date} は日曜ではありません`);
const out = resolve(dir, `${date}.json`);
if (existsSync(out)) { console.error(`${out} は既にあります。`); process.exit(1); }
const files = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `${date}.json`).sort();
const prev = files.length ? JSON.parse(readFileSync(resolve(dir, files.at(-1)), 'utf8')) : null;
writeFileSync(out, JSON.stringify(newWeekFrom(prev, date), null, 2) + '\n');
console.log(`作成: ${out}（もと: ${files.at(-1) || 'なし'}）`);
