// 入力画面の字幅表（src/ui/glyph-widths.json）が、紙面のフォントと一致しているか。食い違ったら node scripts/glyph-widths.mjs で作り直す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTable, FONT, OUT } from '../scripts/glyph-widths.mjs';

test('字幅表はフォント（IPA P明朝）から作ったものと同じ', () => {
  assert.deepEqual(JSON.parse(readFileSync(OUT, 'utf8')), JSON.parse(JSON.stringify(buildTable(readFileSync(FONT)))));
});
