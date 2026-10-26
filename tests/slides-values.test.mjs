// スライド生成の ① 値（src/lib/slides/values.mjs）。docs/pptx-template.md §5 の表どおりの値になるか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeValues, verseGroups } from '../src/lib/slides/values.mjs';
import { SERVICES, KINDS } from '../src/lib/slides/vocab.mjs';

const people = { people: [{ id: 'p1', name: '山田一郎', title: '牧師' }, { id: 'p2', name: '鈴木二郎', title: '長老' }, { id: 'p3', name: '佐藤三郎', title: '執事' }] };
const hymnsMaster = { 48: 'イエスきみは', 101: '主イエスのみ名こそ', 144: 'イエスわがために' };
const config = { rules: { wednesday_offset_days: 3 } };
const ROMANS = { 名: 'ローマ人への手紙', 略: 'ローマ' };
const BOOKS = {
  'ローマ3:23-24': { book: { id: 45, name: ROMANS.名, short: ROMANS.略, testament: 2 }, parsed: { chapter: 3, verse: 23, chapter2: null, verse2: 24 }, verses: [{ chapter: 3, verse: 23, text: 'すべての人は罪を犯して、' }, { chapter: 3, verse: 24, text: '神の栄光を受けることができず、' }] },
  '詩篇90': { book: { id: 19, name: '詩篇', short: '詩篇', testament: 1 }, parsed: { chapter: 90, verse: null }, verses: [{ chapter: 90, verse: 0, text: '神の人モーセの祈り' }, { chapter: 90, verse: 1, text: '主よ　代々にわたって' }] },
  '創世記1:1-2': { book: { id: 1, name: '創世記', short: '創世記', testament: 1 }, parsed: { chapter: 1, verse: 1, chapter2: null, verse2: 2 }, verses: [{ chapter: 1, verse: 1, text: 'あ'.repeat(50) }, { chapter: 1, verse: 2, text: 'い'.repeat(30) }] },
};
const lookup = async (ref) => BOOKS[ref] || null;
const week = {
  date: '2026-10-25',
  morning: {
    presider: { id: 'p2' }, preacher: { id: 'p1' }, prayer: { display: '田中四郎兄' }, offering: { id: 'p3' }, offering_prayer: 'presider',
    sermon_title: '柔和な者', call_to_worship: 'ローマ3:23-24', scripture: { ref: '詩篇90', page: '(2017旧約p.1012)' },
    hymns: [48, '', 101], responsive_reading: 16, program: [{ label: '説教', content: 'sermon_title' }],
  },
  afternoon: { presider_preacher: { id: 'p2' }, sermon_title: '午後の題', scripture: 'ローマ3:23-24', hymn: 144 },
  wednesday: { presider_preacher: { display: '佐藤三郎執事' }, sermon_title: '水曜の題', scripture: { ref: '創世記1:1-2', page: '' }, hymns: [48, null] },
  announcements: { lead: 'ようこそ', body: ['お知らせ一', '11月の予定\n1日 聖餐式'], prayer_for_lead: 'ご年配の方のために', prayer_for: '一さん、二さん' },
  slides: { sermon_refs: ['ローマ3:23-24', 'ない箇所1:1'], afternoon_refs: [], wednesday_refs: ['詩篇90'], other_refs: ['創世記1:1-2'] },
};
const make = (kind, extra = {}) => makeValues({ kind, week, people, hymnsMaster, config, lookup, ...extra });

test('どの礼拝も、値の表の名前は §5 の目印の表とそろっている', async () => {
  for (const kind of KINDS) {
    const v = await make(kind);
    assert.deepEqual(Object.keys(v.text).sort(), [...SERVICES[kind].text].sort(), `${kind} の目印`);
    assert.deepEqual(Object.keys(v.曲).sort(), [...SERVICES[kind].曲].sort(), `${kind} の曲`);
    assert.deepEqual(Object.keys(v.聖句).sort(), [...SERVICES[kind].聖句].sort(), `${kind} の聖句`);
  }
});
test('主日礼拝: 人は「名前 肩書」、役割の欄はその人。日付・聖書朗読の箇所・旧新・ページ', async () => {
  const v = await make('worship', { prepHymn: '101' });
  assert.equal(v.text.日付, '2026年 10月25日');
  assert.equal(v.text.司会, '鈴木二郎 長老'); assert.equal(v.text.説教者, '山田一郎 牧師'); assert.equal(v.text.祈祷, '田中四郎 兄'); assert.equal(v.text.献金, '佐藤三郎 執事');
  assert.equal(v.text.献金祈祷, '鈴木二郎 長老');   // presider → 司会の人
  assert.equal(v.text.祝祷, '山田一郎 牧師');       // 既定は説教者
  assert.deepEqual([v.text['聖書朗読.箇所'], v.text['聖書朗読.旧新'], v.text['聖書朗読.ページ']], ['詩篇90', '旧約', '1012']);
  assert.equal(v.text.招詞, 'ローマ3:23-24');
});
test('主日礼拝の曲: 準備賛美は画面の番号、空の番号は空、聖餐式は式順に無ければ「なし」', async () => {
  const v = await make('worship', { prepHymn: '101' });
  assert.deepEqual(v.曲.準備賛美, { 番号: 101, 曲名: '主イエスのみ名こそ' });
  assert.deepEqual(v.曲.賛美1, { 番号: 48, 曲名: 'イエスきみは' });
  assert.deepEqual(v.曲.賛美2, { 番号: null, 曲名: '' });
  assert.equal(v.曲.聖餐式, null);
  const w2 = { ...week, morning: { ...week.morning, program: [{ content: 'sermon_title' }, { preset: '聖餐式', hymn: 144 }] } };
  assert.deepEqual((await makeValues({ kind: 'worship', week: w2, people, hymnsMaster, config, lookup })).曲.聖餐式, { 番号: 144, 曲名: 'イエスわがために' });
  assert.deepEqual((await make('worship')).曲.準備賛美, { 番号: null, 曲名: '' });
});
test('報告は番号付き、祈りの対象は報告の数＋1。見出しも名前も空なら「なし」', async () => {
  const v = await make('worship');
  assert.deepEqual(v.報告, [{ 番号: 1, 本文: 'ようこそ' }, { 番号: 2, 本文: 'お知らせ一' }, { 番号: 3, 本文: '11月の予定\n1日 聖餐式' }]);
  assert.deepEqual(v.祈りの対象, { 番号: 4, 見出し: 'ご年配の方のために', 名前: '一さん、二さん' });
  const w2 = { ...week, announcements: { lead: 'ようこそ', body: [] } };
  assert.equal((await makeValues({ kind: 'worship', week: w2, people, hymnsMaster, config, lookup })).祈りの対象, null);
});
test('聖句は使うときに読む。読めない箇所は注意に出し、読めた分だけ入る', async () => {
  const v = await make('worship');
  const r = await v.聖句.引用聖句();
  assert.equal(r.groups.length, 1);   // ローマ3:23-24 の 2 節は 70 字以内なので 1 枚
  assert.deepEqual(r.groups[0], { 本文: 'すべての人は罪を犯して、神の栄光を受けることができず、', 書名: ROMANS.名, 章: '3章', 節: '23～24節' });
  assert.deepEqual(r.warnings, ['聖句を読めません: ない箇所1:1']);
});
test('聖句の分け方: 70 字を超えるなら分ける。詩篇の表題（0 節）は 1 枚に分け、節は空、章は「篇」', () => {
  assert.deepEqual(verseGroups(BOOKS['創世記1:1-2']).map(g => g.節), ['1節', '2節']);
  const ps = verseGroups(BOOKS['詩篇90']);
  assert.deepEqual(ps.map(g => [g.章, g.節]), [['90篇', ''], ['90篇', '1節']]);
});
test('午後・水曜: 説教者は司会・説教者の欄、水曜の日付は設定の日数だけ後、聖書朗読は書名から旧新', async () => {
  const a = await make('afternoon'), wd = await make('wednesday');
  assert.equal(a.text.説教者, '鈴木二郎 長老'); assert.equal(a.text.説教題, '午後の題'); assert.deepEqual(a.曲.賛美, { 番号: 144, 曲名: 'イエスわがために' });
  assert.deepEqual([a.text['聖書朗読.箇所'], a.text['聖書朗読.旧新'], a.text['聖書朗読.ページ']], ['ローマ3:23-24', '新約', '']);
  assert.equal(wd.text.日付, '2026年 10月28日'); assert.equal(wd.text.説教者, '佐藤三郎 執事');
  assert.deepEqual(wd.曲.賛美2, { 番号: null, 曲名: '' });
  assert.equal((await wd.聖句.引用聖句()).groups.length, 2);   // 詩篇90 の表題と 1 節
});
test('その他: 日付と引用聖句だけ', async () => {
  const v = await make('other');
  assert.deepEqual(Object.keys(v.text), ['日付']);
  assert.equal((await v.聖句.引用聖句()).groups.length, 2);   // 50 字＋30 字は 70 字を超えるので 2 枚
});
