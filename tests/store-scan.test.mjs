// 置き場の scan・removeMany（src/lib/store-d1.mjs・store-fs.mjs）。ファイルの目次と控えの片付けが使う（docs/file-store.md）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { d1Store, SCHEMA } from '../src/lib/store-d1.mjs';
import { fsStore } from '../src/lib/store-fs.mjs';
import { d1Sqlite } from './helpers/d1-sqlite.mjs';

async function both() {
  const db = d1Sqlite(); db.exec(SCHEMA);
  const d1 = d1Store(db);
  const root = mkdtempSync(resolve(tmpdir(), 'shuho-store-')); const fs = fsStore(root);
  const rows = [['index/hymns/48.pptx.json', '{"sha256":"a"}', '2026-10-01T00:00:00.000Z'], ['index/template/部品/賛美.pptx.json', '{"sha256":"b"}', '2026-10-02T00:00:00.000Z'],
    ['history/index/hymns/48.pptx.json/2026-10-03T00:00:00.000Z', '{"sha256":"c"}', '2026-10-03T00:00:00.000Z'], ['history/masters/hymns.json/2026-10-20T00:00:00.000Z', '{}', '2026-10-20T00:00:00.000Z'], ['index_x.json', '{}', '2026-10-01T00:00:00.000Z']];
  for (const [k, b, t] of rows) {
    await db.prepare('INSERT INTO objects (key, body, updated_at) VALUES (?, ?, ?)').bind(k, b, t).run();
    await fs.put(k, b); utimesSync(resolve(root, 'data', k), new Date(t), new Date(t));
  }
  return { d1, fs };
}
test('scan: prefix の下の行を本文つきで（入れ子も。似た名前は入らない）。D1 と手元で同じ', async () => {
  const s = await both();
  for (const st of [s.d1, s.fs]) {
    assert.deepEqual((await st.scan('index/')).map(r => [r.key, r.body]), [['index/hymns/48.pptx.json', '{"sha256":"a"}'], ['index/template/部品/賛美.pptx.json', '{"sha256":"b"}']]);
  }
});
test('scan: before より前に書いた行を古い順に、limit で区切る', async () => {
  const s = await both();
  for (const st of [s.d1, s.fs]) {
    assert.deepEqual((await st.scan('history/', { before: '2026-10-10T00:00:00.000Z' })).map(r => r.key), ['history/index/hymns/48.pptx.json/2026-10-03T00:00:00.000Z']);
    assert.deepEqual((await st.scan('history/', { before: '2026-10-30T00:00:00.000Z', limit: 1 })).map(r => r.key), ['history/index/hymns/48.pptx.json/2026-10-03T00:00:00.000Z']);
  }
});
test('removeMany: まとめて消す（無いキーがあっても止まらない）', async () => {
  const s = await both();
  for (const st of [s.d1, s.fs]) {
    await st.removeMany(['index/hymns/48.pptx.json', 'index/無い.json']); await st.removeMany([]);
    assert.deepEqual((await st.scan('index/')).map(r => r.key), ['index/template/部品/賛美.pptx.json']);
  }
});
