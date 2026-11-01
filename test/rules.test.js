// Run with: node ewd-checker/test/rules.test.js
'use strict';

const assert = require('node:assert/strict');
const { check, plan, earliestStart, windowStarts, findRestRuns, makeClock, RULESETS, H, SLOTS_PER_DAY } = require('../rules.js');

const DAYS = 3;

// Build a record from [fromHour, toHour, 'W' | 'R'] entries; hours count from the start of day 1.
function record(entries) {
  const slots = new Array(DAYS * SLOTS_PER_DAY).fill(null);
  for (const [from, to, v] of entries) {
    for (let i = H(from); i < H(to); i++) slots[i] = v;
  }
  return slots;
}

function ids(result) {
  return result.breaches.map((b) => b.ruleId);
}

const tests = {
  'empty record has no breaches'() {
    assert.deepEqual(ids(check(record([]), 'standard-solo')), []);
  },

  '5¼ hours straight is allowed under standard hours'() {
    const r = check(record([[0, 6, 'R'], [6, 11.25, 'W'], [11.25, 24, 'R']]), 'standard-solo');
    assert.deepEqual(ids(r), []);
  },

  '5½ hours straight breaches the 5½-hour rule by 15 minutes'() {
    const r = check(record([[0, 6, 'R'], [6, 11.5, 'W'], [11.5, 24, 'R']]), 'standard-solo');
    assert.deepEqual(ids(r), ['std-5.5h']);
    assert.equal(r.breaches[0].amount, 1);
    assert.equal(r.breaches[0].severity, 'minor');
    assert.deepEqual(r.breaches[0].slots, [H(11.25)]);
  },

  'the same 6 hours straight is fine under BFM'() {
    const r = check(record([[0, 6, 'R'], [6, 12, 'W'], [12, 24, 'R']]), 'bfm-solo');
    assert.deepEqual(ids(r), []);
  },

  '12 hours work with breaks and a 7-hour rest is compliant'() {
    const day = (d) => [
      [d * 24 + 6, d * 24 + 11, 'W'], [d * 24 + 11, d * 24 + 11.5, 'R'],
      [d * 24 + 11.5, d * 24 + 16.5, 'W'], [d * 24 + 16.5, d * 24 + 17, 'R'],
      [d * 24 + 17, d * 24 + 19, 'W'], [d * 24 + 19, d * 24 + 30, 'R'],
    ];
    const r = check(record([[0, 6, 'R'], ...day(0), ...day(1), [54, 72, 'R']]), 'standard-solo');
    assert.deepEqual(ids(r), []);
  },

  '12¼ hours in 24 breaches the 24-hour rule'() {
    const r = check(record([
      [0, 6, 'R'], [6, 11, 'W'], [11, 11.5, 'R'], [11.5, 16.5, 'W'], [16.5, 17, 'R'],
      [17, 19.25, 'W'], [19.25, 48, 'R'],
    ]), 'standard-solo');
    assert.deepEqual(ids(r), ['std-24h']);
    assert.equal(r.breaches[0].amount, 1);
  },

  'a 6¾-hour rest is not a relevant rest break, so the next shift counts in the same 24 hours'() {
    const r = check(record([
      [0, 6, 'R'], [6, 11, 'W'], [11, 11.5, 'R'], [11.5, 16, 'W'], [16, 22.75, 'R'],
      [22.75, 27, 'W'], [27, 72, 'R'],
    ]), 'standard-solo');
    assert.deepEqual(r.breaches.map((b) => [b.kind, b.amount]).sort(), [['rest', 1], ['work', 7]]);
  },

  'rest requirements are not checked past the last recorded slot'() {
    const r = check(record([[0, 6, 'R'], [6, 11, 'W']]), 'standard-solo');
    assert.deepEqual(ids(r), []);
  },

  'Schedule 1 risk categories for the 24-hour work limit'() {
    // One 7-hour block then breaks, so only the 24-hour rule is breached.
    const day = (extra) => record([
      [0, 6, 'R'], [6, 11, 'W'], [11, 11.5, 'R'], [11.5, 16.5, 'W'], [16.5, 17, 'R'],
      [17, 19 + extra, 'W'], [19 + extra, 48, 'R'],
    ]);
    const risk = (extra) => check(day(extra), 'standard-solo').breaches.find((b) => b.ruleId === 'std-24h').severity;
    assert.equal(risk(0.75), 'minor');
    assert.equal(risk(1), 'substantial');
    assert.equal(risk(1.25), 'substantial');
    assert.equal(risk(1.5), 'severe');
    assert.equal(risk(1.75), 'critical');
  },

  'Schedule 1 risk categories for the 7-hour rest'() {
    const risk = (rest) => {
      const r = check(record([
        [0, 6, 'R'], [6, 11, 'W'], [11, 11.5, 'R'], [11.5, 16, 'W'], [16, 16 + rest, 'R'],
        [16 + rest, 20 + rest, 'W'], [20 + rest, 72, 'R'],
      ]), 'standard-solo');
      return r.breaches.find((b) => b.kind === 'rest').severity;
    };
    assert.equal(risk(6.25), 'minor');
    assert.equal(risk(6), 'substantial');
    assert.equal(risk(5.75), 'substantial');
    assert.equal(risk(5.5), 'severe');
    assert.equal(risk(5.25), 'critical');
  },

  'over 15½ hours in 24 under BFM is an escalated risk breach'() {
    const r = check(record([
      [0, 6, 'R'], [6, 11.5, 'W'], [11.5, 12, 'R'], [12, 17.5, 'W'], [17.5, 18, 'R'],
      [18, 22.75, 'W'], [22.75, 48, 'R'],
    ]), 'bfm-solo');
    // 15¾ hours: 1¾ hours over the BFM limit, 15 minutes over the escalated threshold.
    const b = r.breaches.find((x) => x.ruleId === 'bfm-24h');
    assert.equal(b.amount, H(1.75));
    assert.equal(b.escalated, true);
    assert.equal(b.severity, 'substantial');
  },

  'two-up 7 days: 24 continuous hours plus 24 hours in blocks of 7 is compliant'() {
    const slots = new Array(8 * SLOTS_PER_DAY).fill('R');
    for (let d = 0; d < 6; d++) {
      for (let i = H(d * 24 + 6); i < H(d * 24 + 11); i++) slots[i] = 'W';
      for (let i = H(d * 24 + 11.5); i < H(d * 24 + 14.5); i++) slots[i] = 'W';
    }
    const r = check(slots, 'standard-two-up');
    assert.deepEqual(ids(r), []);
  },

  'BFM two-up: 14 hours in 24 is allowed, 14¼ is not'() {
    const day = (last) => record([[0, 4, 'R'], [4, 11, 'W'], [11, 11.5, 'R'], [11.5, last, 'W'], [last, 48, 'R']]);
    assert.deepEqual(ids(check(day(18.5), 'bfm-two-up')), []);
    assert.deepEqual(ids(check(day(18.75), 'bfm-two-up')), ['bfm2-24h']);
  },

  'BFM two-up: rests of 9½ hours miss the 10 continuous hours needed in 82 hours'() {
    const slots = new Array(4 * SLOTS_PER_DAY).fill('R');
    for (let d = 0; d < 4; d++) {
      for (let i = H(d * 24 + 4); i < H(d * 24 + 11); i++) slots[i] = 'W';
      for (let i = H(d * 24 + 11.5); i < H(d * 24 + 18.5); i++) slots[i] = 'W';
    }
    const r = check(slots, 'bfm-two-up');
    assert.deepEqual([...new Set(ids(r))], ['bfm2-82h']);
    assert.equal(r.breaches[0].amount, H(0.5));
  },

  'plan: starting fresh at 06:00, the first stop is a break at 11:15'() {
    const p = plan(record([[0, 6, 'R']]), 'standard-solo', H(6));
    assert.equal(p[0].label, 'In any 5½ hours');
    assert.equal(p[0].stopAt, H(11.25));
    assert.equal(p[0].kind, 'work');
  },

  'plan: after 11 hours work today, the 12-hour limit comes before the next break'() {
    const slots = record([
      [0, 6, 'R'], [6, 11, 'W'], [11, 11.5, 'R'], [11.5, 16.5, 'W'], [16.5, 17, 'R'], [17, 18, 'W'],
    ]);
    const p = plan(slots, 'standard-solo', H(18));
    const daily = p.find((x) => x.rule.id === 'std-24h' && x.kind === 'work');
    assert.equal(daily.stopAt, H(19));
    assert.equal(p[0].rule.id, 'std-24h');
  },

  'plan: a driver must stop in time to fit the 7-hour rest in the 24 hours'() {
    // 3½ hours work and a 6-hour rest (too short to start a new period) since 06:00. The 7-hour
    // rest has to fit before 06:00 tomorrow, so it must start by 23:00, before the 12-hour
    // limit would be reached at 00:30.
    const slots = record([[0, 6, 'R'], [6, 8, 'W'], [8, 8.5, 'R'], [8.5, 10, 'W'], [10, 16, 'R']]);
    const daily = plan(slots, 'standard-solo', H(16)).find((x) => x.rule.id === 'std-24h');
    assert.equal(daily.kind, 'rest');
    assert.equal(daily.stopAt, H(23));
  },

  'plan: already over the limit means stop now'() {
    const slots = record([[0, 6, 'R'], [6, 11.5, 'W']]);
    const p = plan(slots, 'standard-solo', H(11.5));
    assert.equal(p[0].stopAt, H(11.5));
    assert.equal(p[0].overNow, true);
  },

  // The worked example on the NHVR "Counting time" page: start at 06:00, work 5¼ h, 15 min
  // break, 2¼ h, 90 min break, 4½ h, then a 7-hour rest from 19:45 to 02:45.
  'NHVR example: work at 02:45 still counts in the 24 hours from 06:00'() {
    const day = [[0, 6, 'R'], [6, 11.25, 'W'], [11.25, 11.5, 'R'], [11.5, 13.75, 'W'], [13.75, 15.25, 'R'], [15.25, 19.75, 'W'], [19.75, 26.75, 'R']];
    const r = check(record([...day, [26.75, 27.75, 'W'], [27.75, 48, 'R']]), 'standard-solo');
    assert.deepEqual(ids(r), ['std-24h']);
    assert.equal(r.breaches[0].start, H(6));
    assert.equal(r.breaches[0].amount, H(1));
  },

  'NHVR example: starting again at 06:00 the next day is compliant'() {
    const day = [[0, 6, 'R'], [6, 11.25, 'W'], [11.25, 11.5, 'R'], [11.5, 13.75, 'W'], [13.75, 15.25, 'R'], [15.25, 19.75, 'W'], [19.75, 30, 'R']];
    const r = check(record([...day, [30, 35, 'W'], [35, 48, 'R']]), 'standard-solo');
    assert.deepEqual(ids(r), []);
  },

  'NHVR example: the earliest the driver can start again is 06:00'() {
    const slots = record([[0, 6, 'R'], [6, 11.25, 'W'], [11.25, 11.5, 'R'], [11.5, 13.75, 'W'], [13.75, 15.25, 'R'], [15.25, 19.75, 'W']]);
    assert.equal(earliestStart(slots, 'standard-solo', H(19.75)), H(30));
    assert.equal(plan(slots, 'standard-solo', H(19.75))[0].stopAt, H(19.75));
  },

  '14-day periods are counted from the end of a night rest break, not any 7-hour rest'() {
    // A 7-hour rest in the day (10:00 to 17:00) and one overnight (22:00 to 05:00).
    const slots = new Array(3 * SLOTS_PER_DAY).fill('W');
    for (let i = H(10); i < H(17); i++) slots[i] = 'R';
    for (let i = H(22); i < H(29); i++) slots[i] = 'R';
    const runs = findRestRuns(slots.map((v) => v === 'W'));
    const rule = RULESETS['standard-solo'].rules.find((r) => r.id === 'std-14d');
    assert.deepEqual(windowStarts(runs, rule, slots.length), [0, H(29)]);
  },

  'earlier work: the 7 days are the 5 days before plus the first two sheets'() {
    // 10 hours on each sheet; the first two count. 52 hours before is exactly 72.
    const entries = [];
    for (let d = 0; d < 3; d++) entries.push([d * 24 + 6, d * 24 + 11, 'W'], [d * 24 + 11.5, d * 24 + 16.5, 'W']);
    const slots = record(entries);
    assert.deepEqual(ids(check(slots, 'standard-solo', { prior: { 'work-7': H(52) } })), []);
    const r = check(slots, 'standard-solo', { prior: { 'work-7': H(52.25) } });
    assert.deepEqual(ids(r), ['std-7d']);
    assert.equal(r.breaches[0].amount, 1);
    assert.equal(r.breaches[0].severity, 'minor');
    assert.equal(r.breaches[0].start, 2 * SLOTS_PER_DAY - 7 * SLOTS_PER_DAY);
    assert.equal(r.breaches[0].end, 2 * SLOTS_PER_DAY);
    // The last work block on the second sheet is the one that goes over.
    assert.deepEqual(r.breaches[0].slots, [H(24 + 16.5) - 1]);
  },

  'earlier work: the 5-day and 12-day totals are checked separately, never added together'() {
    // 20 hours on the first two sheets. 52 + 20 = 72 for 7 days, 124 + 20 = 144 for 14 days:
    // both exactly at the limit. Added together they would be far over.
    const slots = record([[6, 11, 'W'], [11.5, 16.5, 'W'], [30, 35, 'W'], [35.5, 40.5, 'W']]);
    const both = { 'work-7': H(52), 'work-14': H(124) };
    assert.deepEqual(ids(check(slots, 'standard-solo', { prior: both })), []);
    // Each total only affects its own period.
    const r = check(slots, 'standard-solo', { prior: { 'work-7': H(52), 'work-14': H(125) } });
    assert.deepEqual(ids(r), ['std-14d']);
    assert.equal(r.breaches[0].amount, H(1));
  },

  'earlier work: a day before the sheets is not added to the total again'() {
    // Day 0 is the day before the sheets: its work is already in the 5-day total.
    const slots = record([[6, 16, 'W'], [24 + 6, 24 + 16, 'W'], [48 + 6, 48 + 16, 'W']]);
    const opts = { prior: { 'work-7': H(52) }, priorStart: SLOTS_PER_DAY };
    // 52 before + 20 on the two sheets = 72: at the limit. Counting day 0 again would be 82.
    assert.deepEqual(ids(check(slots, 'standard-solo', opts)).filter((id) => id === 'std-7d'), []);
    const over = { prior: { 'work-7': H(52.25) }, priorStart: SLOTS_PER_DAY };
    assert.equal(check(slots, 'standard-solo', over).breaches.find((b) => b.ruleId === 'std-7d').amount, 1);
  },

  'earlier work: a total already over the limit is a breach with no marked blocks'() {
    const r = check(record([]), 'standard-solo', { prior: { 'work-14': H(150) } });
    assert.deepEqual(ids(r), ['std-14d']);
    assert.deepEqual(r.breaches[0].slots, []);
    assert.equal(r.breaches[0].severity, 'critical');
  },

  'earlier work: BFM long/night total adds to night work on the sheets'() {
    const slots = record([[0, 6, 'W'], [6, 24, 'R']]);
    assert.deepEqual(ids(check(slots, 'bfm-solo', { prior: { 'longnight-7': H(30) } })), []);
    const r = check(slots, 'bfm-solo', { prior: { 'longnight-7': H(31) } });
    assert.deepEqual(ids(r), ['bfm-7d']);
    assert.equal(r.breaches[0].kind, 'longnight');
  },

  'earlier work: the planner stops at the weekly limit'() {
    const slots = record([[0, 6, 'R']]);
    // 70 hours before the sheets: 2 more hours today, the period's last day.
    const p = plan(record([[0, 30, 'R']]), 'standard-solo', H(30), { prior: { 'work-7': H(70) } });
    assert.equal(p[0].rule.id, 'std-7d');
    assert.equal(p[0].stopAt, H(32));
  },

  // Rest before the sheets. Day 0 is the day before, days 1 to 3 the sheets; the periods end
  // with the middle sheet (day 2).
  'rest before: a 24-hour rest is due within 7 days of the last one'() {
    const D = SLOTS_PER_DAY;
    const base = { priorStart: D, priorThrough: 2 };
    // Last 24-hour rest ended at 06:00, 5 days before the first sheet: the next is due by 06:00
    // on the last sheet. Ten hours of work a day, no 24-hour rest.
    const slots = record([[6, 16, 'W'], [30, 40, 'W'], [54, 64, 'W'], [78, 88, 'W']]);
    const s0 = D - 5 * D + H(6);
    const r = check(slots, 'standard-solo', { ...base, history: { lastLongRestEnd: s0 } });
    const b = r.breaches.find((x) => x.ruleId === 'std-7d' && x.kind === 'rest');
    assert.ok(b, 'flags the missing 24-hour rest');
    assert.equal(b.end, s0 + 7 * D);
    // A 24-hour rest on the first sheet meets it.
    const rested = record([[6, 16, 'W'], [54, 64, 'W'], [78, 88, 'W']]);
    const ok = check(rested, 'standard-solo', { ...base, history: { lastLongRestEnd: s0 } });
    assert.equal(ok.breaches.find((x) => x.ruleId === 'std-7d' && x.kind === 'rest'), undefined);
  },

  'rest before: night rest breaks are counted before and on the sheets'() {
    const base = { priorStart: SLOTS_PER_DAY, priorThrough: 2 };
    // Rest from 22:00 on the first sheet to 08:00 on the middle sheet is a night rest break.
    const slots = record([[30, 46, 'W'], [56, 64, 'W']]);
    const run = (history) => check(slots, 'standard-solo', { ...base, history })
      .breaches.filter((b) => b.ruleId === 'std-14d');
    // 3 before + 1 on the sheets = 4, but none on consecutive days.
    const lone = run({ nights: { 'night-14': { count: 3, consecutive: false } }, nightBefore: false });
    assert.equal(lone.length, 1);
    assert.match(lone[0].message, /none on consecutive days/);
    // The night into the first sheet was a night rest break too: it pairs with the first one.
    assert.deepEqual(run({ nights: { 'night-14': { count: 3, consecutive: false } }, nightBefore: true }), []);
    // Only 2 before: 3 in all.
    assert.equal(run({ nights: { 'night-14': { count: 2, consecutive: true } } }).length, 1);
  },

  'rest before: BFM work since the last 24-hour rest counts towards the 84 hours'() {
    const base = { priorStart: SLOTS_PER_DAY, priorThrough: 2 };
    const slots = record([[24 + 6, 24 + 10, 'W']]);
    const run = (since) => check(slots, 'bfm-solo', { ...base, history: { workSinceLongRest: since } })
      .breaches.filter((b) => b.ruleId === 'bfm-84h');
    assert.deepEqual(run(H(80)), []);
    const over = run(H(80.25));
    assert.equal(over.length, 1);
    assert.equal(over[0].amount, 1);
  },

  'rest before: BFM needs two 24-hour rests in 14 days'() {
    const base = { priorStart: SLOTS_PER_DAY, priorThrough: 2 };
    const slots = record([[30, 40, 'W'], [54, 64, 'W']]);
    const run = (count) => check(slots, 'bfm-solo', { ...base, history: { longRests: { 'long-14': count } } })
      .breaches.filter((b) => b.ruleId === 'bfm-14d' && b.kind === 'rest');
    assert.equal(run(1).length, 1);
    assert.deepEqual(run(2), []);
  },

  'rest that is not stationary does not count as the 7-hour stationary rest'() {
    const day = (v) => record([[0, 6, 'R'], [6, 11, 'W'], [11.5, 16, 'W'], [16, 23, v], [23, 25, 'W'], [25, 72, 'R']]);
    assert.deepEqual(ids(check(day('R'), 'standard-solo')), []);
    const r = check(day('N'), 'standard-solo');
    assert.ok(r.breaches.some((b) => b.ruleId === 'std-24h' && b.kind === 'rest'));
  },

  'rest that is not stationary still counts as a short break'() {
    const slots = record([[0, 6, 'R'], [6, 11, 'W'], [11, 11.25, 'N'], [11.25, 13.5, 'W'], [13.5, 72, 'R']]);
    assert.deepEqual(ids(check(slots, 'standard-solo')), []);
  },

  'two-up: 5 hours in a moving sleeper berth meets the 24-hour rest, but not the 52-hour rest'() {
    // Work and moving-berth rest in turns: 5 hours each, across two days.
    const entries = [[0, 6, 'R']];
    for (let t = 6; t < 66; t += 10) entries.push([t, t + 5, 'W'], [t + 5, t + 10, 'N']);
    entries.push([66, 72, 'R']);
    const r = check(record(entries), 'standard-two-up');
    assert.equal(r.breaches.filter((b) => b.ruleId === 'std2-24h' && b.kind === 'rest').length, 0);
    assert.ok(r.breaches.some((b) => b.ruleId === 'std2-52h'));
  },

  // Daylight saving days in the base's time zone. Day 1 is the day the clocks change.
  'daylight saving starts: a rest from 9pm to 4am on the clock is only 6 hours'() {
    // Day 1 has no 02:00 to 03:00: 92 real slots.
    const wall = [];
    for (let g = 0; g < 3 * SLOTS_PER_DAY; g++) if (g < SLOTS_PER_DAY + H(2) || g >= SLOTS_PER_DAY + H(3)) wall.push(g);
    const clock = makeClock(wall);
    const at = (day, hour) => clock.at(day, H(hour));
    const slots = new Array(wall.length).fill('R');
    const work = (a, b) => { for (let i = a; i < b; i++) slots[i] = 'W'; };
    work(at(0, 12), at(0, 16.5)); work(at(0, 17), at(0, 21));
    work(at(1, 4), at(1, 8));
    const r = check(slots, 'standard-solo', { clock });
    const rest = r.breaches.find((b) => b.ruleId === 'std-24h' && b.kind === 'rest');
    assert.ok(rest, 'the 7-hour rest is 1 hour short in real time');
    assert.equal(rest.amount, H(1));
    // Without the clock change the same sheet is fine.
    const plain = new Array(3 * SLOTS_PER_DAY).fill('R');
    for (const [a, b] of [[12, 16.5], [17, 21], [28, 32]]) for (let i = H(a); i < H(b); i++) plain[i] = 'W';
    assert.equal(check(plain, 'standard-solo').breaches.filter((b) => b.kind === 'rest').length, 0);
  },

  'daylight saving ends: the repeated hour counts twice'() {
    // Day 1 has 02:00 to 03:00 twice: 100 real slots.
    const wall = [];
    for (let g = 0; g < 3 * SLOTS_PER_DAY; g++) {
      wall.push(g);
      if (g >= SLOTS_PER_DAY + H(2) && g < SLOTS_PER_DAY + H(3)) wall.push(g);
    }
    const clock = makeClock(wall);
    assert.equal(clock.at(2, 0) - clock.at(1, 0), SLOTS_PER_DAY + H(1));
    // Work from 00:00 to 05:15 on the clock is 6¼ hours in real time: over the 5¼ limit by 1h.
    const slots = new Array(wall.length).fill('R');
    for (let i = clock.at(1, 0); i < clock.at(1, H(5.25)); i++) slots[i] = 'W';
    const r = check(slots, 'standard-solo', { clock });
    const b = r.breaches.find((x) => x.ruleId === 'std-5.5h');
    assert.ok(b);
    // Night work between midnight and 6am on the clock: all of it, 6¼ hours.
    const bfm = check(slots, 'bfm-solo', { clock });
    assert.equal(bfm.longNight.size, H(6.25));
  },

  'BFM counts night work towards the long/night limit'() {
    // Three nights of 00:00–06:00 work, each followed by a 5-hour day: 18 h of night work.
    const entries = [];
    for (let d = 0; d < 3; d++) {
      entries.push([d * 24, d * 24 + 6, 'W'], [d * 24 + 6, d * 24 + 6.5, 'R'], [d * 24 + 6.5, d * 24 + 11.5, 'W'], [d * 24 + 11.5, d * 24 + 24, 'R']);
    }
    const r = check(record(entries), 'bfm-solo');
    assert.equal(r.longNight.size, H(18));
    assert.deepEqual(ids(r), []);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err.message.split('\n').join('\n     ')}`);
  }
}
process.exitCode = failed ? 1 : 0;
