// Fatigue rules and the compliance engine for the work diary checker.
//
// Time is held as an array of 15-minute slots: 'W' (work), 'R' (rest) or null (not recorded).
// Unrecorded slots count as rest, but rest requirements are only checked for periods that end
// on or before the last recorded slot.
//
// Standard hours and risk categories follow Schedule 1 of the Heavy Vehicle (Fatigue Management)
// National Regulation (current as at 1 August 2026). BFM hours are no longer in the regulation;
// they follow the NHVR "Work and rest hours" page for operators whose BFM accreditation is still
// in force, with risk categories from Schedule 2. All limits are in RULESETS.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EWD = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SLOT_MINUTES = 15;
  const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;
  const H = (hours) => Math.round((hours * 60) / SLOT_MINUTES);
  const DAYS = (n) => n * SLOTS_PER_DAY;

  // A night rest break is 7 continuous hours stationary rest between 10pm and 8am, or 24
  // continuous hours stationary rest. Long/night work is work between midnight and 6am, or
  // work beyond 12 hours in a 24-hour period.
  const NIGHT_REST_FROM = H(22);
  const NIGHT_REST_TO = H(32);
  const NIGHT_REST_LENGTH = H(7);
  const NIGHT_WORK_TO = H(6);
  const LONG_WORK_AFTER = H(12);

  // Rule fields:
  //   period        length of the "in any period of" window, in slots
  //   relevantRest  a window starts at the end of every rest break at least this long
  //   relevantNight a window also starts at the end of every night rest break
  //   maxWork       maximum work in the window
  //   workRisk      upper bounds of minor, substantial and severe risk for work over the limit
  //   restBlocks    { length, count }: required continuous rest blocks inside the window
  //   restInBlocks  { block, total }: rest in blocks of at least `block`, separate from a
  //                 24-hour continuous block (section 22(3)(b))
  //   nightRests    { count, consecutive }: required night rest breaks inside the window. With
  //                 `consecutive`, 2 of them must be on consecutive days (section 22(3)(a))
  //   maxLongNight  maximum long/night work in the window (BFM)
  //   betweenRests  { rest, maxWork }: maximum work between rest breaks of `rest` length
  //   escalated     alternative compliance thresholds for escalated risk (Schedule 2, Table 2)
  //   source        where the limit comes from

  // Stationary rest is rest out of the vehicle or in an approved sleeper berth of a stationary
  // vehicle. The diary has one REST line, so all rest is treated as stationary.

  // Schedule 1 risk categories, as the amount over the maximum work time. For rest, every row
  // grades the shortfall of a block the same way: up to 45 minutes short is minor, up to 75
  // substantial, up to 90 severe, more is critical.
  const ALWAYS_MINOR = [Infinity];
  const RISK_11H = [H(0.75), Infinity];
  const RISK_DAY = [H(0.75), H(1.25), H(1.5)];
  const RISK_WEEKS = [H(1.5), H(2.5), H(3)];
  const RISK_REST = [H(0.75), H(1.25), H(1.5)];

  // Schedule 2 risk categories for alternative compliance hours. Table 1 uses the same bounds as
  // RISK_DAY and RISK_WEEKS. Table 3 (escalated risk) starts at substantial.
  const ESCALATED_DAY = [H(0.25), H(0.5)];
  const ESCALATED_WEEKS = [H(0.5), H(1)];

  const SHORT_PERIODS = (prefix, source) => [
    { id: `${prefix}-5.5h`, period: H(5.5), relevantRest: 1, maxWork: H(5.25), workRisk: ALWAYS_MINOR, restText: '15 continuous minutes rest', source },
    { id: `${prefix}-8h`, period: H(8), relevantRest: 1, maxWork: H(7.5), workRisk: ALWAYS_MINOR, restText: '30 minutes rest in blocks of at least 15 continuous minutes', source },
    { id: `${prefix}-11h`, period: H(11), relevantRest: 1, maxWork: H(10), workRisk: RISK_11H, restText: '60 minutes rest in blocks of at least 15 continuous minutes', source },
  ];

  const RULESETS = {
    'standard-solo': {
      name: 'Standard Hours — solo driver',
      option: 'standard',
      source: 'Heavy Vehicle (Fatigue Management) National Regulation, Schedule 1, Table 1',
      rules: [
        ...SHORT_PERIODS('std', 'Sch 1 Table 1'),
        { id: 'std-24h', period: H(24), relevantRest: H(7), maxWork: H(12), workRisk: RISK_DAY, restBlocks: { length: H(7), count: 1 }, restText: '7 continuous hours stationary rest' },
        { id: 'std-7d', period: DAYS(7), relevantRest: H(24), maxWork: H(72), workRisk: RISK_WEEKS, restBlocks: { length: H(24), count: 1 }, restText: '24 continuous hours stationary rest' },
        { id: 'std-14d', period: DAYS(14), relevantNight: true, maxWork: H(144), workRisk: RISK_WEEKS, nightRests: { count: 4, consecutive: true }, restText: '2 night rest breaks, and 2 night rest breaks taken on consecutive days' },
      ],
    },
    'standard-bus': {
      name: 'Standard Hours — solo bus driver',
      option: 'standard',
      source: 'Heavy Vehicle (Fatigue Management) National Regulation, Schedule 1, Table 2',
      rules: [
        ...SHORT_PERIODS('bus', 'Sch 1 Table 2'),
        { id: 'bus-24h', period: H(24), relevantRest: H(7), maxWork: H(12), workRisk: RISK_DAY, restBlocks: { length: H(7), count: 1 }, restText: '7 continuous hours stationary rest' },
        { id: 'bus-7d', period: DAYS(7), relevantNight: true, nightRests: { count: 6, consecutive: false }, restText: '6 night rest breaks' },
        { id: 'bus-28d', period: DAYS(28), relevantRest: H(24), maxWork: H(288), workRisk: RISK_WEEKS, restBlocks: { length: H(24), count: 4 }, restText: '4 blocks of 24 continuous hours stationary rest' },
      ],
    },
    'standard-two-up': {
      name: 'Standard Hours — two-up driver',
      option: 'standard',
      source: 'Heavy Vehicle (Fatigue Management) National Regulation, Schedule 1, Table 3',
      twoUp: true,
      rules: [
        ...SHORT_PERIODS('std2', 'Sch 1 Table 3'),
        { id: 'std2-24h', period: H(24), relevantRest: H(5), maxWork: H(12), workRisk: RISK_DAY, restBlocks: { length: H(5), count: 1 }, restText: '5 continuous hours stationary rest, or 5 continuous hours rest in an approved sleeper berth while the vehicle is moving' },
        { id: 'std2-52h', period: H(52), relevantRest: H(10), restBlocks: { length: H(10), count: 1 }, restText: '10 continuous hours stationary rest' },
        { id: 'std2-7d', period: DAYS(7), relevantRest: H(24), maxWork: H(60), workRisk: RISK_WEEKS, restBlocks: { length: H(24), count: 1 }, restInBlocks: { block: H(7), total: H(24) }, restText: '24 continuous hours stationary rest, and another 24 hours stationary rest in blocks of at least 7 continuous hours' },
        { id: 'std2-14d', period: DAYS(14), relevantNight: true, maxWork: H(120), workRisk: RISK_WEEKS, nightRests: { count: 4, consecutive: true }, restText: '2 night rest breaks, and 2 night rest breaks taken on consecutive days' },
      ],
    },
    'bfm-solo': {
      name: 'BFM — solo driver',
      option: 'bfm',
      source: 'NHVR work and rest hours (BFM solo drivers). Risk categories from the Heavy Vehicle (Fatigue Management) National Regulation, Schedule 2',
      alternative: true,
      rules: [
        { id: 'bfm-6.25h', period: H(6.25), relevantRest: 1, maxWork: H(6), workRisk: RISK_DAY, restText: '15 continuous minutes rest' },
        { id: 'bfm-9h', period: H(9), relevantRest: 1, maxWork: H(8.5), workRisk: RISK_DAY, restText: '30 minutes rest in blocks of 15 continuous minutes' },
        { id: 'bfm-12h', period: H(12), relevantRest: 1, maxWork: H(11), workRisk: RISK_DAY, restText: '60 minutes rest in blocks of 15 continuous minutes' },
        { id: 'bfm-24h', period: H(24), relevantRest: H(7), maxWork: H(14), workRisk: RISK_DAY, restBlocks: { length: H(7), count: 1 }, escalated: { maxWork: H(15.5), restLength: H(7) }, restText: '7 continuous hours stationary rest' },
        { id: 'bfm-7d', period: DAYS(7), relevantRest: H(24), maxLongNight: H(36), workRisk: RISK_WEEKS, workText: 'Max 36 hours long/night work', restText: 'No limit has been set' },
        { id: 'bfm-14d', period: DAYS(14), relevantRest: H(24), relevantNight: true, maxWork: H(144), workRisk: RISK_WEEKS, escalated: { maxWork: H(154) }, restBlocks: { length: H(24), count: 2 }, nightRests: { count: 4, consecutive: true }, restText: '24 continuous hours stationary rest taken after no more than 84 hours work, and 24 continuous hours stationary rest, and 2 night rest breaks, and 2 night rest breaks taken on consecutive days' },
        { id: 'bfm-84h', label: 'Between 24-hour rest breaks', period: DAYS(7), betweenRests: { rest: H(24), maxWork: H(84) }, workRisk: RISK_WEEKS, workText: 'Max 84 hours work', restText: '24 continuous hours stationary rest' },
      ],
    },
    'bfm-two-up': {
      name: 'BFM — two-up driver',
      option: 'bfm',
      source: 'NHVR work and rest hours (BFM two-up drivers). Risk categories from the Heavy Vehicle (Fatigue Management) National Regulation, Schedule 2',
      alternative: true,
      twoUp: true,
      rules: [
        { id: 'bfm2-24h', period: H(24), relevantRest: 1, maxWork: H(14), workRisk: RISK_DAY, escalated: { maxWork: H(15.5) }, restText: 'No limit has been set' },
        { id: 'bfm2-82h', period: H(82), relevantRest: H(10), restBlocks: { length: H(10), count: 1 }, restText: '10 continuous hours stationary rest' },
        { id: 'bfm2-7d', period: DAYS(7), relevantRest: H(24), maxWork: H(70), workRisk: RISK_WEEKS, restBlocks: { length: H(24), count: 1 }, restInBlocks: { block: H(7), total: H(24) }, restText: '24 continuous hours stationary rest, and another 24 hours stationary rest in blocks of at least 7 continuous hours' },
        { id: 'bfm2-14d', period: DAYS(14), relevantNight: true, maxWork: H(140), workRisk: RISK_WEEKS, escalated: { maxWork: H(154) }, nightRests: { count: 4, consecutive: false }, restText: '4 night rest breaks' },
      ],
    },
  };

  function formatDuration(slots) {
    const minutes = slots * SLOT_MINUTES;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (!h) return `${m}m`;
    if (!m) return `${h}h`;
    return `${h}h ${m}m`;
  }

  // "5¼ hours", "24 hours", "7 days"
  function formatPeriod(slots) {
    if (slots >= DAYS(2) && slots % SLOTS_PER_DAY === 0) return `${slots / SLOTS_PER_DAY} days`;
    return formatHours(slots);
  }

  function formatHours(slots) {
    const quarters = Math.round((slots * SLOT_MINUTES) / 15);
    const whole = Math.floor(quarters / 4);
    const frac = ['', '¼', '½', '¾'][quarters % 4];
    return `${whole}${frac} hours`;
  }

  function ruleLabel(rule) {
    return rule.label || `In any ${formatPeriod(rule.period)}`;
  }

  function describeRule(rule) {
    let work = rule.workText;
    if (!work) work = rule.maxWork != null ? `Max ${formatHours(rule.maxWork)} work` : '—';
    return { id: rule.id, period: ruleLabel(rule), work, rest: rule.restText || '—', risk: riskText(rule) };
  }

  const RISK_NAMES = ['minor', 'substantial', 'severe', 'critical'];

  function grade(bounds, amount, from = 0) {
    const k = bounds.findIndex((b) => amount <= b);
    return RISK_NAMES[from + (k < 0 ? bounds.length : k)];
  }

  // Risk category for a breach. `amount` is how far over the work limit, or how far short of a
  // rest block, in slots. `value` is the work total or the longest rest block.
  function riskOf(rule, kind, amount, value) {
    const weeks = (rule.period || 0) >= DAYS(7);
    const esc = rule.escalated;
    if (esc && kind === 'work' && esc.maxWork != null && value > esc.maxWork) {
      return { severity: grade(weeks ? ESCALATED_WEEKS : ESCALATED_DAY, value - esc.maxWork, 1), escalated: true };
    }
    if (esc && kind === 'rest' && esc.restLength != null && value < esc.restLength) {
      return { severity: grade(ESCALATED_DAY, esc.restLength - value, 1), escalated: true };
    }
    if (kind === 'rest') return { severity: grade(RISK_REST, amount), escalated: false };
    return { severity: grade(rule.workRisk || (weeks ? RISK_WEEKS : RISK_DAY), amount), escalated: false };
  }

  function riskText(rule) {
    const bounds = rule.workRisk;
    if (!bounds || (rule.maxWork == null && rule.maxLongNight == null && !rule.betweenRests)) return '';
    if (bounds === ALWAYS_MINOR) return 'Any work over the limit is a minor risk breach.';
    const parts = bounds.map((b, k) => (b === Infinity ? `more is ${RISK_NAMES[k]}` : `up to ${formatDuration(b)} over is ${RISK_NAMES[k]}`));
    if (bounds[bounds.length - 1] !== Infinity) parts.push('more is critical');
    let text = `${parts.join(', ')}.`;
    if (rule.escalated && rule.escalated.maxWork != null) {
      text += ` Over ${formatHours(rule.escalated.maxWork)} is an escalated risk breach (substantial or higher).`;
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function defaultTime(i) {
    const day = Math.floor(i / SLOTS_PER_DAY) + 1;
    const minutes = (((i % SLOTS_PER_DAY) + SLOTS_PER_DAY) % SLOTS_PER_DAY) * SLOT_MINUTES;
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `day ${day} ${hh}:${mm}`;
  }

  function findRestRuns(work) {
    const runs = [];
    let start = -1;
    for (let i = 0; i <= work.length; i++) {
      const rest = i < work.length && !work[i];
      if (rest && start < 0) start = i;
      if (!rest && start >= 0) {
        runs.push({ start, end: i });
        start = -1;
      }
    }
    return runs;
  }

  // A night rest break: 7 continuous hours rest between 10pm and 8am, or 24 continuous hours.
  function isNightRest(run) {
    if (run.end - run.start >= H(24)) return true;
    for (let d = Math.floor(run.start / SLOTS_PER_DAY) - 1; d * SLOTS_PER_DAY <= run.end; d++) {
      const a = d * SLOTS_PER_DAY + NIGHT_REST_FROM;
      const b = d * SLOTS_PER_DAY + NIGHT_REST_TO;
      if (Math.min(run.end, b) - Math.max(run.start, a) >= NIGHT_REST_LENGTH) return true;
    }
    return false;
  }

  // Following the NHVR "Counting time" rules, periods are counted forward from the end of a
  // relevant rest break: any rest break for periods under 24 hours, and for longer periods the
  // major rest break required for that period (for example 7 hours for 24 hours, a night rest
  // break for 14 days). A later relevant rest break inside a period does not end that period.
  // Time before the record counts as rest, so the first work also starts a period. If a period
  // ends without the required rest break, later periods are counted from the end of any rest
  // break, and from where the previous period ended.
  function windowStarts(restRuns, rule, n) {
    const relevant = (run) => run.start === 0 ||
      (rule.relevantRest != null && run.end - run.start >= rule.relevantRest) ||
      (rule.relevantNight && isNightRest(run));
    const starts = new Set();
    if (!restRuns.length || restRuns[0].start > 0) starts.add(0);
    for (const run of restRuns) {
      if (run.end < n && relevant(run)) starts.add(run.end);
    }
    const sorted = [...starts].sort((a, b) => a - b);
    const out = new Set();
    for (let k = 0; k < sorted.length; k++) {
      const s = sorted[k];
      out.add(s);
      const next = k + 1 < sorted.length ? sorted[k + 1] : n;
      if (s + rule.period >= next) continue;
      for (let t = s + rule.period; t < next; t += rule.period) out.add(t);
      for (const run of restRuns) {
        if (run.end >= s + rule.period && run.end < next) out.add(run.end);
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  function longestRestIn(restRuns, from, to) {
    let longest = 0;
    for (const run of restRuns) {
      const len = Math.min(run.end, to) - Math.max(run.start, from);
      if (len > longest) longest = len;
    }
    return longest;
  }

  // Lengths of the rest breaks inside a window, longest first.
  function restLengthsIn(restRuns, from, to) {
    return restRuns
      .map((run) => Math.min(run.end, to) - Math.max(run.start, from))
      .filter((len) => len > 0)
      .sort((a, b) => b - a);
  }

  function workSlotsIn(work, from, to) {
    const out = [];
    for (let i = Math.max(from, 0); i < Math.min(to, work.length); i++) if (work[i]) out.push(i);
    return out;
  }

  function longNightSlots(work, restRuns, rule24) {
    const set = new Set();
    work.forEach((w, i) => {
      if (w && i % SLOTS_PER_DAY < NIGHT_WORK_TO) set.add(i);
    });
    if (rule24) {
      for (const s of windowStarts(restRuns, rule24, work.length)) {
        let cum = 0;
        for (let i = s; i < Math.min(s + H(24), work.length); i++) {
          if (work[i] && ++cum > LONG_WORK_AFTER) set.add(i);
        }
      }
    }
    return set;
  }

  // Overlapping findings for the same rule come from overlapping windows. Report each episode
  // once, using its worst window.
  function mergeFindings(findings) {
    findings.sort((a, b) => a.slots[0] - b.slots[0]);
    const merged = [];
    for (const f of findings) {
      const last = merged[merged.length - 1];
      if (last && last.kind === f.kind && f.slots[0] <= last.slots[last.slots.length - 1] + 1) {
        const union = new Set([...last.slots, ...f.slots]);
        const worst = (f.amount || 0) > (last.amount || 0) ? f : last;
        merged[merged.length - 1] = { ...worst, slots: [...union].sort((a, b) => a - b) };
      } else {
        merged.push(f);
      }
    }
    return merged;
  }

  function check(slots, rulesetId, opts = {}) {
    const ruleset = RULESETS[rulesetId];
    if (!ruleset) throw new Error(`Unknown work option: ${rulesetId}`);
    const fmtTime = opts.fmtTime || defaultTime;
    const prior = opts.prior || {};
    const n = slots.length;
    const work = slots.map((v) => v === 'W');
    let knownEnd = 0;
    for (let i = n - 1; i >= 0; i--) {
      if (slots[i] != null) {
        knownEnd = i + 1;
        break;
      }
    }
    const restRuns = findRestRuns(work);
    const result = { ruleset, breaches: [], notes: [], longNight: new Set(), knownEnd };
    if (!work.some(Boolean) && !Object.keys(prior).length) return result;

    if (ruleset.rules.some((r) => r.maxLongNight != null)) {
      const rule24 = ruleset.rules.find((r) => r.period === H(24) && r.maxWork != null);
      result.longNight = longNightSlots(work, restRuns, rule24);
    }

    for (const rule of ruleset.rules) {
      if (opts.only && rule.id !== opts.only) continue;
      const label = ruleLabel(rule);
      const findings = [];

      if (rule.betweenRests) {
        const { rest, maxWork } = rule.betweenRests;
        const resetAt = new Set(restRuns.filter((r) => r.end - r.start >= rest).map((r) => r.start));
        let cum = 0;
        let segStart = 0;
        let current = null;
        for (let i = 0; i < n; i++) {
          if (resetAt.has(i)) {
            cum = 0;
            current = null;
          }
          if (!work[i]) continue;
          if (cum === 0) segStart = i;
          if (++cum > maxWork) {
            if (!current) {
              current = { kind: 'between', start: segStart, slots: [] };
              findings.push(current);
            }
            current.slots.push(i);
            current.amount = cum - maxWork;
            current.total = cum;
          }
        }
        for (const f of findings) {
          f.message = `Worked ${formatDuration(f.total)} from ${fmtTime(f.start)} without ${rule.restText} — the limit is ${formatDuration(maxWork)} (${formatDuration(f.amount)} over).`;
          Object.assign(f, riskOf(rule, 'work', f.amount, f.total));
        }
      } else {
        for (const s of windowStarts(restRuns, rule, n)) {
          const end = s + rule.period;
          const complete = end <= knownEnd;
          const range = `the ${formatPeriod(rule.period)} from ${fmtTime(s)}`;

          if (rule.maxWork != null) {
            let cum = 0;
            const over = [];
            for (let i = s; i < Math.min(end, n); i++) {
              if (work[i] && ++cum > rule.maxWork) over.push(i);
            }
            if (over.length) {
              const amount = cum - rule.maxWork;
              findings.push({
                kind: 'work', start: s, end, amount, slots: over,
                ...riskOf(rule, 'work', amount, cum),
                message: `Worked ${formatDuration(cum)} in ${range} — the limit is ${formatDuration(rule.maxWork)} (${formatDuration(amount)} over).`,
              });
            }
          }

          if (rule.maxLongNight != null) {
            let cum = 0;
            const over = [];
            for (let i = s; i < Math.min(end, n); i++) {
              if (result.longNight.has(i) && ++cum > rule.maxLongNight) over.push(i);
            }
            if (over.length) {
              const amount = cum - rule.maxLongNight;
              findings.push({
                kind: 'longnight', start: s, end, amount, slots: over,
                ...riskOf(rule, 'work', amount, cum),
                message: `${formatDuration(cum)} of long/night work in ${range} — the limit is ${formatDuration(rule.maxLongNight)} (${formatDuration(amount)} over).`,
              });
            }
          }

          if (rule.restBlocks && complete) {
            const { length, count } = rule.restBlocks;
            const lengths = restLengthsIn(restRuns, s, end);
            const blocks = lengths.filter((len) => len >= length).length;
            if (blocks < count) {
              // The risk category follows the block that fell short: the best one not counted.
              const shortBlock = lengths[blocks] || 0;
              const amount = length - shortBlock;
              const flagged = workSlotsIn(work, end - length, end);
              findings.push({
                kind: 'rest', start: s, end, amount, slots: flagged.length ? flagged : [end - 1],
                ...riskOf(rule, 'rest', amount, shortBlock),
                message: count === 1
                  ? `Longest rest in ${range} was ${formatDuration(shortBlock)} — ${rule.restText} is required (${formatDuration(amount)} short).`
                  : `Only ${blocks} of the ${count} rest breaks of ${formatDuration(length)} were taken in ${range}.`,
              });
            }
          }

          if (rule.restInBlocks && complete) {
            const { block, total } = rule.restInBlocks;
            const lengths = restLengthsIn(restRuns, s, end).filter((len) => len >= block);
            // A 24-hour continuous rest used for the other requirement can't count here as well.
            if (rule.restBlocks && lengths.length && lengths[0] >= rule.restBlocks.length) {
              lengths[0] -= rule.restBlocks.length;
            }
            const sum = lengths.filter((len) => len >= block).reduce((a, b) => a + b, 0);
            if (sum < total) {
              const amount = total - sum;
              const flagged = workSlotsIn(work, s, end);
              findings.push({
                kind: 'rest', inBlocks: true, start: s, end, amount, slots: [flagged[flagged.length - 1] ?? end - 1],
                ...riskOf(rule, 'rest', amount, sum),
                message: `${formatDuration(sum)} rest in blocks of at least ${formatDuration(block)} in ${range}, besides the 24-hour rest — ${formatDuration(total)} is required (${formatDuration(amount)} short).`,
              });
            }
          }

          if (rule.nightRests && complete) {
            const ok = [];
            for (let d = Math.floor(s / SLOTS_PER_DAY) - 1; d * SLOTS_PER_DAY < end; d++) {
              const a = d * SLOTS_PER_DAY + NIGHT_REST_FROM;
              const b = d * SLOTS_PER_DAY + NIGHT_REST_TO;
              if (a < s || b > end) continue;
              ok[d] = longestRestIn(restRuns, a, b) >= NIGHT_REST_LENGTH ||
                restRuns.some((r) => r.end - r.start >= H(24) && r.start < b && r.end > a);
            }
            const nights = ok.filter(Boolean).length;
            const needConsecutive = rule.nightRests.consecutive;
            const consecutive = ok.some((v, d) => v && ok[d + 1]);
            if (nights < rule.nightRests.count || (needConsecutive && !consecutive)) {
              // Graded by the longest rest in a night that fell short of a night rest break.
              let best = 0;
              ok.forEach((v, d) => {
                if (!v) best = Math.max(best, longestRestIn(restRuns, d * SLOTS_PER_DAY + NIGHT_REST_FROM, d * SLOTS_PER_DAY + NIGHT_REST_TO));
              });
              const flagged = workSlotsIn(work, s, end);
              findings.push({
                kind: 'night', start: s, end, slots: [flagged[flagged.length - 1] ?? end - 1],
                ...riskOf(rule, 'rest', NIGHT_REST_LENGTH - best, best),
                message: `${nights} night rest break${nights === 1 ? '' : 's'} in ${range}${needConsecutive && !consecutive ? ', none on consecutive days' : ''} — ${rule.restText} required.`,
              });
            }
          }
        }
      }

      for (const f of mergeFindings(findings)) {
        result.breaches.push({ ...f, ruleId: rule.id, ruleLabel: label });
      }

      // Work before the sheets, entered as a total for the days before the first sheet (slot
      // `priorStart`, 0 by default). With the first `priorThrough` days of sheets (two by
      // default) they make up the period, so the period checked ends with the last of those days.
      // Anything recorded before `priorStart` is already in the total, so it isn't added again.
      const key = priorKey(rule);
      const priorStart = opts.priorStart || 0;
      const firstDay = Math.min(n, priorStart + (opts.priorThrough || 2) * SLOTS_PER_DAY);
      if (key && prior[key] != null && rule.period > firstDay - priorStart) {
        const longNight = rule.maxLongNight != null;
        const max = longNight ? rule.maxLongNight : rule.maxWork;
        const before = prior[key];
        let cum = before;
        const over = [];
        for (let i = priorStart; i < firstDay; i++) {
          const counts = longNight ? result.longNight.has(i) : work[i];
          if (counts && ++cum > max) over.push(i);
        }
        if (cum > max) {
          const amount = cum - max;
          const start = firstDay - rule.period;
          result.breaches.push({
            kind: longNight ? 'longnight' : 'work', start, end: firstDay, amount, slots: over, prior: true,
            ...riskOf(rule, 'work', amount, cum),
            message: `${longNight ? 'Long/night work of' : 'Worked'} ${formatDuration(cum)} in the ${formatPeriod(rule.period)} from ${fmtTime(start)}, including ${formatDuration(before)} before the sheets — the limit is ${formatDuration(max)} (${formatDuration(amount)} over).`,
            ruleId: rule.id, ruleLabel: label,
          });
        }
      }

      const needsFullPeriod = rule.restBlocks || rule.restInBlocks || rule.nightRests;
      if (rule.period && needsFullPeriod && rule.period > knownEnd) {
        result.notes.push(
          `${label}: the rest requirement (${rule.restText}) needs at least ${formatPeriod(rule.period)} of records, so only the work limit is checked.`
        );
      }
    }

    // A breach that happened entirely before the record has no marked slots; list it first.
    const at = (b) => (b.slots.length ? b.slots[0] : -1);
    result.breaches.sort((a, b) => at(a) - at(b));
    return result;
  }

  // Which earlier-work total a rule uses: work for 7, 14 or 28 days, or BFM long/night work for
  // 7 days. Null for rules that can't take one.
  function priorKey(rule) {
    if (!rule.period || rule.period < DAYS(7) || rule.period % SLOTS_PER_DAY) return null;
    const days = rule.period / SLOTS_PER_DAY;
    if (rule.maxLongNight != null) return `longnight-${days}`;
    if (rule.maxWork != null) return `work-${days}`;
    return null;
  }

  // How long the driver can keep working from slot `from`, rule by rule, if they work without a
  // break and then rest. For each rule that would be breached within the record, returns the
  // slot where work has to stop (`from` if continuing at all would breach it) and the kind of
  // breach: running out of work time, or running out of time to fit a required rest.
  function plan(slots, rulesetId, from, opts = {}) {
    const ruleset = RULESETS[rulesetId];
    const n = slots.length;
    if (from < 0 || from >= n) return [];
    const trial = (k) => slots.map((v, i) => (i < from ? v : i < from + k ? 'W' : 'R'));
    const out = [];
    // A driver who is over a limit right now has to stop now, even if the period that was
    // breached has ended and a new one would allow more work.
    const overNow = check(trial(0), rulesetId, opts).breaches.filter((b) => b.slots.includes(from - 1));
    for (const rule of ruleset.rules) {
      const current = overNow.find((b) => b.ruleId === rule.id);
      if (current) {
        out.push({ rule, label: ruleLabel(rule), stopAt: from, kind: current.kind, overNow: true });
        continue;
      }
      // A breach caused by the extra work: it marks at least one of the new work slots.
      const firstBreach = (k) => check(trial(k), rulesetId, { ...opts, only: rule.id }).breaches
        .find((b) => b.slots.some((i) => i >= from && i < from + k));
      const last = firstBreach(n - from);
      if (!last) continue;
      // More work never removes a breach, so search for the first block of work that causes one.
      let lo = 0;
      let hi = n - from;
      let breach = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const b = firstBreach(mid);
        if (b) {
          hi = mid;
          breach = b;
        } else {
          lo = mid;
        }
      }
      out.push({ rule, label: ruleLabel(rule), stopAt: from + lo, kind: breach.kind });
    }
    return out.sort((a, b) => a.stopAt - b.stopAt);
  }

  // The earliest slot from `from` at which the driver can start work again without a breach,
  // resting until then, or -1 if there is none within the record.
  function earliestStart(slots, rulesetId, from, opts = {}) {
    const n = slots.length;
    for (let t = Math.max(from, 0); t < n; t++) {
      const trial = slots.map((v, i) => (i < from ? v : i === t ? 'W' : 'R'));
      if (!check(trial, rulesetId, opts).breaches.some((b) => b.slots.includes(t))) return t;
    }
    return -1;
  }

  return {
    SLOT_MINUTES, SLOTS_PER_DAY, RULESETS, H,
    check, plan, earliestStart, priorKey, windowStarts, findRestRuns, describeRule, formatDuration, formatPeriod, ruleLabel,
  };
});
