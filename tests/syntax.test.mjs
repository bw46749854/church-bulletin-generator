// 画面の部品（src/ui/）は試験から読み込まないので、書き間違い（同じ名前の二重の宣言など）は画面を開くまで分からない。
// node --check で文法だけ確かめる（2026-10-25: テンプレの管理画面で const の二重の宣言を出しかけた）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = resolve(import.meta.dirname, '../src/ui');
for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs'))) {
  test(`src/ui/${f} の文法`, () => {
    const r = spawnSync(process.execPath, ['--check', resolve(dir, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
}
