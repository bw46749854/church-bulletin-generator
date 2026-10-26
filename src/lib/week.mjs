// 週データの補助：新しい週の初期値（前週の引き継ぎ欄＋前週の「次週欄」）、日付計算
export function nthSunday(d) { return Math.ceil(d.getDate() / 7); }
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function isSunday(s) { return parseDate(s).getDay() === 0; }

/** 次週欄の休止を本欄へ：true（休止）・false（臨時に開く）はそのまま、それ以外は null（暦どおり） */
const carrySuspended = (x) => (x && typeof x.suspended === 'boolean') ? x.suspended : null;
/** date が prev のちょうど翌週（7 日後）か。次週欄の休止は翌週のための設定なので、翌週のときだけ当日の休止に入れる（ARCHITECTURE.md §3.3） */
function isNextWeekOf(prev, date) {
  if (!prev || !/^\d{4}-\d{2}-\d{2}$/.test(prev.date || '')) return false;
  const d = parseDate(prev.date); d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === date;
}

/** ① 新しい週として：もとにする週 prev をもとに date の週の初期値を作る（毎週入力欄は空。ARCHITECTURE.md §3.3） */
export function newWeekFrom(prev, date) {
  const nw = (prev && prev.next_week) || {};
  const p = prev || {};
  const next = isNextWeekOf(prev, date);
  const m = p.morning || {}, a = p.afternoon || {}, w = p.wednesday || {}, an = p.announcements || {}, lw = p.last_week || {};
  return {
    date,
    service_name: p.service_name || '主日礼拝',
    reception: p.reception || null,
    morning: {
      presider: nw.morning?.presider ?? null,
      preacher: nw.morning?.preacher ?? m.preacher ?? null,
      organist: null,
      prayer: nw.morning?.prayer ?? null,
      offering: m.offering ?? null,
      offering_prayer: m.offering_prayer || 'preacher',
      benediction: m.benediction || 'preacher',
      call_to_worship: '',
      hymns: [null, null, null],
      responsive_reading: null,
      scripture: { ref: nw.morning?.scripture ?? '', page: '' },
      sermon_title: nw.morning?.sermon_title ?? '', sermon_title_break: nw.morning?.sermon_title_break ?? null,   // 紙面の改行位置（1 行目の字数）。題と一緒に写す（ARCHITECTURE.md §3.1）
      extras: []
    },
    schedule: p.schedule || { choir: '休', worship: '休', youth: '休' },
    sunday_school: {
      scripture: nw.sunday_school?.scripture ?? '', title: nw.sunday_school?.title ?? '', title_break: nw.sunday_school?.title_break ?? null,
      presider: nw.sunday_school?.presider ?? null, speaker: nw.sunday_school?.speaker ?? null,
      suspended: next ? carrySuspended(nw.sunday_school) : null   // 本日のジョイジョイサンデー（チェックは無い。翌週のときだけ次週欄の値を受け取る）
    },
    afternoon: {
      presider_preacher: nw.afternoon?.preacher ?? a.presider_preacher ?? null,   // 次週欄の説教者（無ければ前週の司会・説教）
      organist: null, usher: null, usher_shown: false,   // 案内は毎週非表示から
      call_to_worship: '', worship_songs: [],
      scripture: nw.afternoon?.scripture ?? '', sermon_title: nw.afternoon?.sermon_title ?? '', sermon_title_break: nw.afternoon?.sermon_title_break ?? null, hymn: null,
      suspended: next ? carrySuspended(nw.afternoon) : null,   // 翌週のときだけ、次週欄の休止・臨時に開くを引き継ぐ。それ以外は空（暦どおり。ARCHITECTURE.md §16.1）
      next_date: null                         // 次回の日付の手直しはその週だけ
    },
    next_week: {
      morning: { presider: null, prayer: null, scripture: '', sermon_title: '', sermon_title_break: null, preacher: m.preacher ?? null },
      afternoon: { scripture: '', sermon_title: '', sermon_title_break: null, preacher: a.presider_preacher ?? null },
      sunday_school: { presider: null, scripture: '', title: '', title_break: null, speaker: null },
      youth: { suspended: nw.youth?.suspended ?? true, scripture: '', title: '', title_break: null }   // 中高科は当分休会。休止の状態だけ引き継ぐ
    },
    wednesday: {
      presider_preacher: w.presider_preacher ?? null, organist: w.organist ?? null,
      hymns: [null, null], scripture: { ref: '', page: '' }, sermon_title: '', sermon_title_break: null
    },
    announcements: { lead: an.lead || '', body: [], prayer_for_lead: an.prayer_for_lead || '', prayer_for: an.prayer_for || '' },
    last_week: {
      note: lw.note || '',
      attendance: { dawn: '', sunday_school: '', morning: '', afternoon: '', youth: '', wednesday: '' },
      offering: (lw.offering || []).map(o => ({ name: o.name, amount: '' }))
    }
  };
}

/**
 * ② 丸ごと複製：もとにする週 x の内容をすべて写して date の週を作る（ARCHITECTURE.md §3.3・§19）。
 * 写さない: 次回の午後礼拝の日付の手直し、x 当日の休止の設定（空＝暦どおり）。次週欄は ① と同じく空から。
 * x の次週欄で上書き（空の欄は上書きしない）: 担当者（主日の司会・祈祷・説教者／午後の説教者 → 司会・説教／JJS の司会・お話し）と
 * 聖書・説教題（主日の聖書・説教題／午後の聖書・説教題／JJS の聖書・題）。題は改行位置（*_break）と組で上書き。主日の聖書を上書きしたらページは空（次週欄にページは無い）
 * 休止は、date が x の翌週のときだけ x の次週欄の値を入れる（午後礼拝・JJS。① と同じ規則）
 */
export function copyWeekFrom(x, date) {
  const w = JSON.parse(JSON.stringify(x));
  w.date = date;
  if (w.afternoon) w.afternoon.next_date = null;
  for (const sec of [w.afternoon, w.wednesday, w.sunday_school]) if (sec) sec.suspended = null;
  if (isNextWeekOf(x, date)) {
    if (w.afternoon) w.afternoon.suspended = carrySuspended(x.next_week?.afternoon);
    if (w.sunday_school) w.sunday_school.suspended = carrySuspended(x.next_week?.sunday_school);
  }
  w.next_week = newWeekFrom(x, date).next_week;
  const nw = x.next_week || {};
  const filled = (p) => !!(p && (p.id || p.display));
  const put = (sec, key, p) => { if (filled(p)) { w[sec] ||= {}; w[sec][key] = JSON.parse(JSON.stringify(p)); } };
  put('morning', 'presider', nw.morning?.presider); put('morning', 'prayer', nw.morning?.prayer); put('morning', 'preacher', nw.morning?.preacher);
  put('afternoon', 'presider_preacher', nw.afternoon?.preacher);
  put('sunday_school', 'presider', nw.sunday_school?.presider); put('sunday_school', 'speaker', nw.sunday_school?.speaker);
  const text = (sec, key, v) => { if (typeof v === 'string' && v.trim()) { w[sec] ||= {}; w[sec][key] = v; } };
  if (typeof nw.morning?.scripture === 'string' && nw.morning.scripture.trim()) { w.morning ||= {}; w.morning.scripture = { ...(w.morning.scripture || {}), ref: nw.morning.scripture, page: '' }; }   // 古いページを残さない
  // 題は改行位置と組で上書きする（次週欄に改行位置が無ければ、X の古い改行位置を残さず空に）
  const title = (sec, key, from) => { const v = from?.[key]; if (typeof v === 'string' && v.trim()) { w[sec] ||= {}; w[sec][key] = v; w[sec][key + '_break'] = from[key + '_break'] ?? null; } };
  title('morning', 'sermon_title', nw.morning);
  text('afternoon', 'scripture', nw.afternoon?.scripture); title('afternoon', 'sermon_title', nw.afternoon);
  text('sunday_school', 'scripture', nw.sunday_school?.scripture); title('sunday_school', 'title', nw.sunday_school);
  return w;
}
