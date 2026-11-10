(function () {
  'use strict';

  const { RULESETS, SLOTS_PER_DAY, SLOT_MINUTES, H, check, plan, earliestStart, priorKey, describeRule, formatDuration, formatPeriod } = window.EWD;

  // Up to eight days are kept: an optional "day before" sheet (page 0), the three main daily
  // sheets (pages 1 to 3), and up to four extra sheets for the days after (pages 4 to 7). While
  // the day before is hidden it is all rest, which is how time before the sheets is counted.
  // Extra sheets that aren't in use are left out of the checks altogether.
  const MAIN_SHEETS = 3;
  const MAX_EXTRA = 4;
  const PAGES = 1 + MAIN_SHEETS + MAX_EXTRA;
  const FIRST = 1;
  const MIDDLE = 2;
  const N = PAGES * SLOTS_PER_DAY;

  function extraSheets() {
    const n = Number(state.extraSheets);
    return Number.isInteger(n) && n >= 0 && n <= MAX_EXTRA ? n : 0;
  }

  // The daily sheets in use, by page: 1, 2, 3 and any extra ones.
  function sheetPages() {
    return Array.from({ length: MAIN_SHEETS + extraSheets() }, (_, k) => FIRST + k);
  }

  // The end of the record the checks use: the end of the last sheet in use.
  function recordEnd() {
    return (FIRST + MAIN_SHEETS + extraSheets()) * SLOTS_PER_DAY;
  }

  // The sheets as the checks see them: up to the end of the last sheet in use.
  function recordSlots() {
    return state.slots.slice(0, recordEnd());
  }
  // The earlier-work totals cover the days before the sheets. With the first 1, 2 or 3 sheets
  // on the page (the driver's choice, 2 by default) they make up the 7, 14 or 28 days. The day
  // before counts as the first sheet when it is shown.
  function priorSheets() {
    return [1, 2, 3].includes(state.priorSheets) ? state.priorSheets : 2;
  }

  // The page of the first sheet counted: the day before when shown, otherwise the first sheet.
  function firstCounted() {
    return state.showDayBefore ? 0 : FIRST;
  }

  function priorOpts() {
    return { priorStart: firstCounted() * SLOTS_PER_DAY, priorThrough: priorSheets() };
  }

  const SHEET_NAMES = ['the day before', 'the first sheet', 'the middle sheet', 'the last sheet'];

  // Where the periods end, e.g. "the middle sheet".
  function priorEndName() {
    return SHEET_NAMES[firstCounted() + priorSheets() - 1];
  }

  // The sheets counted, e.g. "the day before and the first sheet".
  function sheetsText() {
    const names = SHEET_NAMES.slice(firstCounted(), firstCounted() + priorSheets());
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  // The test version keeps its own entries, so trying ideas can't change the live app's.
  const STORAGE_KEY = 'ewd-checker-test-v1';
  const HOUR_LABELS = ['Mid', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
    'Noon', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  // The boxes on a diary daily sheet.
  const HOURS_OPTIONS = [['standard', 'Standard'], ['standard-bus', 'Standard Bus'], ['bfm', 'BFM'],
    ['afm', 'AFM'], ['ach', 'ACH'], ['exemption', 'Exemption hours (for this 24hr period only)']];
  const TWO_UP_OPTIONS = [['standard', 'Standard'], ['bfm', 'BFM'], ['afm', 'AFM'], ['ach', 'ACH'], ['exemption', 'Exemption hours']];
  const ZONES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].map((z) => [z, z]);
  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // What is kept for each daily sheet, besides the time.
  function blankPage() {
    return {
      rego: '', diaryNo: '', zone: '', checkTime: '', comments: '',
      twoUp: '', twoUpLicence: '', twoUpIssued: '', twoUpDiary: '', twoUpOption: '',
    };
  }

  const $ = (sel, root = document) => root.querySelector(sel);

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return isoDate(new Date(y, m - 1, d + n));
  }

  // The middle sheet is today unless the driver picks another date, so the first is yesterday.
  function yesterdayISO() {
    return addDays(isoDate(new Date()), -1);
  }

  function defaultState() {
    return {
      ruleset: 'standard-solo',
      startDate: yesterdayISO(),
      dateChosen: false,
      driver: '',
      licence: '',
      pages: Array.from({ length: PAGES }, blankPage),
      // The TWO-UP line: 1 where the driver marked two-up driving.
      pair: new Array(N).fill(0),
      slots: new Array(N).fill('R'),
      changes: {},
      // Start of "Your next limits": null for the time now, or { date, time } the driver picked.
      planFrom: null,
      // Earlier work typed in for the longer periods, as entered, keyed by rule (e.g. work-7).
      prior: {},
      // Answers about rest before the sheets, as entered.
      history: { lastRestDay: '', lastRestTime: '', workSince: '', nights: {}, nightBefore: '', longRests: {} },
      showDayBefore: false,
      // How many sheets go with the work-before totals to make up 7, 14 and 28 days.
      priorSheets: 2,
      // Extra sheets after the main three, 0 to 4.
      extraSheets: 0,
    };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.slots) || !RULESETS[saved.ruleset]) return null;
      // Saves from before the day-before sheet held three days: move them along by one.
      if (saved.slots.length === 3 * SLOTS_PER_DAY) {
        saved.slots = new Array(SLOTS_PER_DAY).fill('R').concat(saved.slots);
        saved.pages = [blankPage()].concat(saved.pages || []);
        saved.changes = Object.fromEntries(Object.entries(saved.changes || {})
          .map(([i, v]) => [String(Number(i) + SLOTS_PER_DAY), v]));
      }
      // Saves from before the extra sheets held four days: add the four days after.
      if (saved.slots.length === 4 * SLOTS_PER_DAY) {
        saved.slots = saved.slots.concat(new Array(N - saved.slots.length).fill('R'));
        if (Array.isArray(saved.pair)) saved.pair = saved.pair.concat(new Array(N - saved.pair.length).fill(0));
      }
      if (saved.slots.length !== N) return null;
      const state = { ...defaultState(), ...saved };
      state.history = { ...defaultState().history, ...(saved.history || {}) };
      // Every block is work or rest. Older saves had unmarked blocks, which count as rest.
      state.slots = state.slots.map((v) => (v === 'W' ? 'W' : 'R'));
      while (state.pages.length < PAGES) state.pages.push(blankPage());
      state.pages = state.pages.map((pg) => ({ ...blankPage(), ...pg }));
      if (!Array.isArray(state.pair) || state.pair.length !== N) state.pair = new Array(N).fill(0);
      if (!state.dateChosen) state.startDate = yesterdayISO();
      return state;
    } catch (e) {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Storage can be unavailable (private mode); the checker still works without it.
    }
  }

  const saved = load();
  let state = saved || defaultState();
  let result = null;
  // Which breach each marked slot belongs to, and the breach picked to explain (by key).
  let breachAt = new Map();
  let selectedKey = null;

  // ---- Dates and times ----------------------------------------------------------------------

  // The date of page p. state.startDate is the first daily sheet's date (page 1).
  function pageDate(p) {
    const [y, m, d] = (state.startDate || yesterdayISO()).split('-').map(Number);
    return new Date(y, m - 1, d + p - FIRST);
  }

  // The lines of the graph, top to bottom: work, stationary rest, rest that isn't stationary.
  // A block's value is the line it is drawn on.
  const LINES = ['W', 'R'];

  function formatDate(date, long) {
    return date.toLocaleDateString('en-AU', long
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function clock(i) {
    const minutes = (((i % SLOTS_PER_DAY) + SLOTS_PER_DAY) % SLOTS_PER_DAY) * SLOT_MINUTES;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function fmtTime(i) {
    return `${formatDate(pageDate(Math.floor(i / SLOTS_PER_DAY)))} ${clock(i)}`;
  }

  // The 15-minute block the time now falls in, or -1 when today is not on the sheets.
  function nowIndex() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = Math.round((today - pageDate(0)) / 86400000);
    if (day < 0 || day >= FIRST + MAIN_SHEETS + extraSheets()) return -1;
    return day * SLOTS_PER_DAY + Math.floor((now.getHours() * 60 + now.getMinutes()) / SLOT_MINUTES);
  }

  function slotDate(i) {
    const d = pageDate(Math.floor(i / SLOTS_PER_DAY));
    d.setMinutes((i % SLOTS_PER_DAY) * SLOT_MINUTES);
    return d;
  }

  // ---- Building the sheets ------------------------------------------------------------------

  const sheets = [];

  function buildControls() {
    // Up to four extra sheets after the main three, all checked and printed together.
    const extra = $('#extra-sheets');
    for (let k = 0; k <= MAX_EXTRA; k++) {
      const opt = el('option', null, k ? `${MAIN_SHEETS + k} sheets (${k} more after the main three)` : `${MAIN_SHEETS} sheets (the main three)`);
      opt.value = String(k);
      extra.append(opt);
    }
    extra.value = String(extraSheets());
    extra.addEventListener('change', () => {
      state.extraSheets = Number(extra.value);
      update(true);
    });

    const select = $('#ruleset');
    for (const [id, rs] of Object.entries(RULESETS)) {
      const opt = el('option', null, rs.name);
      opt.value = id;
      select.append(opt);
    }
    select.value = state.ruleset;
    select.addEventListener('change', () => {
      state.ruleset = select.value;
      update(true);
    });

    for (const [id, kind] of [['driver', 'name'], ['licence', 'licence']]) {
      const input = $(`#${id}`);
      input.value = state[id];
      input.addEventListener('input', () => {
        state[id] = input.value;
        update(true);
      });
      attachCheck(input, kind, (v) => {
        state[id] = v;
        update(true);
      });
    }

    watchMiddleDate($('#middle-date'));

    confirmButton($('#example'), 'Replace entries?', () => state.slots.includes('W'), loadExample);
    confirmButton($('#clear'), 'Tap again to clear', () => true, () => {
      // Back to a fresh start: today as the middle sheet, the time now for the plan, no day
      // before, no driver details, and empty sheets.
      const fresh = defaultState();
      state.driver = '';
      state.licence = '';
      $('#driver').value = '';
      $('#licence').value = '';
      $('#driver').recheck();
      $('#licence').recheck();
      state.slots = fresh.slots;
      state.changes = {};
      state.prior = {};
      state.history = fresh.history;
      state.startDate = fresh.startDate;
      state.dateChosen = false;
      state.planFrom = null;
      state.showDayBefore = false;
      state.pages = fresh.pages;
      state.pair = fresh.pair;
      state.example = false;
      clearEarlierBoxes();
      syncDayBeforeToggle();
      update(true);
    });
    const print = $('#print');
    if (print) {
      print.addEventListener('click', () => {
        buildPrintSheets();
        window.print();
      });
    }
    window.addEventListener('beforeprint', buildPrintSheets);
  }

  // Asks for a second tap instead of a dialog, so it also works where dialogs are blocked.
  // The middle sheet's date can be set at the top or on the sheet itself; the other sheets are
  // the day before and the day after. The state keeps the first sheet's date.
  function setMiddleDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return;
    state.startDate = addDays(iso, -1);
    state.dateChosen = iso !== isoDate(new Date());
    update(true);
  }

  function watchMiddleDate(input) {
    input.value = addDays(state.startDate, 1);
    // Some phone browsers only send "change" when the picker closes, others only "input".
    const pick = () => {
      if (input.value && input.value !== addDays(state.startDate, 1)) setMiddleDate(input.value);
    };
    input.addEventListener('input', pick);
    input.addEventListener('change', pick);
  }

  function syncMiddleDate() {
    const iso = addDays(state.startDate, 1);
    document.querySelectorAll('.middle-date-input').forEach((input) => {
      if (document.activeElement !== input) input.value = iso;
    });
    const today = $('#middle-today');
    if (today) today.hidden = iso === isoDate(new Date());
  }

  function confirmButton(button, question, needsConfirm, action) {
    let label = button.textContent;
    let timer = 0;
    const reset = () => {
      clearTimeout(timer);
      timer = 0;
      button.textContent = label;
      button.classList.remove('confirming');
    };
    button.addEventListener('click', () => {
      if (timer || !needsConfirm()) {
        reset();
        action();
        return;
      }
      label = button.textContent;
      button.textContent = question;
      button.classList.add('confirming');
      timer = setTimeout(reset, 4000);
    });
  }

  // ---- Checking what the driver types ----------------------------------------------------------
  //
  // Each check takes the text (tidied, if the check tidies) and returns '' when it's fine, or what
  // to fix. An empty box is always fine. When the driver leaves a box, text that passes is tidied:
  // capitals and no spaces for licence numbers, number plates and diary numbers, and 05:45 for a
  // time typed as 545.

  // Work diary numbers, like QCD 755011: letters and digits with at least one digit, one hyphen
  // at most, spaces between groups, up to 20 characters in all. Older diaries differ, so the
  // check is broad.
  const diaryOk = (t) => t.length >= 4 && t.length <= 20 && /\d/.test(t) &&
    /^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/.test(t) && (t.match(/-/g) || []).length <= 1;
  const diaryTidy = (t) => t.trim().toUpperCase().replace(/\s+/g, ' ').replace(/ ?- ?/g, '-');
  const DIARY_HELP = 'A work diary number is letters and digits (one hyphen or spaces are fine), up to 20 characters, like QCD 755011.';
  const squash = (t) => t.replace(/[\s-]/g, '').toUpperCase();

  const CHECKS = {
    name: {
      check: (t) => (/^\p{L}[\p{L} .'’-]{1,59}$/u.test(t) ? '' : 'Use letters only (spaces, hyphens and apostrophes are fine), 2 to 60 characters.'),
    },
    // Any state's format: from 4 to 10 letters and digits, with at least one digit.
    licence: {
      tidy: squash,
      check: (t) => (/^(?=.*\d)[A-Z0-9]{4,10}$/.test(t) ? '' : 'An Australian licence number is 4 to 10 letters and digits, with at least one digit.'),
    },
    plate: {
      tidy: squash,
      check: (t) => (/^[A-Z0-9]{2,9}$/.test(t) ? '' : 'A number plate is 2 to 9 letters and digits.'),
    },
    diary: {
      tidy: diaryTidy,
      check: (t) => (diaryOk(t) ? '' : DIARY_HELP),
    },
    // The diary number, then the page number after a slash, a comma, "page" or "p".
    diaryPage: {
      tidy: (t) => {
        const m = t.trim().toUpperCase().match(/^(.+?)\s*(?:\/|,|\bP(?:AGE)?\.?)\s*(\d{1,3})$/);
        return m ? `${diaryTidy(m[1])} / ${m[2]}` : diaryTidy(t);
      },
      check: (t) => {
        const m = t.match(/^(.+) \/ (\d{1,3})$/);
        if (!m || Number(m[2]) < 1) return 'Enter the work diary number, then a slash and the page number, like QCD 755011 / 23.';
        return diaryOk(m[1]) ? '' : DIARY_HELP;
      },
    },
    time: {
      tidy: (t) => {
        const v = t.trim().replace('.', ':');
        if (/^\d{3,4}$/.test(v)) return `${v.slice(0, -2).padStart(2, '0')}:${v.slice(-2)}`;
        if (/^\d:\d\d$/.test(v)) return `0${v}`;
        return v;
      },
      check: (t) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? '' : 'Enter a 24-hour time, like 05:45.'),
    },
    place: {
      tidy: (t) => t.trim().replace(/\s+/g, ' '),
      check: (t) => (/^[\p{L}\d][\p{L}\d .,'’()&\/#-]{1,59}$/u.test(t) ? '' : 'Use letters and numbers for the place, 2 to 60 characters.'),
    },
    odometer: {
      tidy: (t) => t.replace(/[\s,]/g, ''),
      check: (t) => (/^\d{1,7}$/.test(t) ? '' : 'Enter the odometer reading in whole kilometres, digits only.'),
    },
    comments: {
      check: (t) => (t.length <= 200 ? '' : `Keep comments to 200 characters (now ${t.length}).`),
    },
    hoursSince: {
      check: (t) => (QUARTER_HOURS.test(t) && Number(t) <= 28 * 24 ? '' : `${QUARTER_HELP}. Round up to the next quarter hour.`),
    },
  };

  // Checks a box as the driver types, and shows what to fix under it. `keep` saves tidied text.
  function attachCheck(input, kind, keep) {
    const rule = CHECKS[kind];
    const note = el('span', 'field-error');
    note.hidden = true;
    input.after(note);
    input.dataset.check = kind;
    const run = () => {
      const raw = input.value;
      const message = raw.trim() ? rule.check(rule.tidy ? rule.tidy(raw) : raw.trim()) : '';
      input.classList.toggle('invalid', !!message);
      input.setAttribute('aria-invalid', String(!!message));
      note.textContent = message;
      note.hidden = !message;
      return !message;
    };
    input.addEventListener('input', run);
    input.addEventListener('blur', () => {
      if (!rule.tidy || !input.value.trim() || !run()) return;
      const tidied = rule.tidy(input.value);
      if (tidied !== input.value) {
        input.value = tidied;
        if (keep) keep(tidied);
      }
    });
    input.recheck = run;
    run();
    return input;
  }

  // Odometer readings should go up through the sheets. A lower one is flagged as a warning
  // (it may be a change of vehicle, which belongs in the comments).
  function checkOdometerOrder() {
    const inputs = [...document.querySelectorAll('#sheets .change-input[data-check="odometer"]')]
      .sort((a, b) => Number(a.dataset.slot) - Number(b.dataset.slot));
    let prev = null;
    for (const input of inputs) {
      const warn = input.parentElement.querySelector('.field-warning');
      const value = input.value.trim();
      let message = '';
      if (value && !input.classList.contains('invalid')) {
        const km = Number(CHECKS.odometer.tidy(value));
        if (prev && km < prev.km) message = `Lower than the reading at ${fmtTime(prev.slot)} (${prev.km}). Check it, or note a change of vehicle in the comments.`;
        prev = { km, slot: Number(input.dataset.slot) };
      }
      warn.textContent = message;
      warn.hidden = !message;
    }
  }

  // A line at the top of the summary when boxes need fixing.
  function showInputIssues() {
    const box = $('#summary');
    let line = $('#input-issues');
    const count = invalidCount();
    if (!count) {
      if (line) line.remove();
      return;
    }
    if (!line) {
      line = el('p', 'input-issues');
      line.id = 'input-issues';
    }
    line.textContent = `${count} ${count === 1 ? 'entry needs' : 'entries need'} fixing: ${count === 1 ? "it's" : "they're"} marked in red.`;
    box.prepend(line);
  }

  // How many boxes need fixing, across the page.
  function invalidCount() {
    return document.querySelectorAll('input.invalid, .earlier-field.invalid').length;
  }

  // A row of tick boxes like those on a diary sheet. With onPick the boxes can be tapped; without
  // it they only show what is ticked.
  function tickGroup(items, isOn, onPick) {
    const wrap = el('span', 'ticks');
    const boxes = items.map(([value, label]) => {
      const b = el(onPick ? 'button' : 'span', 'tick-item');
      if (onPick) {
        b.type = 'button';
        b.addEventListener('click', () => onPick(value));
      }
      b.dataset.value = value;
      b.append(el('span', 'tick'), document.createTextNode(label));
      return b;
    });
    wrap.append(...boxes);
    wrap.sync = () => boxes.forEach((b) => {
      const on = isOn(b.dataset.value);
      b.classList.toggle('ticked', on);
      b.firstChild.textContent = on ? '✕' : '';
      if (onPick) b.setAttribute('aria-pressed', String(on));
    });
    wrap.sync();
    return wrap;
  }

  // ---- Printed sheets -----------------------------------------------------------------------
  //
  // Each daily sheet prints on its own landscape page, laid out like a National Driver Work
  // Diary daily sheet. They are built fresh just before printing.

  const SVG = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  // Ticks along a row of the graph: an hour line, a longer tick at the half hour, short ticks at
  // the quarters, from the top and bottom edges of the row.
  function drawTicks(svg, top, height) {
    for (let q = 0; q <= SLOTS_PER_DAY; q++) {
      const x = q * 10;
      if (q % 4 === 0) {
        svg.append(svgEl('line', { x1: x, y1: top, x2: x, y2: top + height, class: 'g-hour' }));
      } else {
        const len = height * (q % 2 === 0 ? 0.32 : 0.18);
        svg.append(svgEl('line', { x1: x, y1: top, x2: x, y2: top + len, class: 'g-tick' }));
        svg.append(svgEl('line', { x1: x, y1: top + height - len, x2: x, y2: top + height, class: 'g-tick' }));
      }
    }
  }

  function printBoxes(items, isOn, cls) {
    const wrap = el('span', `pb ${cls || ''}`);
    for (const [value, label] of items) {
      const item = el('span', `pb-item${isOn(value) ? ' on' : ''}`);
      item.append(el('span', 'pb-box', isOn(value) ? '✕' : ''), document.createTextNode(label));
      wrap.append(item);
    }
    return wrap;
  }

  function printField(label, value, cls) {
    const f = el('div', `pf ${cls || ''}`);
    f.append(el('span', 'pf-label', label), el('span', 'pf-value', value || ''));
    return f;
  }

  function printSheet(p) {
    const pg = state.pages[p];
    const date = pageDate(p);
    const base = p * SLOTS_PER_DAY;
    const ps = el('section', 'ps');

    const top = el('div', 'ps-top');
    const title = el('div', 'ps-title');
    title.append(el('div', 'ps-h1', 'NATIONAL DRIVER WORK DIARY DAILY SHEET'));
    top.append(el('div', 'ps-origin', 'A copy printed from Work Diary Checker. It is not a work diary.'), title,
      el('div', 'ps-wdno', `WORK DIARY NO. ${pg.diaryNo || ''}`));
    ps.append(top, el('div', 'ps-band', 'DRIVER IDENTIFICATION'));

    const ident = el('div', 'ps-ident');
    const day = el('div', 'pf pf-day');
    day.append(el('span', 'pf-label', 'Day (optional):'));
    const days = el('span', 'ps-days');
    WEEKDAYS.forEach((d, k) => days.append(el('span', `ps-dayname${k === date.getDay() ? ' on' : ''}`, d)));
    day.append(days);
    const hours = el('div', 'pf pf-hours');
    hours.append(el('span', 'pf-label', 'Driver Hours Option'), printBoxes(HOURS_OPTIONS, (v) => RULESETS[state.ruleset].option === v, 'pb-hours'));
    const zone = el('div', 'pf pf-zone');
    zone.append(el('span', 'pf-label', 'Time Zone: State/Territory (driver base)'), printBoxes(ZONES, (v) => pg.zone === v, 'pb-cells'));
    ident.append(
      printField("Driver's Name:", state.driver, 'pf-name'),
      printField('Date:', date.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' }), 'pf-date'),
      day, hours,
      printField('Time of daily check (if required):', pg.checkTime, 'pf-check'),
      printField('Licence No:', state.licence, 'pf-licence'),
      printField('Number Plate:', pg.rego, 'pf-plate'),
      zone
    );
    ps.append(ident);

    // Details of activities: comments, odometer readings and places in the hour of each change,
    // the TWO-UP line, and the work and rest graph.
    const acts = el('div', 'ps-acts');
    acts.append(el('div', 'ps-side', 'DETAILS OF ACTIVITIES FOR THIS DAY'));
    const rows = el('div', 'ps-rows');
    const label = (text, small) => {
      const l = el('div', 'ps-label');
      l.append(el('strong', null, text));
      if (small) l.append(el('small', null, small));
      return l;
    };
    rows.append(label('Number Plate Change and Comments', '(optional) (e.g. delays, authorised officer notes)'),
      el('div', 'ps-comments', pg.comments || ''));
    const odo = el('div', 'ps-hours ps-odo');
    const place = el('div', 'ps-hours ps-place');
    for (let h = 0; h < 24; h++) {
      odo.append(el('div', 'ps-col'));
      place.append(el('div', 'ps-col'));
    }
    // Each place name prints upright on the line of its work/rest change, with the odometer
    // reading on the same line above it.
    const mark = (row, text, q) => {
      const m = el('span', 'ps-mark', text);
      m.style.left = `${(q / SLOTS_PER_DAY) * 100}%`;
      row.append(m);
    };
    for (let q = 0; q < SLOTS_PER_DAY; q++) {
      const c = state.changes[base + q];
      if (!c) continue;
      if (c.odometer) mark(odo, c.odometer, q);
      if (c.location) mark(place, c.location, q);
    }
    rows.append(label('ODOMETER READING'), odo, el('div', 'ps-calc ps-calc-top', 'Space to calculate work and rest hours (optional)'));
    rows.append(label('NAME OF PLACE AT WORK AND REST CHANGE', '(e.g. rest area, truck stop, suburb or town)'), place);

    const pairSvg = svgEl('svg', { viewBox: '0 0 960 20', preserveAspectRatio: 'none', class: 'ps-svg ps-pair' });
    for (let q = 0; q <= SLOTS_PER_DAY; q++) {
      const len = q % 4 === 0 ? 9 : q % 2 === 0 ? 6 : 4;
      pairSvg.append(svgEl('line', { x1: q * 10, y1: 20 - len, x2: q * 10, y2: 20, class: 'g-tick' }));
    }
    for (let q = 0; q < SLOTS_PER_DAY; q++) {
      if (!state.pair[base + q]) continue;
      pairSvg.append(svgEl('line', { x1: q * 10, y1: 10, x2: q * 10 + 10, y2: 10, class: 'g-pen' }));
      if (!(base + q > 0 && state.pair[base + q - 1])) pairSvg.append(svgEl('line', { x1: q * 10, y1: 0, x2: q * 10, y2: 20, class: 'g-pen' }));
      if (!(base + q < N - 1 && state.pair[base + q + 1])) pairSvg.append(svgEl('line', { x1: q * 10 + 10, y1: 0, x2: q * 10 + 10, y2: 20, class: 'g-pen' }));
    }
    rows.append(label('TWO-UP'), pairSvg);

    const axis = () => {
      const a = el('div', 'ps-axis');
      for (let h = 0; h <= 24; h++) {
        const t = el('span', h % 12 === 0 ? 'ps-axis-word' : null, h === 0 || h === 24 ? 'midnight' : h === 12 ? 'midday' : String(h % 12));
        t.style.left = `${(h / 24) * 100}%`;
        a.append(t);
      }
      return a;
    };
    rows.append(el('div', 'ps-label ps-blank'), axis(), el('div', 'ps-calc ps-calc-small', 'Calculate totals (optional)'));

    let work = 0;
    let rest = 0;
    for (let q = 0; q < SLOTS_PER_DAY; q++) (state.slots[base + q] === 'W' ? work++ : rest++);
    const graph = svgEl('svg', { viewBox: '0 0 960 100', preserveAspectRatio: 'none', class: 'ps-svg ps-graph' });
    // Night hours shaded, as on the diary sheet.
    graph.append(svgEl('rect', { x: 0, y: 0, width: 320, height: 100, class: 'g-night' }));
    graph.append(svgEl('rect', { x: 880, y: 0, width: 80, height: 100, class: 'g-night' }));
    drawTicks(graph, 0, 50);
    drawTicks(graph, 50, 50);
    graph.append(svgEl('line', { x1: 0, y1: 50, x2: 960, y2: 50, class: 'g-hour' }));
    let d = '';
    let prevY = null;
    for (let q = 0; q < SLOTS_PER_DAY; q++) {
      const y = state.slots[base + q] === 'W' ? 25 : 75;
      d += prevY == null ? `M0 ${y}` : y !== prevY ? ` L${q * 10} ${prevY} L${q * 10} ${y}` : '';
      prevY = y;
    }
    d += ` L960 ${prevY}`;
    graph.append(svgEl('path', { d, class: 'g-pen g-line' }));
    // Work that breaks a limit in red, as on screen, including the stroke up into it and down
    // out of it.
    for (let q = 0; q < SLOTS_PER_DAY; q++) {
      const i = base + q;
      if (state.slots[i] !== 'W' || !breachAt.has(i)) continue;
      graph.append(svgEl('line', { x1: q * 10, y1: 25, x2: q * 10 + 10, y2: 25, class: 'g-pen g-breach' }));
      if (q > 0 && state.slots[i - 1] !== 'W') graph.append(svgEl('line', { x1: q * 10, y1: 25, x2: q * 10, y2: 75, class: 'g-pen g-breach' }));
      if (q < SLOTS_PER_DAY - 1 && state.slots[i + 1] !== 'W') graph.append(svgEl('line', { x1: q * 10 + 10, y1: 25, x2: q * 10 + 10, y2: 75, class: 'g-pen g-breach' }));
    }
    const graphWrap = el('div', 'ps-graph-wrap');
    graphWrap.append(graph);
    rows.append(label('MY WORK'), graphWrap, printField('Total Work:', formatHours(work), 'ps-total'));
    rows.append(label('MY REST'), printField('Total Rest:', formatHours(rest), 'ps-total'));
    rows.append(el('div', 'ps-label ps-blank'), axis());
    acts.append(rows);
    ps.append(acts);

    const bottom = el('div', 'ps-bottom');
    const sign = el('div', 'ps-sign');
    sign.append(el('div', 'pf-label', "Driver's Signature:"),
      el('div', 'ps-small', 'To the best of my knowledge and belief the information I have recorded on this daily sheet is true and correct'),
      el('div', 'ps-signbox'),
      el('div', 'ps-must', 'YOU MUST SIGN THIS SHEET BEFORE STARTING A NEW DAILY SHEET'));
    const pairId = el('div', 'ps-pairid');
    const pairGrid = el('div', 'ps-pairgrid');
    const pairHours = el('div', 'pf');
    pairHours.append(el('span', 'pf-label', 'Two-up Driver Hours Option'), printBoxes(TWO_UP_OPTIONS, (v) => pg.twoUpOption === v, 'pb-small'));
    const issued = el('div', 'pf');
    issued.append(el('span', 'pf-label', "Two-up Driver's Licence Issued:"), printBoxes(ZONES, (v) => pg.twoUpIssued === v, 'pb-cells pb-small'));
    pairGrid.append(
      printField("Two-up Driver's Name:", pg.twoUp),
      printField("Two-up Driver's Licence No:", pg.twoUpLicence),
      pairHours,
      printField("Two-up Driver's Work Diary & Page No:", pg.twoUpDiary),
      issued,
      printField("Two-up Driver's Signature:", '')
    );
    pairId.append(el('div', 'ps-band', 'TWO-UP DRIVER IDENTIFICATION'), pairGrid);
    bottom.append(sign, pairId);
    ps.append(bottom);
    return ps;
  }

  // The first printed page: every breach with its date and time, in the order they happened,
  // in the rounded red box with coloured risk badges used on screen. The time is when the
  // limit was first broken (the first block marked red). A breach that comes only from the
  // totals entered for before the sheets has no time on the sheets, so it is listed first, with
  // its period.
  function printBreaches(pages) {
    const page = el('section', 'pr');
    const ruleset = RULESETS[state.ruleset];
    const list = result.breaches
      .map((b) => ({ b, at: b.slots.length ? Math.min(...b.slots) : null }))
      .sort((x, y) => (x.at == null ? -Infinity : x.at) - (y.at == null ? -Infinity : y.at) || (x.b.start || 0) - (y.b.start || 0));
    const box = el('div', `pr-box ${list.length ? 'bad' : 'good'}`);
    box.append(el('p', 'pr-title', list.length
      ? `${list.length} breach${list.length === 1 ? '' : 'es'} found under ${ruleset.name}, in the order they happened`
      : `No breaches found under ${ruleset.name}`));
    const facts = [
      `Driver: ${state.driver || '—'}`,
      `Licence no.: ${state.licence || '—'}`,
      `Sheets: ${formatDate(pageDate(pages[0]))} to ${formatDate(pageDate(pages[pages.length - 1]))}`,
      `Printed: ${new Date().toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}`,
    ];
    box.append(el('p', 'pr-facts', facts.join('   ·   ')));
    if (list.length) {
      const ul = el('ul', 'pr-list');
      for (const { b, at } of list) {
        const [from, to] = breachWindow(b);
        const when = at == null
          ? `Before the sheets (${fmtTime(from)} to ${fmtTime(to)})`
          : `${formatDate(pageDate(Math.floor(at / SLOTS_PER_DAY)))} ${clock(at)}`;
        const li = el('li', 'pr-item');
        li.append(el('span', `severity${b.severity ? ` sev-${b.severity}` : ''}`, severityLabel(b)),
          el('span', 'pr-when', when), el('strong', null, `${b.ruleLabel}: `), document.createTextNode(b.message));
        ul.append(li);
      }
      box.append(ul);
    }
    page.append(box);
    page.append(el('p', 'pr-note', 'Each time is when the limit was first broken, as marked in red on the sheets that follow. This is a guide only; check the current requirements with the NHVR.'));
    return page;
  }

  function buildPrintSheets() {
    const wrap = $('#print-sheets');
    if (!wrap) return;
    const pages = state.showDayBefore ? [0, ...sheetPages()] : sheetPages();
    wrap.replaceChildren(printBreaches(pages), ...pages.map(printSheet));
  }

  function buildSheet(p) {
    const sheet = el('article', `sheet${p < FIRST ? ' sheet-before' : ''}`);
    sheet.setAttribute('aria-label', p < FIRST ? 'The day before' : `Daily sheet ${p}`);

    const head = el('div', 'sheet-head');
    head.append(
      el('div', 'sheet-title', p < FIRST ? 'THE DAY BEFORE' : 'DAILY SHEET'),
      el('div', 'sheet-no', p < FIRST ? 'Optional' : `No. ${String(p).padStart(4, '0')}`)
    );
    sheet.append(head);

    // Details panel, laid out like the boxes at the top of a diary page.
    const meta = el('div', 'sheet-meta');
    const box = (label, content) => {
      const b = el('div', 'meta-box');
      b.append(el('span', 'meta-label', label), content);
      meta.append(b);
      return b;
    };
    // Fields kept for this sheet, shown from the state on every full render.
    const syncers = [];
    const field = (key, placeholder, inputMode, kind) => {
      const input = el('input', 'meta-input');
      input.placeholder = placeholder || '';
      if (inputMode) input.inputMode = inputMode;
      input.autocomplete = 'off';
      input.addEventListener('input', () => {
        state.pages[p][key] = input.value;
        save();
      });
      // The check is attached once the box is on the page, so its note sits under it.
      if (kind) queueMicrotask(() => attachCheck(input, kind, (v) => { state.pages[p][key] = v; save(); }));
      syncers.push(() => {
        if (document.activeElement !== input) input.value = state.pages[p][key] || '';
        if (input.recheck) input.recheck();
      });
      return input;
    };
    // A row of tick boxes for one choice; tapping the ticked box again clears it.
    const pick = (key, items, after) => {
      const group = tickGroup(items, (v) => state.pages[p][key] === v, (v) => {
        state.pages[p][key] = state.pages[p][key] === v ? '' : v;
        if (after) after(state.pages[p][key]);
        update(true);
      });
      syncers.push(group.sync);
      return group;
    };

    const date = el('span', 'meta-value');
    const driver = el('span', 'meta-value');
    const licence = el('span', 'meta-value');
    const options = tickGroup(HOURS_OPTIONS, (v) => RULESETS[state.ruleset].option === v);
    options.classList.add('hours-options');
    syncers.push(options.sync);
    const dateBox = box('Date', date);
    if (p === MIDDLE) {
      // The middle sheet's date is changeable here; the other sheets follow it.
      const edit = el('span', 'date-edit');
      const input = el('input', 'middle-date-input meta-date');
      input.type = 'date';
      input.setAttribute('aria-label', 'Change the date of the middle sheet');
      watchMiddleDate(input);
      const today = el('button', 'date-today', 'Today');
      today.type = 'button';
      today.id = 'middle-today';
      today.addEventListener('click', () => setMiddleDate(isoDate(new Date())));
      edit.append(input, today);
      dateBox.append(edit);
      dateBox.classList.add('meta-box-date');
    }
    box("Driver's name", driver);
    box('Licence no.', licence);
    const rego = field('rego', 'e.g. XQ12AB', null, 'plate');
    box('Number plate', rego);
    box('Work diary no.', field('diaryNo', 'e.g. QCD 755011', null, 'diary'));
    // The time zone is only recorded on the sheet; it doesn't change any times or checks. Picking
    // one fills it in on the other sheets that have none.
    box('Time zone: state/territory (driver base)', pick('zone', ZONES, (zone) => {
      if (zone) state.pages.forEach((pg) => { if (!pg.zone) pg.zone = zone; });
    })).classList.add('meta-box-wide');
    box('Driver hours option', options).classList.add('meta-box-wide');
    box('Time of daily check (if required)', field('checkTime', 'e.g. 05:45', 'numeric', 'time'));
    sheet.append(meta);

    // The 24-hour graph: hour numbers, a WORK line, a REST line and a line for breaches.
    const scroll = el('div', 'grid-scroll');
    const grid = el('div', 'grid');
    grid.append(el('div', 'corner'));
    HOUR_LABELS.forEach((label, h) => {
      const cell = el('div', 'hour', label);
      if (h === 23) cell.append(el('span', 'hour-end', 'Mid'));
      cell.style.gridColumn = `${2 + h * 4} / span 4`;
      grid.append(cell);
    });
    grid.append(el('div', 'total-head', 'Total hours'));

    const cells = { W: [], R: [], T: [], X: [] };
    const totals = {};
    for (const [row, label] of [['W', 'WORK'], ['R', 'REST'], ['T', 'TWO-UP'], ['X', 'BREACH']]) {
      grid.append(el('div', `row-label row-${row}`, label));
      for (let q = 0; q < SLOTS_PER_DAY; q++) {
        const cell = el('div', `cell row-${row}${q % 4 === 0 ? ' hour-start' : ''}${q % 4 === 2 ? ' half' : ''}`);
        const i = p * SLOTS_PER_DAY + q;
        cell.dataset.i = i;
        cell.dataset.row = row;
        cells[row].push(cell);
        grid.append(cell);
      }
      totals[row] = el('div', `total row-${row}`);
      grid.append(totals[row]);
    }
    scroll.append(grid);
    sheet.append(scroll);
    attachPainting(grid);


    // Rest and work changes, like the table under the graph in the diary.
    const changesWrap = el('div', 'changes');
    changesWrap.append(el('h3', null, 'Rest / work changes'));
    const changesTable = el('table');
    changesTable.innerHTML = '<thead><tr><th>Time</th><th>Change</th><th>Location</th><th>Odometer</th></tr></thead>';
    const changesBody = el('tbody');
    changesTable.append(changesBody);
    const changesScroll = el('div', 'table-scroll');
    changesScroll.append(changesTable);
    changesWrap.append(changesScroll);
    sheet.append(changesWrap);

    const notes = el('div', 'sheet-notes');
    const comments = el('label', 'notes-field');
    comments.append(el('span', 'meta-label', 'Number plate change and comments (optional)'), field('comments', 'e.g. delays, authorised officer notes', null, 'comments'));
    notes.append(comments);
    sheet.append(notes);

    // Two-up driver identification, as at the foot of a diary daily sheet.
    const pair = el('div', 'two-up-id');
    pair.append(el('div', 'two-up-title', 'TWO-UP DRIVER IDENTIFICATION'));
    const pairGrid = el('div', 'sheet-meta two-up-meta');
    const pairBox = (label, content) => {
      const b = el('div', 'meta-box');
      b.append(el('span', 'meta-label', label), content);
      pairGrid.append(b);
      return b;
    };
    pairBox("Two-up driver's name", field('twoUp', 'Optional', null, 'name'));
    pairBox("Two-up driver's licence no.", field('twoUpLicence', 'Optional', null, 'licence'));
    pairBox('Two-up driver hours option', pick('twoUpOption', TWO_UP_OPTIONS)).classList.add('meta-box-wide');
    pairBox("Two-up driver's work diary & page no.", field('twoUpDiary', 'e.g. QCD 755008 / 23', null, 'diaryPage'));
    pairBox("Two-up driver's licence issued", pick('twoUpIssued', ZONES)).classList.add('meta-box-wide');
    pair.append(pairGrid);
    sheet.append(pair);

    const breaches = el('div', 'sheet-breaches');
    sheet.append(breaches);

    $('#sheets').append(sheet);
    sheets.push({ sheet, date, driver, licence, cells, totals, changesBody, breaches, sync: () => syncers.forEach((f) => f()) });
  }

  // ---- Entering time ------------------------------------------------------------------------

  let drag = null;

  function cellAt(x, y, grid) {
    const target = document.elementFromPoint(x, y);
    const cell = target && target.closest('.cell');
    return cell && grid.contains(cell) ? cell : null;
  }

  function attachPainting(grid) {
    grid.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || cell.dataset.row === 'X' || e.button > 0) return;
      e.preventDefault();
      const i = Number(cell.dataset.i);
      if (cell.dataset.row === 'T') {
        // The TWO-UP line: dragging from an empty box draws, from a marked box rubs out.
        drag = { grid, last: i, pair: state.pair[i] ? 0 : 1 };
        paintPair(i, i);
      } else {
        drag = { grid, last: i };
        paint(i, i, cell.dataset.row);
      }
      grid.setPointerCapture(e.pointerId);
    });
    // The row under the finger decides: the WORK row marks work, the REST row marks rest.
    grid.addEventListener('pointermove', (e) => {
      if (!drag || drag.grid !== grid) return;
      const cell = cellAt(e.clientX, e.clientY, grid);
      if (!cell || cell.dataset.row === 'X') return;
      const i = Number(cell.dataset.i);
      if (drag.pair != null) {
        paintPair(Math.min(i, drag.last), Math.max(i, drag.last));
      } else if (cell.dataset.row !== 'T') {
        paint(Math.min(i, drag.last), Math.max(i, drag.last), cell.dataset.row);
      } else {
        return;
      }
      drag.last = i;
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      update(true);
    };
    grid.addEventListener('pointerup', end);
    grid.addEventListener('pointercancel', end);
    grid.addEventListener('lostpointercapture', end);

    // Tapping a red BREACH bar explains it; tapping it again closes the explanation.
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell.row-X');
      if (!cell) return;
      const n = breachAt.get(Number(cell.dataset.i));
      if (n == null) return;
      const b = result.breaches[n];
      selectBreach(selectedKey === breachKey(b) ? null : b);
    });
  }

  function paintPair(from, to) {
    for (let i = from; i <= to; i++) state.pair[i] = drag.pair;
    update(false);
  }

  function paint(from, to, value) {
    let changed = false;
    for (let i = from; i <= to; i++) {
      if (state.slots[i] !== value) changed = true;
      state.slots[i] = value;
    }
    if (!changed) return;
    state.example = false;
    update(false);
  }

  // ---- The day before -----------------------------------------------------------------------

  let syncDayBeforeToggle = () => {};

  // Only needed when work ran overnight into the first sheet: with its times, every rule is
  // checked across that midnight. Removing it clears its entries, so nothing hidden is counted.
  function buildDayBeforeToggle() {
    const bar = el('div', 'day-before-bar');
    const button = el('button', 'day-before-toggle');
    button.type = 'button';
    button.id = 'day-before-toggle';
    const note = el('span', 'day-before-note');
    bar.append(button, note);
    $('#sheets').prepend(bar);
    syncDayBeforeToggle = () => {
      button.textContent = state.showDayBefore ? 'Remove the day before' : 'Show the day before';
      note.textContent = state.showDayBefore
        ? 'It counts as the first of the "Sheets to include" in Work before these sheets.'
        : 'Only needed if you worked late on the day before the first sheet. Without it, that day counts as rest.';
    };
    confirmButton(button, 'Tap again to remove it', () => state.showDayBefore && state.slots
      .some((v, i) => i < FIRST * SLOTS_PER_DAY && v !== 'R'), () => {
      if (state.showDayBefore) {
        for (let i = 0; i < FIRST * SLOTS_PER_DAY; i++) {
          state.slots[i] = 'R';
          delete state.changes[i];
        }
      }
      state.showDayBefore = !state.showDayBefore;
      syncDayBeforeToggle();
      update(true);
    });
    syncDayBeforeToggle();
  }

  // ---- Example ------------------------------------------------------------------------------

  function loadExample() {
    const slots = new Array(N).fill('R');
    const set = (day, from, to, v) => {
      for (let i = day * SLOTS_PER_DAY + H(from); i < day * SLOTS_PER_DAY + H(to); i++) slots[i] = v;
    };
    const days = [
      [[0, 5, 'R'], [5, 10.75, 'W'], [10.75, 11.25, 'R'], [11.25, 15.5, 'W'], [15.5, 16, 'R'], [16, 18, 'W'], [18, 24, 'R']],
      [[0, 3, 'R'], [3, 8, 'W'], [8, 8.5, 'R'], [8.5, 13, 'W'], [13, 13.25, 'R'], [13.25, 17.75, 'W'], [17.75, 23, 'R'], [23, 24, 'W']],
      [[0, 4, 'W'], [4, 4.5, 'R'], [4.5, 9, 'W'], [9, 18, 'R'], [18, 21, 'W'], [21, 24, 'R']],
    ];
    days.forEach((entries, d) => entries.forEach(([from, to, v]) => set(d + FIRST, from, to, v)));
    state.slots = slots;
    state.changes = {};
    state.prior = {};
    state.history = defaultState().history;
    state.example = true;
    clearEarlierBoxes();
    update(true);
  }

  // ---- Rendering ----------------------------------------------------------------------------

  let pendingFrame = 0;

  // full: also rebuild the change tables and save. Painting skips that until the drag ends.
  function update(full) {
    if (full) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
      render(true);
      save();
    } else if (!pendingFrame) {
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        render(false);
      });
    }
  }

  function render(full) {
    result = check(recordSlots(), state.ruleset, { fmtTime, prior: priorSlots(), history: historyOpts(), ...priorOpts() });
    const ruleset = RULESETS[state.ruleset];
    const breachSlots = new Map();
    result.breaches.forEach((b, n) => b.slots.forEach((i) => breachSlots.set(i, n)));
    breachAt = breachSlots;

    sheets.forEach((s, p) => {
      const base = p * SLOTS_PER_DAY;
      let work = 0;
      let rest = 0;
      for (let q = 0; q < SLOTS_PER_DAY; q++) {
        const i = base + q;
        const v = state.slots[i];
        const prev = i > 0 ? state.slots[i - 1] : null;
        if (v === 'W') work++;
        else rest++;
        const line = LINES.indexOf(v);
        const before = prev == null ? line : LINES.indexOf(prev);
        LINES.forEach((row, r) => {
          const c = s.cells[row][q];
          const on = r === line;
          c.classList.toggle('on', on);
          // Where the line steps to another line, a vertical pen stroke at the left edge of this
          // block: half on the line it leaves, half on the line it reaches, and right through the
          // middle line if it jumps over one.
          c.classList.toggle('arrive-up', on && before < line);
          c.classList.toggle('arrive-down', on && before > line);
          c.classList.toggle('leave-up', !on && r === before && line < before);
          c.classList.toggle('leave-down', !on && r === before && line > before);
          c.classList.toggle('pass', !on && r > Math.min(before, line) && r < Math.max(before, line));
          c.classList.toggle('breach', on && row === 'W' && breachSlots.has(i));
          c.classList.toggle('longnight', on && row === 'W' && result.longNight.has(i));
          c.title = `${fmtTime(i)}–${clock(i + 1)}`;
        });
        // TWO-UP line, with an upright bar where each stretch starts and ends.
        const pair = !!state.pair[i];
        const tc = s.cells.T[q];
        tc.classList.toggle('on', pair);
        tc.classList.toggle('t-start', pair && !(i > 0 && state.pair[i - 1]));
        tc.classList.toggle('t-end', pair && !(i < N - 1 && state.pair[i + 1]));
        tc.title = `${fmtTime(i)}–${clock(i + 1)} two-up`;
        const x = s.cells.X[q];
        const n = breachSlots.get(i);
        x.classList.toggle('on', n != null);
        x.title = n != null ? result.breaches[n].message : '';
      }
      s.totals.W.textContent = formatHours(work);
      s.totals.R.textContent = formatHours(rest);
      let paired = 0;
      for (let q = 0; q < SLOTS_PER_DAY; q++) if (state.pair[base + q]) paired++;
      s.totals.T.textContent = paired ? formatHours(paired) : '';
      const pageBreaches = result.breaches.filter((b) => Math.floor(b.slots[0] / SLOTS_PER_DAY) === p);
      s.totals.X.textContent = pageBreaches.length ? String(pageBreaches.length) : '';
      s.sheet.classList.toggle('has-breach', pageBreaches.length > 0);

      if (!full) return;
      s.sheet.hidden = (p < FIRST && !state.showDayBefore) || p * SLOTS_PER_DAY >= recordEnd();
      s.date.textContent = formatDate(pageDate(p), true);
      if (p === MIDDLE) syncMiddleDate();
      s.driver.textContent = state.driver || '—';
      s.licence.textContent = state.licence || '—';
      s.sync();
      renderChanges(s, p);
      renderSheetBreaches(s, pageBreaches);
    });

    if (full) {
      renderEarlier();
      renderRestBefore();
      renderSummary();
      renderLimits(ruleset);
      renderPlanner();
      buildPrintSheets();
      checkOdometerOrder();
      // Checks on boxes added in this render are attached just after it, so count then.
      queueMicrotask(showInputIssues);
    }
    markNow();
    applySelection();
  }

  // ---- Time now and next limits -------------------------------------------------------------

  function markNow() {
    const now = nowIndex();
    const start = planStart();
    const picked = start.custom ? start.from : -1;
    sheets.forEach((s, p) => {
      for (const row of ['W', 'R', 'X']) {
        s.cells[row].forEach((c, q) => {
          c.classList.toggle('now', p * SLOTS_PER_DAY + q === now);
          c.classList.toggle('plan-start', p * SLOTS_PER_DAY + q === picked);
        });
      }
    });
  }

  // Where "Your next limits" starts: the day and time the driver picked, or the time now.
  function planStart() {
    if (state.planFrom) {
      const day = sheetPages().find((p) => isoDate(pageDate(p)) === state.planFrom.date);
      const [hh, mm] = String(state.planFrom.time).split(':').map(Number);
      if (day != null && Number.isInteger(hh) && Number.isInteger(mm)) {
        return { from: day * SLOTS_PER_DAY + Math.floor((hh * 60 + mm) / SLOT_MINUTES), custom: true };
      }
    }
    return { from: nowIndex(), custom: false };
  }

  // A dropdown of times rather than the browser's time picker, which some phone browsers only
  // report changes from when it closes, and draws differently everywhere.
  function buildPlanControls() {
    const day = $('#plan-day');
    const time = $('#plan-time');
    for (let q = 0; q < SLOTS_PER_DAY; q++) {
      const opt = el('option', null, clock(q));
      opt.value = clock(q);
      time.append(opt);
    }
    const pick = () => {
      state.planFrom = { date: day.value, time: time.value };
      update(true);
    };
    for (const select of [day, time]) select.addEventListener('change', pick);

    const step = (delta) => {
      const { from } = planStart();
      const start = from >= 0 ? from : MIDDLE * SLOTS_PER_DAY;
      const i = Math.min(recordEnd() - 1, Math.max(FIRST * SLOTS_PER_DAY, start + delta));
      state.planFrom = { date: isoDate(pageDate(Math.floor(i / SLOTS_PER_DAY))), time: clock(i) };
      update(true);
    };
    $('#plan-earlier').addEventListener('click', () => step(-1));
    $('#plan-later').addEventListener('click', () => step(1));

    $('#plan-now').addEventListener('click', () => {
      state.planFrom = null;
      update(true);
    });
  }

  // Keeps the day and time pickers showing where the plan starts.
  function syncPlanControls(from, custom) {
    const day = $('#plan-day');
    const time = $('#plan-time');
    const todayIso = isoDate(new Date());
    day.replaceChildren(...sheetPages().map((p) => {
      const iso = isoDate(pageDate(p));
      const opt = el('option', null, `${formatDate(pageDate(p))}${iso === todayIso ? ' (today)' : ''}`);
      opt.value = iso;
      return opt;
    }));
    const page = from >= FIRST * SLOTS_PER_DAY ? Math.floor(from / SLOTS_PER_DAY) : MIDDLE;
    day.value = isoDate(pageDate(page));
    if (from >= 0 && document.activeElement !== time) time.value = clock(from);
    const now = $('#plan-now');
    now.setAttribute('aria-pressed', String(!custom));
    now.classList.toggle('active', !custom);
  }

  function planAction(item, custom) {
    const { rule, kind } = item;
    const d = describeRule(rule);
    if (item.overNow) {
      return [custom ? 'Rest first' : 'Rest now', `You are over this limit${custom ? ' at that time' : ''}. ${d.period}: ${d.work.toLowerCase()}.`];
    }
    if (kind === 'rest' || kind === 'night') return ['Start your rest', `${d.period}: ${d.rest}.`];
    if (kind === 'longnight') return ['Long/night work limit', `${d.period}: ${d.work.toLowerCase()}.`];
    if (kind === 'between') return ['Stop for a 24-hour rest', `${d.period}: ${d.work.toLowerCase()}.`];
    if (rule.period < H(24)) return ['Take a break', `${d.period}: ${d.work.toLowerCase()}. ${d.rest} resets it.`];
    if (rule.period === H(24)) return ['Stop work for the day', `${d.period}: ${d.work.toLowerCase()}.`];
    return ['Weekly work limit', `${d.period}: ${d.work.toLowerCase()}.`];
  }

  function renderPlanner() {
    const lead = $('#planner-lead');
    const list = $('#planner-list');
    const { from, custom } = planStart();
    syncPlanControls(from, custom);
    if (from < 0) {
      lead.textContent = "Today isn't on the sheets. Pick a start day and time above, or set the middle sheet to today's date.";
      list.replaceChildren();
      return;
    }
    const now = new Date();
    const working = state.slots[from] === 'W';
    if (custom) {
      lead.textContent = `From ${fmtTime(from)}${working ? ', where you are marked on work' : ''}, if you work without a break:`;
    } else {
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      lead.textContent = `It's ${time}${working ? ' and you are on work' : ''}. If you work from now without a break:`;
    }
    const startPage = Math.floor(from / SLOTS_PER_DAY);
    const duration = (minutes) => (minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`);
    // From the time now, count down; from a picked time, say how long after the start.
    const whenText = (i, base) => {
      const page = Math.floor(i / SLOTS_PER_DAY);
      const left = custom
        ? `after ${duration((i - base) * SLOT_MINUTES)}`
        : `in ${duration(Math.max(0, Math.round((slotDate(i) - now) / 60000)))}`;
      return `${page !== startPage ? `${formatDate(pageDate(page))} · ` : ''}${left}`;
    };
    const row = (cls, time, sub, action, detail) => {
      const li = el('li', `plan-item ${cls}`);
      const when = el('div', 'plan-when');
      when.append(el('strong', 'plan-time', time));
      if (sub) when.append(el('span', 'plan-left', sub));
      const text = el('div', 'plan-text');
      text.append(el('strong', null, action), el('span', null, detail));
      li.append(when, text);
      return li;
    };

    let slots = recordSlots();
    let base = from;
    const opts = { prior: priorSlots(), history: historyOpts(), ...priorOpts() };
    let items = plan(slots, state.ruleset, from, opts);
    const rows = [];

    // If no more work is allowed at the start time, say when it is, then plan from there.
    if (items.length && items[0].stopAt === from) {
      const blocker = items[0];
      const d = describeRule(blocker.rule);
      const limit = blocker.kind === 'rest' || blocker.kind === 'night' ? d.rest : d.work.toLowerCase();
      const reason = `${d.period}: ${limit}.`;
      const resume = earliestStart(slots, state.ruleset, from, opts);
      if (resume < 0) {
        rows.push(row('over first', custom ? clock(from) : 'Now', '', blocker.overNow ? 'Over the limit: rest' : 'Rest',
          `No more work is allowed before the end of the last sheet. ${reason}`));
        list.replaceChildren(...rows);
        return;
      }
      const day = Math.floor(resume / SLOTS_PER_DAY) !== startPage ? ` on ${formatDate(pageDate(Math.floor(resume / SLOTS_PER_DAY)))}` : '';
      rows.push(row('over first', clock(resume), whenText(resume, from),
        blocker.overNow ? `Over the limit: rest until ${clock(resume)}` : `Rest until ${clock(resume)}`,
        `You can't start work again until ${clock(resume)}${day}. ${reason}`));
      slots = slots.map((v, i) => (i >= from && i < resume ? 'R' : v));
      base = resume;
      items = plan(slots, state.ruleset, resume, opts);
      if (items.length) rows.push(el('li', 'plan-then', `Then, if you work from ${clock(resume)} without a break:`));
    }

    if (!rows.length && !items.length) {
      list.replaceChildren(el('li', 'plan-item plan-clear', 'No limit is reached before the end of the last sheet.'));
      return;
    }
    items.forEach((item, k) => {
      const [action, detail] = planAction(item, custom);
      const first = !rows.length && k === 0;
      rows.push(item.overNow
        ? row(`over${first ? ' first' : ''}`, custom ? clock(base) : 'Now', '', action, detail)
        : row(first ? 'first' : '', clock(item.stopAt), whenText(item.stopAt, base), action, detail));
    });
    list.replaceChildren(...rows);
  }

  // ---- Explaining a breach ------------------------------------------------------------------

  function breachKey(b) {
    return `${b.ruleId}|${b.kind}|${b.start}`;
  }

  function breachWindow(b) {
    const start = b.start != null ? b.start : b.slots[0];
    const end = b.end != null ? b.end : b.slots[b.slots.length - 1] + 1;
    return [start, end];
  }

  function selectBreach(b, reveal) {
    selectedKey = b ? breachKey(b) : null;
    applySelection();
    if (b && reveal) {
      // A breach entirely before the sheets has no blocks of its own; show the first sheet.
      const i = b.slots.length ? b.slots[0] : FIRST * SLOTS_PER_DAY;
      const cell = sheets[Math.floor(i / SLOTS_PER_DAY)].cells.X[i % SLOTS_PER_DAY];
      cell.scrollIntoView({ block: 'center', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }

  function applySelection() {
    const n = selectedKey ? result.breaches.findIndex((b) => breachKey(b) === selectedKey) : -1;
    const b = n >= 0 ? result.breaches[n] : null;
    if (!b) selectedKey = null;
    const [from, to] = b ? breachWindow(b) : [-1, -1];
    const own = new Set(b ? b.slots : []);
    sheets.forEach((s, p) => {
      for (const row of ['W', 'R', 'X']) {
        s.cells[row].forEach((c, q) => {
          const i = p * SLOTS_PER_DAY + q;
          const inside = i >= from && i < to;
          c.classList.toggle('in-window', inside);
          c.classList.toggle('win-first', inside && i === from);
          c.classList.toggle('win-last', inside && i === to - 1);
          c.classList.toggle('selected', own.has(i));
        });
      }
    });
    document.querySelectorAll('.breach-item').forEach((li) => li.classList.toggle('selected', li.dataset.key === selectedKey));

    const panel = $('#breach-detail');
    panel.hidden = !b;
    document.body.classList.toggle('detail-open', !!b);
    if (!b) return;
    const rule = RULESETS[state.ruleset].rules.find((r) => r.id === b.ruleId);
    const d = describeRule(rule);
    const tag = $('#detail-tag');
    tag.className = `severity${b.severity ? ` sev-${b.severity}` : ''}`;
    tag.textContent = severityLabel(b);
    $('#detail-title').textContent = b.ruleLabel;
    $('#detail-message').textContent = b.message;
    $('#detail-period').textContent = `${fmtTime(from)} to ${fmtTime(to)}`;
    $('#detail-limit').textContent = [d.work, d.rest].filter((t) => t && t !== '—').join('. ');
    $('#detail-count').textContent = `${n + 1} of ${result.breaches.length}`;
    $('#detail-prev').disabled = n === 0;
    $('#detail-next').disabled = n === result.breaches.length - 1;
  }

  function buildDetail() {
    $('#detail-close').addEventListener('click', () => selectBreach(null));
    const step = (delta) => {
      const n = result.breaches.findIndex((b) => breachKey(b) === selectedKey);
      const b = result.breaches[n + delta];
      if (b) selectBreach(b, true);
    };
    $('#detail-prev').addEventListener('click', () => step(-1));
    $('#detail-next').addEventListener('click', () => step(1));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && selectedKey) selectBreach(null);
    });
  }

  function formatHours(slots) {
    const hours = (slots * SLOT_MINUTES) / 60;
    return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0$/, '');
  }

  function renderChanges(s, p) {
    const rows = [];
    for (let q = 0; q < SLOTS_PER_DAY; q++) {
      const i = p * SLOTS_PER_DAY + q;
      const v = state.slots[i];
      const prev = i > 0 ? state.slots[i - 1] : null;
      if (v && v !== prev) rows.push([i, v === 'W' ? 'Start work' : 'Start rest']);
      else if (!v && prev && q > 0) rows.push([i, prev === 'W' ? 'End work' : 'End rest']);
    }
    if (!rows.length) {
      const tr = el('tr', 'empty');
      const td = el('td', null, 'Changes appear here as you mark time on the graph.');
      td.colSpan = 4;
      tr.append(td);
      s.changesBody.replaceChildren(tr);
      return;
    }
    s.changesBody.replaceChildren(...rows.map(([i, label]) => {
      const tr = el('tr', label === 'Start work' ? 'to-work' : '');
      tr.append(el('td', 'time', clock(i)), el('td', null, label));
      for (const field of ['location', 'odometer']) {
        const td = el('td');
        const input = el('input', 'change-input');
        input.value = (state.changes[i] && state.changes[i][field]) || '';
        input.setAttribute('aria-label', `${field} at ${clock(i)}`);
        if (field === 'odometer') input.inputMode = 'numeric';
        input.dataset.slot = i;
        const keep = (v) => {
          state.changes[i] = { ...state.changes[i], [field]: v };
          save();
          if (field === 'odometer') checkOdometerOrder();
        };
        input.addEventListener('input', () => keep(input.value));
        td.append(input);
        attachCheck(input, field === 'odometer' ? 'odometer' : 'place', keep);
        if (field === 'odometer') {
          const warn = el('span', 'field-warning');
          warn.hidden = true;
          td.append(warn);
        }
        tr.append(td);
      }
      return tr;
    }));
  }

  function severityLabel(b) {
    return b.severity ? `${b.escalated ? 'escalated ' : ''}${b.severity} risk` : 'breach';
  }

  // Each breach in a list can be tapped to show it on the sheets.
  function breachItem(b) {
    const li = el('li', 'breach-item');
    li.dataset.key = breachKey(b);
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    const tag = el('span', `severity${b.severity ? ` sev-${b.severity}` : ''}`, severityLabel(b));
    li.append(tag, el('strong', null, `${b.ruleLabel}: `), document.createTextNode(b.message));
    const open = () => selectBreach(selectedKey === breachKey(b) ? null : b, true);
    li.addEventListener('click', open);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    return li;
  }

  function renderSheetBreaches(s, list) {
    if (!list.length) {
      s.breaches.replaceChildren();
      return;
    }
    const ul = el('ul');
    ul.append(...list.map(breachItem));
    s.breaches.replaceChildren(el('h3', null, `Breaches found on this sheet (${list.length})`), ul);
  }

  function renderSummary() {
    const box = $('#summary');
    const hasWork = state.slots.includes('W');
    box.className = 'summary';
    if (!hasWork && !result.breaches.length) {
      box.replaceChildren(el('p', 'summary-title', 'Mark work time on the sheets to check it.'));
      return;
    }
    const count = result.breaches.length;
    box.classList.add(count ? 'bad' : 'good');
    const title = el('p', 'summary-title', count
      ? `${count} breach${count === 1 ? '' : 'es'} found under ${RULESETS[state.ruleset].name}`
      : `No breaches found under ${RULESETS[state.ruleset].name}`);
    const parts = [title];
    if (state.example) parts.push(el('p', 'facts', 'These are example entries. Clear all to enter your own.'));
    if (count) {
      const ul = el('ul');
      ul.append(...result.breaches.map(breachItem));
      parts.push(ul);
    }
    const total = state.slots.filter((v, i) => v === 'W' && i >= FIRST * SLOTS_PER_DAY && i < recordEnd()).length;
    const facts = [`Total work across the ${MAIN_SHEETS + extraSheets()} sheets: ${formatDuration(total)}.`];
    const before = state.slots.filter((v, i) => v === 'W' && i < FIRST * SLOTS_PER_DAY).length;
    if (before) facts.push(`Work on the day before: ${formatDuration(before)}.`);
    if (result.longNight.size) facts.push(`Long/night work: ${formatDuration(result.longNight.size)}.`);
    const prior = priorSlots();
    for (const rule of RULESETS[state.ruleset].rules) {
      const key = priorKey(rule);
      if (key && prior[key] != null) {
        const days = rule.period / SLOTS_PER_DAY;
        facts.push(`${rule.maxLongNight != null ? 'Long/night work' : 'Work'} in the ${days - priorSheets()} days before: ${formatDuration(prior[key])}, checked with ${sheetsText()} against the ${days}-day limit.`);
      }
    }
    parts.push(el('p', 'facts', facts.join(' ')));
    if (result.notes.length) {
      const notes = el('ul', 'notes');
      notes.append(...result.notes.map((n) => el('li', null, n)));
      parts.push(notes);
    }
    box.replaceChildren(...parts);
  }

  // ---- Work before the sheets --------------------------------------------------------------

  // Hours as typed: "38", "38.5", "38,5" or "38:30". Work rounds up to the next 15 minutes, as in
  // a written work diary. Null for an empty box, NaN for something that isn't hours.
  // Whole hours only. Null for an empty box, NaN for anything else.
  // Hours in quarter hours: whole hours, or ending in .25, .5, .50 or .75. Null for an empty box,
  // NaN for anything else. Returned in 15-minute slots.
  const QUARTER_HOURS = /^(?:\d+(?:\.(?:25|5|50|75))?|\.(?:25|5|50|75))$/;
  const QUARTER_HELP = 'Enter hours in quarter hours, like 38, 38.25, 38.5 or 38.75';
  function parseHours(text, maxHours) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (!QUARTER_HOURS.test(t) || Number(t) > maxHours) return NaN;
    return Math.round(Number(t) * (60 / SLOT_MINUTES));
  }

  // The rules of the current work option that take an earlier total.
  function priorRules() {
    return RULESETS[state.ruleset].rules.filter((rule) => priorKey(rule));
  }

  function priorSlots() {
    const out = {};
    for (const rule of priorRules()) {
      const key = priorKey(rule);
      const days = rule.period / SLOTS_PER_DAY - priorSheets();
      const slots = parseHours(state.prior[key], days * 24);
      if (slots != null && !Number.isNaN(slots)) out[key] = slots;
    }
    return out;
  }

  let earlierBuiltFor = '';

  // The boxes are only rebuilt when the work option or dates change, so reset them directly.
  function clearEarlierBoxes() {
    document.querySelectorAll('#earlier-fields input, #rest-fields input').forEach((input) => {
      input.value = '';
    });
    document.querySelectorAll('#rest-fields select').forEach((select) => {
      select.value = '';
    });
    document.querySelectorAll('#rest-fields input[type=checkbox]').forEach((box) => {
      box.checked = false;
    });
  }

  // ---- Rest before the sheets ---------------------------------------------------------------

  // Which questions the current work option needs.
  function restQuestions() {
    const rules = RULESETS[state.ruleset].rules;
    const days = (rule) => rule.period / SLOTS_PER_DAY;
    return {
      lastRest: rules.some((r) => (r.restBlocks && r.restBlocks.count === 1 && r.restBlocks.length >= H(24) &&
        r.period === 7 * SLOTS_PER_DAY) || r.betweenRests),
      workSince: rules.some((r) => r.betweenRests),
      nights: rules.filter((r) => r.nightRests && r.period >= 7 * SLOTS_PER_DAY),
      longRests: rules.filter((r) => r.restBlocks && r.restBlocks.count > 1 && r.restBlocks.length >= H(24)),
      days,
    };
  }

  // The answers in the form the rules engine takes. Blank answers are left out.
  function historyOpts() {
    const h = state.history;
    const q = restQuestions();
    const out = {};
    if (q.lastRest && h.lastRestDay && h.lastRestTime) {
      const day = Math.round((new Date(`${h.lastRestDay}T00:00`) - pageDate(0)) / 86400000);
      const [hh, mm] = h.lastRestTime.split(':').map(Number);
      out.lastLongRestEnd = day * SLOTS_PER_DAY + Math.floor((hh * 60 + mm) / SLOT_MINUTES);
    }
    if (q.workSince && out.lastLongRestEnd != null) {
      const since = parseHours(h.workSince, 28 * 24);
      if (since != null && !Number.isNaN(since)) out.workSinceLongRest = since;
    }
    const nights = {};
    for (const rule of q.nights) {
      const key = `night-${q.days(rule)}`;
      const a = h.nights[key];
      if (a && a.count !== '' && a.count != null) nights[key] = { count: Number(a.count), consecutive: !!a.consecutive };
    }
    if (Object.keys(nights).length) out.nights = nights;
    if (h.nightBefore) out.nightBefore = h.nightBefore === 'yes';
    // The night into the first sheet counted is never on the sheets: it is before them.
    out.dayBeforeRecorded = false;
    const longRests = {};
    for (const rule of q.longRests) {
      const key = `long-${q.days(rule)}`;
      if (h.longRests[key] !== '' && h.longRests[key] != null) longRests[key] = Number(h.longRests[key]);
    }
    if (Object.keys(longRests).length) out.longRests = longRests;
    return out;
  }

  function setHistory(change) {
    state.history = { ...state.history, ...change };
    update(true);
  }

  function selectOf(id, label, options, value, onChange) {
    const select = el('select');
    select.id = id;
    select.setAttribute('aria-label', label);
    select.append(...options.map(([v, text]) => {
      const opt = el('option', null, text);
      opt.value = v;
      return opt;
    }));
    select.value = value || '';
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  let restBuiltFor = '';

  function renderRestBefore() {
    const q = restQuestions();
    const wrap = $('#rest-before');
    const fields = $('#rest-fields');
    const any = q.lastRest || q.nights.length || q.longRests.length;
    wrap.hidden = !any;
    const signature = `${state.ruleset}|${state.startDate}|${state.showDayBefore}|${priorSheets()}`;
    if (signature === restBuiltFor) {
      syncRestFields();
      return;
    }
    restBuiltFor = signature;
    const h = state.history;
    const out = [];
    const field = (labelText, help, ...controls) => {
      const f = el('div', 'earlier-field');
      f.append(el('span', 'earlier-label', labelText));
      if (help) f.append(el('span', 'earlier-dates', help));
      const row = el('span', 'earlier-input');
      row.append(...controls);
      f.append(row);
      return f;
    };

    if (q.lastRest) {
      // Any day from 4 weeks before the first sheet up to the middle sheet.
      const days = [['', 'Not entered']];
      for (let p = FIRST - 27; p <= MIDDLE; p++) days.push([isoDate(pageDate(p)), formatDate(pageDate(p))]);
      const times = [['', '—']];
      for (let k = 0; k < SLOTS_PER_DAY; k++) times.push([clock(k), clock(k)]);
      out.push(field('When your last 24-hour rest ended', 'The end of your most recent 24 continuous hours of stationary rest before the sheets.',
        selectOf('rest-last-day', 'Day your last 24-hour rest ended', days, h.lastRestDay, (v) => setHistory({ lastRestDay: v, lastRestTime: h.lastRestTime || (v ? '06:00' : '') })),
        selectOf('rest-last-time', 'Time your last 24-hour rest ended', times, h.lastRestTime, (v) => setHistory({ lastRestTime: v }))));
    }
    if (q.workSince) {
      const input = el('input');
      input.id = 'rest-work-since';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.placeholder = 'e.g. 40';
      input.value = h.workSince || '';
      input.addEventListener('input', () => setHistory({ workSince: input.value }));
      out.push(field(`Work since then, before ${SHEET_NAMES[firstCounted()]}`, 'For the 84 hours between 24-hour rests. Needs the date above. In quarter hours, rounded up.', input, el('span', null, 'hours')));
      attachCheck(input, 'hoursSince');
    }
    for (const rule of q.longRests) {
      const days = q.days(rule);
      const key = `long-${days}`;
      const before = days - priorSheets();
      const counts = [['', 'Not entered']];
      for (let c = 0; c <= rule.restBlocks.count; c++) counts.push([String(c), String(c)]);
      out.push(field(`24-hour rests in the ${before} days before`, `${formatDate(pageDate(firstCounted() - before))} to ${formatDate(pageDate(firstCounted() - 1))} · for the ${days}-day rule (${rule.restText.toLowerCase()})`,
        selectOf(`rest-${key}`, `24-hour rests in the ${before} days before`, counts, h.longRests[key] == null ? '' : String(h.longRests[key]),
          (v) => setHistory({ longRests: { ...state.history.longRests, [key]: v } }))));
    }
    for (const rule of q.nights) {
      const days = q.days(rule);
      const key = `night-${days}`;
      const before = days - priorSheets();
      const a = h.nights[key] || {};
      const counts = [['', 'Not entered']];
      for (let c = 0; c <= before; c++) counts.push([String(c), String(c)]);
      const controls = [selectOf(`rest-${key}`, `Night rest breaks in the ${before} days before`, counts, a.count == null ? '' : String(a.count),
        (v) => setHistory({ nights: { ...state.history.nights, [key]: { ...state.history.nights[key], count: v } } }))];
      if (rule.nightRests.consecutive) {
        const label = el('label', 'earlier-check');
        const box = el('input');
        box.type = 'checkbox';
        box.id = `rest-${key}-consecutive`;
        box.checked = !!a.consecutive;
        box.addEventListener('change', () => setHistory({ nights: { ...state.history.nights, [key]: { ...state.history.nights[key], consecutive: box.checked } } }));
        label.append(box, document.createTextNode(' 2 of them on consecutive nights'));
        controls.push(label);
      }
      out.push(field(`Night rest breaks in the ${before} days before`,
        `${formatDate(pageDate(firstCounted() - before))} to ${formatDate(pageDate(firstCounted() - 1))}, counting the night into ${SHEET_NAMES[firstCounted()]} · for the ${days}-day rule (${rule.restText.toLowerCase()})`,
        ...controls));
    }
    if (q.nights.some((r) => r.nightRests.consecutive)) {
      out.push(field(`Was the night into ${SHEET_NAMES[firstCounted()]} a night rest break?`, 'At least 7 hours stationary rest between 10pm and 8am. It can pair with a night rest break on the sheets.',
        selectOf('rest-night-before', 'Night into the first sheet', [['', 'Not entered'], ['yes', 'Yes'], ['no', 'No']], h.nightBefore,
          (v) => setHistory({ nightBefore: v }))));
    }
    fields.replaceChildren(...out);
  }

  // Shows the stored answers in the dropdowns, except one the driver is using right now.
  function syncRestFields() {
    const h = state.history;
    const set = (id, value) => {
      const node = document.getElementById(id);
      if (node && document.activeElement !== node) node.value = value == null ? '' : String(value);
    };
    set('rest-last-day', h.lastRestDay);
    set('rest-last-time', h.lastRestTime);
    for (const [key, a] of Object.entries(h.nights || {})) set(`rest-${key}`, a && a.count);
    for (const [key, v] of Object.entries(h.longRests || {})) set(`rest-${key}`, v);
    set('rest-night-before', h.nightBefore);
  }

  // How many sheets go with the totals: 1, 2 or 3. The days before change to suit.
  function buildPriorChoice() {
    const group = $('#prior-sheets');
    group.replaceChildren(...[1, 2, 3].map((k) => {
      const b = el('button', 'prior-choice');
      b.type = 'button';
      b.dataset.sheets = String(k);
      b.textContent = ['1 sheet', '2 sheets', '3 sheets'][k - 1];
      b.addEventListener('click', () => {
        state.priorSheets = k;
        update(true);
      });
      return b;
    }));
  }

  function syncPriorChoice() {
    document.querySelectorAll('.prior-choice').forEach((b) => {
      const on = Number(b.dataset.sheets) === priorSheets();
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const k = priorSheets();
    $('#prior-sheets-help').textContent = `The dates below plus ${sheetsText()} make up each period, ending with ${priorEndName()} (${formatDate(pageDate(firstCounted() + k - 1))}).`;
  }

  // Rebuilt only when the work option or dates change, so typing in a box keeps its focus.
  function renderEarlier() {
    const section = $('#earlier');
    const fields = $('#earlier-fields');
    const rules = priorRules();
    section.hidden = !rules.length;
    syncPriorChoice();
    const signature = `${state.ruleset}|${state.startDate}|${priorSheets()}|${state.showDayBefore}`;
    if (signature !== earlierBuiltFor) {
      earlierBuiltFor = signature;
      fields.replaceChildren(...rules.map((rule) => {
        const key = priorKey(rule);
        const days = rule.period / SLOTS_PER_DAY - priorSheets();
        const longNight = rule.maxLongNight != null;
        const d = describeRule(rule);
        const field = el('div', 'earlier-field');
        field.dataset.key = key;
        const id = `earlier-${key}`;
        const label = el('label', 'earlier-label', `${longNight ? 'Long/night work' : 'Work'} in the ${days} days before`);
        label.htmlFor = id;
        const dates = el('span', 'earlier-dates',
          `${formatDate(pageDate(firstCounted() - days))} to ${formatDate(pageDate(firstCounted() - 1))} · for the ${days + priorSheets()}-day limit, ending with ${priorEndName()} (${d.work.toLowerCase()})`);
        const row = el('span', 'earlier-input');
        const input = el('input');
        input.id = id;
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.placeholder = 'e.g. 38';
        input.value = state.prior[key] || '';
        input.addEventListener('input', () => {
          state.prior = { ...state.prior, [key]: input.value };
          update(true);
        });
        row.append(input, el('span', null, 'hours'));
        const error = el('span', 'earlier-error', `${QUARTER_HELP}, up to ${days * 24}. Round up to the next quarter hour.`);
        error.hidden = true;
        const warning = el('span', 'earlier-error earlier-warning');
        warning.hidden = true;
        field.append(label, dates, row, error, warning);
        if (longNight) {
          field.append(el('span', 'earlier-help', 'Long/night work is work between midnight and 6am, plus work over 12 hours in any 24 hours.'));
        }
        return field;
      }));
    }
    // Each total is only used for its own period, so they are never added together. A longer
    // period's days include the shorter one's, so its total can't be smaller.
    const totals = priorSlots();
    const workKeys = Object.keys(totals).filter((k) => k.startsWith('work-'))
      .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    for (const field of fields.children) {
      const key = field.dataset.key;
      const rule = rules.find((r) => priorKey(r) === key);
      const days = rule.period / SLOTS_PER_DAY - priorSheets();
      const bad = Number.isNaN(parseHours(state.prior[key], days * 24));
      field.classList.toggle('invalid', bad);
      field.querySelector('.earlier-error').hidden = !bad;
      const warning = field.querySelector('.earlier-warning');
      const shorter = workKeys.filter((k) => k !== key && Number(k.split('-')[1]) < Number(key.split('-')[1]))
        .find((k) => totals[key] != null && totals[k] > totals[key]);
      warning.hidden = !shorter;
      if (shorter) {
        const shorterDays = Number(shorter.split("-")[1]) - priorSheets();
        warning.textContent = `These ${days} days include the ${shorterDays} days above (${formatDuration(totals[shorter])}), so this total should be at least that.`;
      }
    }
  }

  function renderLimits(ruleset) {
    $('#limits-name').textContent = ruleset.name;
    $('#limits-source').textContent = ruleset.source;
    $('#caution-two-up').hidden = !ruleset.twoUp;
    $('#caution-alternative').hidden = !ruleset.alternative;
    $('#limits-body').replaceChildren(...ruleset.rules.map((rule) => {
      const d = describeRule(rule);
      const tr = el('tr');
      tr.append(el('td', null, d.period), el('td', null, d.work), el('td', null, d.rest), el('td', 'risk', d.risk));
      return tr;
    }));
  }

  // Installed as an app, the page keeps working offline. Not available when opened as a file.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  buildControls();
  buildPriorChoice();
  buildPlanControls();
  buildDetail();
  for (let p = 0; p < PAGES; p++) buildSheet(p);
  buildDayBeforeToggle();
  if (saved) update(true);
  else loadExample();

  // Keep the time now and the next limits current.
  const tick = () => {
    renderPlanner();
    markNow();
  };
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
})();
