// 新しい週の作り方（src/lib/week.mjs）のうち、題の改行位置（*_break）の写し方。実行: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newWeekFrom, copyWeekFrom } from '../src/lib/week.mjs';

const prev = () => ({
  date: '2026-10-25',
  morning: { sermon_title: '前の週の題', sermon_title_break: 3 },
  afternoon: { sermon_title: '', sermon_title_break: null },
  sunday_school: { title: '前の週のお話', title_break: 2 },
  wednesday: { sermon_title: '悔い改めにふさわしい実を結びなさい', sermon_title_break: 10 },
  next_week: {
    morning: { sermon_title: '神の国とその義とをまず第一に求めなさい', sermon_title_break: 9 },
    afternoon: { sermon_title: 'あなたのみおしえは　私の喜びです', sermon_title_break: 10 },
    sunday_school: { title: 'ザアカイといちじく桑の木', title_break: 5 },
    youth: { suspended: true, title: '' },
  },
});

test('① 新しい週として: 次週欄の題と改行位置が組で入り、次週欄・水曜は改行位置も空から', () => {
  const w = newWeekFrom(prev(), '2026-11-01');
  assert.equal(w.morning.sermon_title, '神の国とその義とをまず第一に求めなさい');
  assert.equal(w.morning.sermon_title_break, 9);
  assert.equal(w.afternoon.sermon_title_break, 10);
  assert.equal(w.sunday_school.title, 'ザアカイといちじく桑の木');
  assert.equal(w.sunday_school.title_break, 5);
  assert.equal(w.wednesday.sermon_title_break, null);
  for (const k of ['morning', 'afternoon']) assert.equal(w.next_week[k].sermon_title_break, null);
  for (const k of ['sunday_school', 'youth']) assert.equal(w.next_week[k].title_break, null);
});

test('① 次週欄に改行位置が無い（古い週）ときは空', () => {
  const p = prev(); delete p.next_week.morning.sermon_title_break;
  assert.equal(newWeekFrom(p, '2026-11-01').morning.sermon_title_break, null);
});

test('② 丸ごと複製: 次週欄の題で上書きするときは改行位置も上書きし、X の古い改行位置を残さない', () => {
  const p = prev(); delete p.next_week.morning.sermon_title_break;   // 次週欄の主日の題は 1 行
  const w = copyWeekFrom(p, '2026-11-01');
  assert.equal(w.morning.sermon_title, '神の国とその義とをまず第一に求めなさい');
  assert.equal(w.morning.sermon_title_break, null);   // X の 3 が残ると別の題を変な位置で切る
  assert.equal(w.afternoon.sermon_title_break, 10);
  assert.equal(w.sunday_school.title_break, 5);
  assert.equal(w.wednesday.sermon_title_break, 10);   // 水曜は X をそのまま写す
});

test('② 次週欄の題が空なら、X の題と改行位置をそのまま残す', () => {
  const p = prev(); p.next_week.sunday_school.title = ''; p.next_week.sunday_school.title_break = null;
  const w = copyWeekFrom(p, '2026-11-01');
  assert.equal(w.sunday_school.title, '前の週のお話');
  assert.equal(w.sunday_school.title_break, 2);
});
