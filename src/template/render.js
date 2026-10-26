/* 週報レンダラ：JSON（週データ・設定・マスタ）→ DOM。レイアウトは bulletin.css、縮小は fit-policy に従う。 */
(function () {
  'use strict';

  // ---------- データ読み込み ----------
  function readJson(id) {
    const el = document.getElementById(id);
    const t = el && el.textContent.trim();
    return t ? JSON.parse(t) : null;
  }
  const week = readJson('data-week');
  const config = readJson('data-config');
  const peopleMaster = readJson('data-people');
  const hymns = readJson('data-hymns') || {};
  const readings = readJson('data-readings') || {};
  const prayerList = readJson('data-prayer') || { items: [] };
  const texts = readJson('data-texts');   // 据え置きの文（聖句・標語）。無い古いデータは週の verses を見る
  const fitPolicy = readJson('data-fit') || {};
  if (!week || !config) { window.__error = 'data missing'; return; }
  const opts = readJson('data-options') || {};
  if (opts.font && opts.font !== 'ipa') document.body.classList.add('font-' + opts.font);   // 既定は IPA P明朝。ipaex / biz は比較用

  // ---------- 日付 ----------
  const date = parseDate(week.date);
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function nthSunday(d) { return Math.ceil(d.getDate() / 7); }
  function bulletinNo(d) {
    const first = new Date(d.getFullYear(), 0, 1);
    while (first.getDay() !== 0) first.setDate(first.getDate() + 1);
    return Math.floor((d - first) / 86400000 / 7) + 1;
  }
  function fmtDot(d) { return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; }
  function fmtJp(d) { return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; }
  function fmtSlash(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }
  function fmtSlashY(d) { return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; }
  const rules = config.rules;
  const nth = nthSunday(date);
  // 休止（ARCHITECTURE.md §16.1）：suspended は 3 通り。空＝暦どおり／true＝休止（暦に関係なく休み）／false＝休止しない（暦に関係なく開く）
  const heldBy = (suspended, byCalendar) => suspended === true ? false : suspended === false ? true : byCalendar;
  const ssHeld = heldBy(week.sunday_school && week.sunday_school.suspended, rules.sunday_school_weeks.includes(nth));
  const nextSunday = addDays(date, 7);
  // 休会・休止（ARCHITECTURE.md §16）：暦で休みの週に加えて、週データの suspended で臨時に休止できる
  const afHeld = heldBy(week.afternoon && week.afternoon.suspended, rules.afternoon_weeks.includes(nth));
  const wedHeld = !(week.wednesday && week.wednesday.suspended);
  const nextAfS = week.next_week && week.next_week.afternoon ? week.next_week.afternoon.suspended : null;
  // 次回の午後礼拝：次の第 2・4 日曜。次週は次週欄の休止・臨時に開くに従う。手で直した日付（afternoon.next_date）があればそれ
  const afHeldOn = (d) => +d === +nextSunday ? heldBy(nextAfS, rules.afternoon_weeks.includes(nthSunday(d))) : rules.afternoon_weeks.includes(nthSunday(d));
  let nextAfternoon = addDays(date, 7);
  while (!afHeldOn(nextAfternoon)) nextAfternoon = addDays(nextAfternoon, 7);
  const nd = week.afternoon && /^\d{4}-\d{2}-\d{2}$/.test(week.afternoon.next_date || '') ? week.afternoon.next_date.split('-').map(Number) : null;
  if (nd) nextAfternoon = new Date(nd[0], nd[1] - 1, nd[2]);
  const wedDate = addDays(date, rules.wednesday_offset_days);

  // ---------- 表示ヘルパ ----------
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function disp(p) { return p ? (p.display || '') : ''; }
  function hymnText(n) {
    if (n == null || n === '') return '';
    const t = hymns[String(n)];
    return t ? `${n}（${t}）` : String(n);
  }
  function readingText(n) {
    if (n == null || n === '') return '';
    const t = readings[String(n)];
    return t ? `${n}（${t}）` : String(n);
  }
  function quoted(t) { return t ? `「${t}」` : ''; }
  // 題の改行位置（<題>_break ＝ 1 行目の字数。ARCHITECTURE.md §3.1）が使えれば [1 行目, 2 行目]。行の境目の空白は印字しない
  function titleLines(t, brk) {
    const cs = [...(t || '')];
    if (!Number.isInteger(brk) || brk < 1 || brk >= cs.length) return null;
    const a = cs.slice(0, brk).join('').replace(/\s+$/, ''), b = cs.slice(brk).join('').replace(/^\s+/, '');
    return a && b ? [a, b] : null;
  }
  // 改行位置のある題を 2 行にする（無ければ何もしない）。2 行目の頭は「の内側にそろえる（見えない「を置く）。縮小は title_2line
  function twoLines(row, t, brk) {
    const lines = titleLines(t, brk); if (!lines) return false;
    const v = row.querySelector('.val'), txt = el('span', 'txt'), l2 = el('span', 'l2');
    l2.append(el('span', 'ind', '「'), lines[1] + '」');
    txt.append(el('span', 'l1', '「' + lines[0]), l2);
    v.replaceChildren(txt); v.classList.add('two'); v.dataset.fit = 'title_2line'; row.classList.add('two');
    return true;
  }
  // 題の欄（8 か所）：題を入れてよい幅はどこも同じ（fit-policy の _title_width_px＝一番狭い次週欄・水曜の幅）、1 行の縮め方も同じ（title）。
  // 欄の並び（項目名・題の欄・名前の欄の位置と幅）は変えず、縮小の判定だけこの幅で行う（ARCHITECTURE.md §5.2）。label は溢れの知らせに使う
  const TITLE_PX = fitPolicy._title_width_px || null;
  function markTitle(row, label) { const v = row.querySelector('.val'); v.dataset.fit = 'title'; if (TITLE_PX) v.dataset.fitWidth = TITLE_PX; v.dataset.fitLabel = label; return row; }
  // 枠の見出し（1行）に縮小対象の印を付ける
  function fitTitle(span) { const t = span.textContent; span.textContent = ''; span.append(el('span', 'txt', t)); span.dataset.fit = 'box_title'; span.style.display = 'inline-block'; span.style.maxWidth = '100%'; }

  function roleSlot(v) {
    if (v === 'presider') return '司会者';
    if (v === 'label_preacher') return '説教者';
    if (!v || v === 'preacher') return disp(week.morning.preacher);
    return String(v);   // 直接入力の文字
  }
  // 役割 → 表示名
  function roleName(section, role) {
    const m = week.morning;
    switch (role) {
      case 'prayer': return disp(m.prayer);
      case 'preacher': return disp(m.preacher);
      case 'offering': return disp(m.offering);
      // 献金後の祈祷・祝祷：値は 'preacher'（説教者の氏名）| 'label_preacher'（「説教者」と印字）| 'presider'（「司会者」と印字）
      case 'offering_prayer': return roleSlot(m.offering_prayer);
      case 'benediction': return roleSlot(m.benediction);
      case 'pastor': { const ps = peopleMaster.people || []; const p = ps.find(x => (x.flags || []).includes('pastor')) || ps.find(x => x.title === '牧師'); return p ? p.name + p.title : disp(m.preacher); }
      case 'presider_preacher': return disp(section.presider_preacher);
      default: return '';
    }
  }

  // 式順の1行
  function programRow(label, val, rgt, opts) {
    const row = el('div', 'prow');
    const l = el('span', 'lbl dist', label);
    const v = el('span', 'val'); v.append(el('span', 'txt', val || ''));
    const r = el('span', 'rgt dist', rgt || '');
    if (opts && opts.fit) v.dataset.fit = opts.fit;
    if (rgt) { r.dataset.fit = 'person_name'; row.append(l, v, r); }
    else { v.classList.add('wide'); row.append(l, v); }
    return row;
  }
  function contentOf(section, key, held) {
    if (!key) return '';
    if (held === false) return '';
    if (key.startsWith('hymn:')) return hymnText((section.hymns || [])[Number(key.slice(5))]);
    if (key === 'hymn') return hymnText(section.hymn);
    if (key === 'responsive_reading') return readingText(section.responsive_reading);
    if (key === 'scripture') return typeof section.scripture === 'string' ? section.scripture : (section.scripture ? (section.scripture.ref || '') : '');
    if (key === 'sermon_title') return quoted(section.sermon_title);
    if (key === 'call_to_worship') return section.call_to_worship || '';
    if (key === 'doxology') return `${config.doxology.number}（${config.doxology.title}）`;
    if (key === 'worship_songs') return null; // 特別扱い
    return '';
  }
  function rightOf(section, r, held) {
    if (!r) return '';
    if (r.startsWith('role:')) return held === false ? '' : roleName(section, r.slice(5));   // 休みの週は人の名前だけ空欄
    return r;   // 「黙想」「司会者」「一同」など決まった文字は休みの週も残す（見本 8/2 に合わせる）
  }
  function fitKeyFor(key) {
    if (!key) return null;
    if (key.startsWith('hymn') || key === 'doxology') return 'hymn_title';
    if (key === 'sermon_title') return 'title';
    if (key === 'scripture' || key === 'call_to_worship') return 'scripture_ref';
    return null;
  }
  const STD = /^(call_to_worship|hymn:\d+|hymn|responsive_reading|scripture|sermon_title|doxology|worship_songs)$/;
  // 週データに編集済みの式順（<section>.program）があればそれ、無ければ config の式順
  function programItems(section, cfgItems) {
    return (Array.isArray(section.program) && section.program.length) ? section.program : cfgItems;
  }
  // 午後礼拝・水曜祈祷会の式順。標準の項目は content で、その他は {label, text, right} の自由文字
  function renderProgram(wrap, section, items, held, songSlots, titleLabel) {
    const start = wrap.childElementCount;
    for (const it of items) {
      if (it.content === 'worship_songs') {   // ワーシップ曲：入力した曲数だけ行を出す（休みの週は骨組みとして枠数ぶん空行）
        const songs = held ? (section.worship_songs || []).filter(Boolean) : [];
        const n = held ? Math.max(1, songs.length) : songSlots;
        for (let i = 0; i < n; i++) wrap.append(programRow(i === 0 ? it.label : '', songs[i] ? quoted(songs[i]) : '', i === 0 ? rightOf(section, it.right, held) : '', { fit: 'song_title' }));
        continue;
      }
      if (it.content && STD.test(it.content)) {
        const row = programRow(it.label, contentOf(section, it.content, held), rightOf(section, it.right, held), { fit: fitKeyFor(it.content) });
        if (it.content === 'sermon_title') { markTitle(row, titleLabel); if (held !== false) twoLines(row, section.sermon_title, section.sermon_title_break); }
        wrap.append(row);
        if (it.content === 'scripture' && section.scripture && section.scripture.page) wrap.append(programRow('', held === false ? '' : section.scripture.page, ''));
      } else {
        const val = it.text != null ? it.text : (it.content || '');
        wrap.append(programRow(it.label || '', held === false ? '' : val, rightOf(section, it.right, held), { fit: 'person_name' }));
      }
    }
    if (held === false) {   // 休み・休止：前奏の行の内容の欄に「休会」（前奏が無ければ最初の行）
      const rows = [...wrap.children].slice(start);
      const row = rows.find(r => r.querySelector('.lbl').textContent.replace(/\s/g, '') === '前奏') || rows[0];
      if (row) { const v = row.querySelector('.val'); v.classList.add('kyukai'); v.querySelector('.txt').textContent = '休会'; }
    }
  }

  // ---------- 主日礼拝 ----------
  (function renderMorning() {
    const m = week.morning;
    $('m-title').textContent = week.service_name || '主日礼拝';
    $('m-date').textContent = fmtDot(date) + '.';
    $('m-time').textContent = config.morning.time_label;
    $('m-organist').textContent = '奏楽 ： ' + disp(m.organist);
    $('m-presider').textContent = disp(m.presider);
    $('m-preacher').textContent = disp(m.preacher);

    // 式順：週データに編集済みの式順（morning.program）があればそれ、無ければ config の式順＋追加項目
    const presets = config.morning.extras_presets;
    let items;
    if (Array.isArray(m.program) && m.program.length) items = m.program;
    else {
      items = config.morning.program.map(x => Object.assign({}, x));
      for (const ex of (m.extras || [])) {
        const preset = presets[ex.preset] || {};
        const after = ex.after || preset.after;
        const idx = items.findIndex(x => x.content === after || x.label === after);
        items.splice(idx + 1, 0, Object.assign({}, ex));
      }
    }
    const wrap = $('m-program');
    for (const it of items) {
      let label = it.label, val, fit, right;
      if (it.preset) {                                   // プリセット（聖餐式＝賛美と同じ、○○式＝対象者）
        const p = presets[it.preset] || {};
        label = it.preset;
        if (p.content === 'param:hymn') { val = hymnText(it.hymn); fit = 'hymn_title'; }
        else if (p.content === 'param:person') { val = it.person || ''; fit = 'person_name'; }
        else val = '';
        right = rightOf(m, it.right || p.right);
      } else if (it.content && /^(call_to_worship|hymn:\d+|responsive_reading|scripture|sermon_title|doxology)$/.test(it.content)) {   // 標準の項目
        val = contentOf(m, it.content); fit = fitKeyFor(it.content); right = rightOf(m, it.right);
      } else {                                           // その他（自由文字。旧形式の content 文字列も）
        val = it.text != null ? it.text : (it.content || ''); fit = 'person_name'; right = rightOf(m, it.right);
      }
      const row = programRow(label || '', val, right, { fit });
      if (it.content === 'sermon_title') { markTitle(row, '主日の説教題'); twoLines(row, m.sermon_title, m.sermon_title_break); }
      wrap.append(row);
      if (it.content === 'scripture' && m.scripture && m.scripture.page) wrap.append(programRow('', m.scripture.page, ''));
    }
    // 表紙聖句
    const v = $('m-verse');
    for (const line of (texts && texts.cover_verse) || (week.verses && week.verses.cover) || []) v.append(el('div', null, line));
  })();

  // ---------- 本日の予定 ----------
  (function renderSchedule() {
    const s = config.schedule;
    $('s-title').textContent = s.title.replace('{day}', date.getDate()); fitTitle($('s-title'));
    const rows = $('s-rows');
    for (const r of s.rows) {
      let time = r.time || '';
      if (r.time_rule === 'sunday_school') time = ssHeld ? s.sunday_school_time : '休';
      else if (r.time_rule === 'afternoon') time = afHeld ? s.afternoon_time : '休';
      else if (r.time_rule === 'carry') time = (week.schedule && week.schedule[r.key]) || '休';
      const row = el('div', 'srow' + (r.label.length >= 5 ? ' small' : ''));
      row.append(el('span', 'c1', r.label), el('span', 'c2', time), el('span', 'c3', r.floor));
      rows.append(row);
    }
  })();

  // ---------- ジョイジョイサンデー / 中高科 ----------
  (function renderSundaySchool() {
    const ss = week.sunday_school || {};
    $('j-title').textContent = config.sunday_school.title;
    const jr = $('j-rows');
    const mrow = (lbl, val) => { const r = el('div', 'mrow'); const v = el('span', 'val'); v.dataset.fit = 'nextweek_val'; v.append(el('span', 'txt', val || '')); r.append(el('span', 'lbl dist', lbl), v); return r; };
    jr.append(mrow('司会', ssHeld ? disp(ss.presider) : ''));
    jr.append(mrow('聖書', ss.scripture || ''));
    const jt = markTitle(mrow('お話', quoted(ss.title)), '本日の JJS の題'); if (twoLines(jt, ss.title, ss.title_break)) $('jjs').classList.add('two'); jr.append(jt);
    jr.append(mrow('', ssHeld ? disp(ss.speaker) : ''));
    $('y-title').textContent = config.sunday_school.youth_title;
    const yr = $('y-rows');
    yr.append(mrow('聖書', ss.scripture || ''));
    const yt = markTitle(mrow('お話し', quoted(ss.title)), '本日の中高科の題'); if (twoLines(yt, ss.title, ss.title_break)) $('youth').classList.add('two'); yr.append(yt);
  })();

  // ---------- 使徒信条 ----------
  $('c-title').textContent = config.apostles_creed.title;
  // 1 要素＝紙面の 1 行（原本の改行のまま）。最後の行以外は両端揃え、はみ出す行は縮小（squeeze）で 1 行に収める
  config.apostles_creed.lines.forEach((t, i, all) => {
    const line = el('div', 'line' + (i === all.length - 1 ? ' last' : ''));
    line.dataset.fit = 'creed_line'; line.append(el('span', 'txt', t));
    $('c-body').append(line);
  });
  $('c-amen').textContent = config.apostles_creed.amen;

  // ---------- 午後礼拝 ----------
  (function renderAfternoon() {
    const a = week.afternoon || {};
    $('a-title').textContent = afHeld ? '午後礼拝' : `午後礼拝（次回は${fmtSlash(nextAfternoon)}）`;
    $('a-time').textContent = config.afternoon.time_label;
    $('a-presider').textContent = afHeld ? disp(a.presider_preacher) : '';
    $('a-organist').textContent = afHeld ? disp(a.organist) : '';
    $('a-usher').textContent = afHeld ? disp(a.usher) : '';
    // 案内は担当者がいる週だけ 3 行目に出し、式順を 1 行分下げる（担当者が空なら印刷しない）
    const usher = !!$('a-usher').textContent;
    $('a-usher-row').hidden = !usher; $('afternoon').classList.toggle('with-usher', usher);
    renderProgram($('a-program'), a, programItems(a, config.afternoon.program), afHeld, config.afternoon.worship_song_slots, '午後の説教題');
  })();

  // ---------- 水曜祈祷会 ----------
  (function renderWednesday() {
    const w = week.wednesday || {};
    $('w-title').textContent = config.wednesday.title;
    $('w-date').textContent = fmtDot(wedDate);
    $('w-time').textContent = config.wednesday.time_label;
    $('w-presider').textContent = wedHeld ? disp(w.presider_preacher) : '';
    $('w-organist').textContent = wedHeld ? disp(w.organist) : '';
    renderProgram($('w-program'), w, programItems(w, config.wednesday.program), wedHeld ? undefined : false, 0, '水曜の説教題');
  })();

  // ---------- 次週奉仕予定 ----------
  (function renderNextWeek() {
    const n = week.next_week || {};
    const c = config.next_week;
    $('n-title').textContent = `次週（${fmtSlashY(nextSunday)}）奉仕予定`; fitTitle($('n-title'));
    const body = $('n-body');
    const sub = (text, cls, note) => {
      const d = el('div', 'sub ' + (cls || ''));
      const s = el('span', 'ul', text); d.append(s);
      if (note) { const sm = el('small', null, note); s.append(sm); }
      body.append(d);
    };
    const nrow = (lbl, val, fit) => { const r = el('div', 'nrow'); const v = el('span', 'val'); v.dataset.fit = fit || 'nextweek_val'; v.append(el('span', 'txt', val || '')); r.append(el('span', 'lbl dist', lbl), v); body.append(r); return r; };
    body.dataset.fit = 'nextweek_body';   // 2 行の題で収まらないときは、区切りの空き → 行送りの順に詰める
    const gap = (cls) => body.append(el('div', 'gap ' + (cls || '')));

    const nm = n.morning || {};
    gap('g0');
    sub(c.morning_title, '', c.morning_note);
    nrow('司会', disp(nm.presider));
    nrow('祈祷', disp(nm.prayer));
    nrow('聖書', nm.scripture || '');
    twoLines(markTitle(nrow('説教', quoted(nm.sermon_title)), '次週の主日の説教題'), nm.sermon_title, nm.sermon_title_break);
    nrow('', disp(nm.preacher));
    gap('g1');

    const na = n.afternoon || {};
    const nextAfHeld = heldBy(na.suspended, rules.afternoon_weeks.includes(nthSunday(nextSunday)));
    sub(c.afternoon_title);
    nrow('聖書', nextAfHeld ? (na.scripture || '') : '休会');   // 休会は 1 行目（§16.3）
    const naT = markTitle(nrow('説教', nextAfHeld ? quoted(na.sermon_title) : ''), '次週の午後の説教題'); if (nextAfHeld) twoLines(naT, na.sermon_title, na.sermon_title_break);
    nrow('', nextAfHeld ? disp(na.preacher) : '');
    gap('g2');

    const ns = n.sunday_school || {};
    const nextSsHeld = heldBy(ns.suspended, rules.sunday_school_weeks.includes(nthSunday(nextSunday)));
    sub(c.sunday_school_title, 'small');
    nrow('司会', nextSsHeld ? disp(ns.presider) : '休会');   // 休会は 1 行目（§16.3）
    nrow('聖書', nextSsHeld ? (ns.scripture || '') : '');
    const nsT = markTitle(nrow('お話し', nextSsHeld ? quoted(ns.title) : ''), '次週の JJS の題'); if (nextSsHeld) twoLines(nsT, ns.title, ns.title_break);
    nrow('', nextSsHeld ? disp(ns.speaker) : '');
    gap('g3');

    const ny = n.youth || {};
    const youthHeld = ny.suspended === false;   // 中高科は当分休会（未設定＝休会）。再開したら suspended: false と聖書・お話し
    sub(c.youth_title);
    nrow('聖書', youthHeld ? (ny.scripture || '') : '休会');
    const nyT = markTitle(nrow('お話し', youthHeld ? quoted(ny.title) : ''), '次週の中高科の題'); if (youthHeld) twoLines(nyT, ny.title, ny.title_break);
  })();

  // ---------- 覚えて祈りましょう ----------
  (function renderPrayer() {
    $('p-title').textContent = config.prayer_list_title;
    const ol = $('p-list');
    prayerList.items.forEach((t, i) => {
      const li = el('li');
      li.append(el('span', 'n', `${i + 1}.`), el('span', 't', t));
      ol.append(li);
    });
  })();

  // ---------- 報告 ----------
  (function renderAnnouncements() {
    const an = week.announcements || {};
    $('an-title').textContent = config.announcements_title;
    const items = [];
    if (an.lead) items.push(an.lead);
    for (const b of (an.body || [])) items.push(b);
    if (an.prayer_for_lead || an.prayer_for) items.push([an.prayer_for_lead, an.prayer_for].filter(Boolean).join('\n'));
    const wrap = $('an-items');
    items.forEach((t, i) => {
      const d = el('div', 'item');
      d.append(el('span', 'n', `${i + 1}.`), el('span', 't', t));
      wrap.append(d);
    });
    $('an-contact').textContent = ''; const ct = el('span', 'txt', config.church.pastor_contact); $('an-contact').append(ct); $('an-contact').dataset.fit = 'contact';
    $('lw-title').textContent = config.last_week.title;
    $('lw-note').textContent = (week.last_week && week.last_week.note) || '';
  })();

  // ---------- 先週の報告（表） ----------
  (function renderLastWeek() {
    const lw = week.last_week || {};
    const cfg = config.last_week;
    const tb = $('lw-rows');
    const tr = el('tr');
    for (const h of cfg.columns) tr.append(el('th', null, h));
    tb.append(tr);
    const off = (lw.offering || []);
    cfg.attendance_rows.forEach((r, i) => {
      const row = el('tr');
      const att = lw.attendance ? lw.attendance[r.key] : '';
      const o = off[i] || { name: '', amount: '' };
      const amt = (o.amount === '' || o.amount == null) ? '' : Number(o.amount).toLocaleString('ja-JP');
      row.append(el('td', null, r.label), el('td', null, r.time), el('td', null, att == null ? '' : String(att)),
                 el('td', null, o.name || ''), el('td', 'amt', amt));
      tb.append(row);
    });
  })();

  // ---------- 表紙 ----------
  (function renderCover() {
    const ch = config.church;
    $('cv-date').textContent = fmtJp(date);
    $('cv-no').textContent = `NO.${bulletinNo(date)}`;
    $('cv-title').textContent = config.bulletin_title;
    const motto = (texts && texts.motto) || (week.verses && week.verses.motto) || [];
    $('cv-motto1').textContent = motto[0] || '';
    $('cv-motto2').textContent = motto[1] || '';
    const addr = $('cv-addr');
    addr.append(el('div', null, `${ch.postal} ${ch.address}`));
    addr.append(el('div', null, ch.tel_fax));
    addr.append(el('div', 'ul', ch.url));
    addr.append(el('div', 'ul', ch.email));
    addr.append(el('div', null, ch.bank_line1));
    addr.append(el('div', null, ch.bank_line2));
    addr.append(el('div', null, `（今日の受付・案内：${disp(week.reception)}）`));
  })();

  // ---------- 縮小（fit-policy） ----------
  // 溢れ判定：横は要素自身のはみ出し（倍率を加味）、縦は「収める先」（data-fit-within か、直近の .box）の内側下端との比較
  function overflows(e) {
    const inner = e.querySelector(':scope > .txt');
    if (inner) return inner.getBoundingClientRect().width > (e.dataset.fitWidth ? Number(e.dataset.fitWidth) : e.clientWidth) + 0.3;   // 1行の欄は横だけ見る（題は決めた幅で）
    if (e.scrollWidth > e.clientWidth + 0.5) return true;
    const withinSel = e.dataset.fitWithin;
    const box = withinSel ? document.querySelector(withinSel) : e.closest('.box');
    if (!box) return e.scrollHeight > e.clientHeight + 0.5;
    const limit = e.dataset.fitBottom ? document.querySelector(e.dataset.fitBottom).getBoundingClientRect().top
                                      : box.getBoundingClientRect().bottom - 1;
    // 自分より後ろの兄弟（アーメン等）も含めた下端。data-fit-bottom があるときは自分だけ（主日の式順は聖句の上まで）
    let last = e; if (!e.dataset.fitBottom) while (last.nextElementSibling && !last.nextElementSibling.classList.contains('foot')) last = last.nextElementSibling;
    return last.getBoundingClientRect().bottom > limit + 1.5;
  }
  function applyStep(e, step) {
    const [k, v] = step.split(':');
    if (k === 'font') e.style.fontSize = v;
    else if (k === 'line-height') e.style.lineHeight = v;
    else if (k === 'tracking') e.style.letterSpacing = v;
    else if (k === 'gaps') {   // 区切りの空き（.gap）を、はみ出した分だけ詰める（各 v まで。今の空きの大きさに比例して）
      const min = parseFloat(v) * 96 / 25.4, gs = [...e.querySelectorAll('.gap')];
      const over = e.getBoundingClientRect().bottom - (e.closest('.box').getBoundingClientRect().bottom - 1);
      const hs = gs.map(g => g.getBoundingClientRect().height), room = hs.reduce((a, h) => a + Math.max(0, h - min), 0);
      if (over > 0 && room > 0) { const take = Math.min(over, room); gs.forEach((g, i) => { g.style.height = `${hs[i] - take * Math.max(0, hs[i] - min) / room}px`; }); }
    }
    else if (k === 'squeeze') {   // 字間を詰めて、1 行にちょうど入れる（はみ出した幅を字数で割る。字間は各字の後ろに付く）
      const t = e.querySelector(':scope > .txt') || e;
      const over = t.getBoundingClientRect().width - e.clientWidth;
      if (over > 0) t.style.letterSpacing = `${-over / [...t.textContent].length}px`;
    }
    else if (k === 'scale') { const t = e.querySelector(':scope > .txt') || e; t.style.display = 'inline-block'; t.style.transformOrigin = (e.classList.contains('rgt') ? 'right' : 'left') + ' center'; t.style.transform = `scaleX(${v})`; }
  }
  function fitAll() {
    const marks = [];
    [...document.querySelectorAll('[data-fit]')].reverse().forEach(e => {   // 逆順＝子孫を先に。折り返した題を見てから親（次週奉仕予定）を詰める
      const pol = fitPolicy[e.dataset.fit];
      if (!pol || !e.textContent.trim()) return;
      let i = 0;
      while (overflows(e) && i < pol.steps.length) applyStep(e, pol.steps[i++]);
      if (overflows(e)) { e.classList.add('overflow-mark'); marks.push(e.dataset.fitLabel ? `${e.dataset.fit}:${e.dataset.fitLabel}` : e.dataset.fit); }   // 題は「規則:欄の名前」
    });
    return marks;
  }

  const finish = () => {
    window.__overflow = fitAll();
    window.__rendered = true;
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(finish); else finish();
})();
