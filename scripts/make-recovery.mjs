// recovery（障害対策）: このフォルダを「インターネット無しで週報を作れる一式」にする。教会 PC / 開発者 PC で実行。
//   1. コード一式をこのフォルダに置く（git clone、または開発者が git archive で作った zip を展開）
//   2. node scripts/make-recovery.mjs [--remote <正本の URL>] [--no-files]
//      → npm ci、Chromium をこのフォルダ内（browsers/）に取得、正本のデータを data/ に写す、start.bat / start.sh を書く
//   3. 以後は start.bat（Windows）/ start.sh をダブルクリック → ブラウザで http://localhost:8787/input-shuho/
//   データを最新にするには、つながっているときに start → 「同期」タブ →「同期状態を確認」→「取り込む」。または node scripts/pull.mjs --files
// 正本は本番（D1・KV）。ここは写し。ここで作った週は、復旧後に「同期」タブの「送る」で正本へ戻す。
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const remote = args[args.indexOf('--remote') + 1 || -1] || process.env.SHUHO_REMOTE || (existsSync(resolve(root, 'data/remote.json')) ? JSON.parse(readFileSync(resolve(root, 'data/remote.json'), 'utf8')).url : 'https://samplechurch-shuho.example.workers.dev');
const withFiles = !args.includes('--no-files');
const run = (cmd, env = {}) => { console.log('$', cmd); execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } }); };
const browsers = resolve(root, 'browsers');

mkdirSync(resolve(root, 'data'), { recursive: true });
writeFileSync(resolve(root, 'data/remote.json'), JSON.stringify({ url: remote }, null, 2) + '\n');
run('npm ci --omit=dev');
run('npx playwright install chromium', { PLAYWRIGHT_BROWSERS_PATH: browsers });   // Linux で依存ライブラリが無ければ: sudo npx playwright install-deps chromium
run(`node scripts/pull.mjs ${remote}${withFiles ? ' --files' : ''}`);

writeFileSync(resolve(root, 'start.bat'), `@echo off\r\ncd /d "%~dp0"\r\nset PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers\r\nstart "" http://localhost:8787/input-shuho/\r\nnode scripts\\dev-server.mjs 8787\r\npause\r\n`);
writeFileSync(resolve(root, 'start.sh'), `#!/bin/sh\ncd "$(dirname "$0")"\nexport PLAYWRIGHT_BROWSERS_PATH="$(pwd)/browsers"\n(sleep 2; xdg-open http://localhost:8787/input-shuho/ 2>/dev/null || open http://localhost:8787/input-shuho/ 2>/dev/null) &\nnode scripts/dev-server.mjs 8787\n`);
try { execSync('chmod +x start.sh', { cwd: root }); } catch { /* Windows */ }
writeFileSync(resolve(root, 'RECOVERY.md'), `# recovery（障害時の手元運用）

作成: ${new Date().toISOString()}　正本: ${remote}

## 使い方
1. start.bat（Windows）または start.sh を実行 → ブラウザで http://localhost:8787/input-shuho/ が開く
2. ふだんと同じ画面。保存先はこのフォルダの data/、PDF はこの PC の Chromium（本番と版が違うことがあり、折り返しが 1 字ずれ得る）
3. 復旧後: 「同期」タブ →「同期状態を確認」→ ここで作った週（手元にだけある）を「送る」で正本へ。正本の方が新しいものは「取り込む」

## データを最新にする（つながっているとき）
- 「同期」タブ →「正本の方が新しいものをすべて取り込む」
- または: node scripts/pull.mjs --files

## コードを更新する
開発者から新しい一式（git archive の zip）をもらって展開し、node scripts/make-recovery.mjs を再実行

## 正本はどこか
本番（Cloudflare の D1・KV）。ここは写し。両方で同じ週を直したら本番を優先し、手元の分は人が読み比べる。
`);
console.log('\nできました。start.bat / start.sh で起動します。');
