// Run with: node test/grid.test.js
//
// A grid of boundary tests generated from RULESETS, so every limit in every work option is
// checked at exactly the limit and 15 minutes past it.
'use strict';

const assert = require('node:assert/strict');
const { check, RULESETS, H, SLOTS_PER_DAY, ruleLabel } = require('../rules.js');

const tests = {};
const DAY = SLOTS_PER_DAY;

function blank(n) {
  return new Array(n).fill('R');
}

function mark(slots, from, to, v) {
  for (let i = from; i < to && i < slots.length; i++) slots[i] = v;
  return slots;
}

function breachesOf(result, rule, kind) {
  return result.breaches.filter((b) => b.ruleId === rule.id && b.kind === kind && !b.inBlocks);
}

for (const [id, ruleset] of Object.entries(RULESETS)) {
  for (const rule of ruleset.rules) {
    const name = `${id} · ${ruleLabel(rule)}`;

    // Work limits: continuous work after a long rest, exactly the limit and then 15 minutes more.
    if (rule.maxWork != null && rule.period) {
      const start = H(6);
      const n = start + rule.period + 2 * DAY;
      const run = (amount) => check(mark(blank(n), start, start + amount, 'W'), id);
      tests[`${name}: ${rule.maxWork / 4} hours work is allowed`] = () => {
        assert.deepEqual(breachesOf(run(rule.maxWork), rule, 'work'), []);
      };
      tests[`${name}: 15 minutes more is a breach`] = () => {
        const found = breachesOf(run(rule.maxWork + 1), rule, 'work');
        assert.equal(found.length, 1);
        assert.equal(found[0].amount, 1);
        assert.ok(found[0].severity, 'has a risk category');
      };
    }

    // Continuous rest requirements: one block of exactly the required rest inside the period,
    // then 15 minutes less.
    if (rule.restBlocks && rule.restBlocks.count === 1 && rule.period) {
      const L = rule.restBlocks.length;
      const start = H(6);
      const firstWork = H(1);
      const n = start + firstWork + L + rule.period + 2 * DAY;
      const run = (rest) => {
        const slots = mark(blank(n), start, start + rule.period, 'W');
        mark(slots, start + firstWork, start + firstWork + rest, 'R');
        return check(slots, id);
      };
      tests[`${name}: ${L / 4} hours continuous rest meets it`] = () => {
        assert.deepEqual(breachesOf(run(L), rule, 'rest'), []);
      };
      tests[`${name}: 15 minutes less is a breach`] = () => {
        const found = breachesOf(run(L - 1), rule, 'rest');
        assert.ok(found.length >= 1);
        assert.equal(found[0].amount, 1);
        // Under BFM, rest below the 7-hour escalated threshold starts at substantial risk.
        const escalated = rule.escalated && rule.escalated.restLength >= L;
        assert.equal(found[0].severity, escalated ? 'substantial' : 'minor');
        assert.equal(!!found[0].escalated, !!escalated);
      };
    }

    // BFM long/night work: 6 nights of midnight to 6am is 36 hours; 15 minutes more on the 7th.
    if (rule.maxLongNight != null) {
      const run = (extra) => {
        const slots = blank(9 * DAY);
        for (let d = 0; d < 6; d++) mark(slots, d * DAY, d * DAY + H(6), 'W');
        mark(slots, 6 * DAY, 6 * DAY + extra, 'W');
        return check(slots, id);
      };
      tests[`${name}: 36 hours of night work is allowed`] = () => {
        assert.deepEqual(breachesOf(run(0), rule, 'longnight'), []);
      };
      tests[`${name}: 15 minutes more is a breach`] = () => {
        const found = breachesOf(run(1), rule, 'longnight');
        assert.equal(found.length, 1);
        assert.equal(found[0].amount, 1);
      };
    }

    // BFM: work between 24-hour rests. Seven days of 12 hours is 84 hours.
    if (rule.betweenRests) {
      const run = (extra) => {
        const slots = blank(10 * DAY);
        for (let d = 0; d < 7; d++) mark(slots, d * DAY + H(6), d * DAY + H(18), 'W');
        mark(slots, 7 * DAY + H(6), 7 * DAY + H(6) + extra, 'W');
        return check(slots, id);
      };
      tests[`${name}: 84 hours between 24-hour rests is allowed`] = () => {
        assert.deepEqual(breachesOf(run(0), rule, 'between'), []);
      };
      tests[`${name}: 15 minutes more is a breach`] = () => {
        const found = breachesOf(run(1), rule, 'between');
        assert.equal(found.length, 1);
        assert.equal(found[0].amount, 1);
      };
    }
  }
}

// Hand-written cases around midnight and split breaks.
tests['standard: 5½ hours straight across midnight is a breach'] = () => {
  const slots = mark(blank(3 * DAY), H(21), H(26.5), 'W');
  assert.deepEqual(check(slots, 'standard-solo').breaches.map((b) => b.ruleId), ['std-5.5h']);
};

tests['standard: two 15-minute breaks meet the 30 minutes in 8 hours'] = () => {
  const slots = blank(3 * DAY);
  mark(slots, H(6), H(9), 'W');
  mark(slots, H(9.25), H(11.75), 'W');
  mark(slots, H(12), H(14), 'W');
  assert.deepEqual(check(slots, 'standard-solo').breaches, []);
};

tests['standard: 12 hours spread over a day with short breaks is allowed'] = () => {
  const slots = blank(3 * DAY);
  mark(slots, H(5), H(10), 'W');
  mark(slots, H(10.5), H(15), 'W');
  mark(slots, H(16), H(18.5), 'W');
  assert.deepEqual(check(slots, 'standard-solo').breaches, []);
};

tests['standard: a night shift of 12 hours across midnight is allowed'] = () => {
  const slots = blank(3 * DAY);
  mark(slots, H(18), H(23), 'W');
  mark(slots, H(23.5), H(28), 'W');
  mark(slots, H(29), H(31.5), 'W');
  assert.deepEqual(check(slots, 'standard-solo').breaches, []);
};

tests['BFM: 14 hours in 24 with breaks is allowed, 14¼ is not'] = () => {
  const day = (last) => {
    const slots = blank(3 * DAY);
    mark(slots, H(5), H(10.5), 'W');
    mark(slots, H(11), H(16.5), 'W');
    mark(slots, H(17), H(last), 'W');
    return check(slots, 'bfm-solo').breaches.map((b) => b.ruleId);
  };
  assert.deepEqual(day(20), []);
  assert.deepEqual(day(20.25), ['bfm-24h']);
};

let failed = 0;
let passed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err.message.split('\n').join('\n     ')}`);
  }
}
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
