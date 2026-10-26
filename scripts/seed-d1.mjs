// D1 にデータを投入・上書きする。ディレクトリなら中の *.json を、ファイルならそれ 1 つを、
// data/（または data/examples/）から見た相対パスをキー（church.json, masters/*.json, prayer-list.json, weeks/*.json）にして置く。
// 使い方: node scripts/seed-d1.mjs <dir|file> [--remote]
//   例: node scripts/seed-d1.mjs data/examples --remote      サンプル一式
//       node scripts/seed-d1.mjs data/church.json --remote   実物の church.json だけ差し替え
//   --remote が無ければ wrangler dev のローカル D1（.wrangler/state）に入る
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SCHEMA } from '../src/lib/store-d1.mjs';
const [dir, ...flags] = process.argv.slice(2);
if (!dir) { console.error('使い方: node scripts/seed-d1.mjs <dir|file> [--remote]'); process.exit(1); }
const remote = flags.includes('--remote');
const root = resolve(import.meta.dirname, '..');
const target = resolve(dir);
const SKIP = new Set(['examples', 'files', 'config.json']);   // Git 管理のものと素材は投入しない
const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); if (d === resolve(root, 'data') && SKIP.has(f)) return []; return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : []; });
// キーの基準: data/examples/ か data/ のうち target を含む方（data/masters を指定しても masters/ が付く）
const isDir = statSync(target).isDirectory();
const base = [resolve(root, 'data/examples'), resolve(root, 'data')].find(b => target === b || target.startsWith(b + '/'));
if (!base) { console.error('data/ の下のものだけです（キーを相対パスから決めるため）'); process.exit(1); }
const files = isDir ? walk(target) : [target];
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const now = new Date().toISOString();
const sql = [SCHEMA + ';'];
for (const file of files) {
  const key = relative(base, file).split('\\').join('/');
  sql.push(`INSERT INTO objects (key, body, updated_at) VALUES (${q(key)}, ${q(readFileSync(file, 'utf8'))}, ${q(now)}) ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at;`);
  console.log('put', key);
}
const tmp = resolve(import.meta.dirname, '../.wrangler/seed.sql');
writeFileSync(tmp, sql.join('\n'));
execFileSync('npx', ['wrangler', 'd1', 'execute', 'samplechurch-shuho', '--file', tmp, remote ? '--remote' : '--local', '-y'], { stdio: 'inherit' });
