(function () {
  'use strict';

  const { RULESETS, SLOTS_PER_DAY, SLOT_MINUTES, H, check, plan, earliestStart, priorKey, describeRule, formatDuration, formatPeriod } = window.EWD;

  // Four days are kept: an optional "day before" sheet (page 0), then the three daily sheets
  // (pages 1 to 3). While the day before is hidden it is all rest, which is how time before the
  // sheets is counted anyway.
  const PAGES = 4;
  const FIRST = 1;
  const SHEETS = [1, 2, 3];
  const MIDDLE = 2;
  const N = PAGES * SLOTS_PER_DAY;
  // The earlier-work totals cover the days before the first sheet and end with the middle sheet.
  const PRIOR = { priorStart: FIRST * SLOTS_PER_DAY, priorThrough: MIDDLE - FIRST + 1 };
  const STORAGE_KEY = 'ewd-checker-v1';
  const HOUR_LABELS = ['Mid', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
    'Noon', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  const OPTIONS = [['standard', 'Standard'], ['bfm', 'BFM'], ['afm', 'AFM']];

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
      pages: Array.from({ length: PAGES }, () => ({ rego: '', twoUp: '' })),
      slots: new Array(N).fill('R'),
      changes: {},
      // Start of "Your next limits": null for the time now, or { date, time } the driver picked.
      planFrom: null,
      // Earlier work typed in for the longer periods, as entered, keyed by rule (e.g. work-7).
      prior: {},
      // Answers about rest before the sheets, as entered.
      history: { lastRestDay: '', lastRestTime: '', workSince: '', nights: {}, nightBefore: '', longRests: {} },
      showDayBefore: false,
    };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.slots) || !RULESETS[saved.ruleset]) return null;
      // Saves from before the day-before sheet held three days: move them along by one.
      if (saved.slots.length === 3 * SLOTS_PER_DAY) {
        saved.slots = new Array(SLOTS_PER_DAY).fill('R').concat(saved.slots);
        saved.pages = [{ rego: '', twoUp: '' }].concat(saved.pages || []);
        saved.changes = Object.fromEntries(Object.entries(saved.changes || {})
          .map(([i, v]) => [String(Number(i) + SLOTS_PER_DAY), v]));
      }
      if (saved.slots.length !== N) return null;
      const state = { ...defaultState(), ...saved };
      state.history = { ...defaultState().history, ...(saved.history || {}) };
      // Every block is work, stationary rest ('R') or rest that isn't stationary ('N'). Older
      // saves had unmarked blocks, which count as rest.
      state.slots = state.slots.map((v) => (v === 'W' || v === 'N' ? v : 'R'));
      while (state.pages.length < PAGES) state.pages.push({ rego: '', twoUp: '' });
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

  // Which line of the graph a block is drawn on: work, or rest of either kind.
  function lineRow(v) {
    return v === 'W' ? 'W' : 'R';
  }

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
    if (day < 0 || day >= PAGES) return -1;
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

    for (const id of ['driver', 'licence']) {
      const input = $(`#${id}`);
      input.value = state[id];
      input.addEventListener('input', () => {
        state[id] = input.value;
        update(true);
      });
    }

    watchMiddleDate($('#middle-date'));

    confirmButton($('#example'), 'Replace entries?', () => state.slots.includes('W'), loadExample);
    confirmButton($('#clear'), 'Tap again to clear', () => true, () => {
      state.slots = new Array(N).fill('R');
      state.changes = {};
      state.prior = {};
      state.history = defaultState().history;
      state.example = false;
      clearEarlierBoxes();
      update(true);
    });
    const print = $('#print');
    if (print) print.addEventListener('click', () => window.print());
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
    const date = el('span', 'meta-value');
    const driver = el('span', 'meta-value');
    const licence = el('span', 'meta-value');
    const options = el('span', 'meta-value options');
    const rego = el('input', 'meta-input');
    rego.value = state.pages[p].rego;
    rego.placeholder = 'e.g. XQ12AB';
    rego.addEventListener('input', () => {
      state.pages[p].rego = rego.value;
      save();
    });
    const twoUp = el('input', 'meta-input');
    twoUp.value = state.pages[p].twoUp;
    twoUp.addEventListener('input', () => {
      state.pages[p].twoUp = twoUp.value;
      save();
    });
    const dateBox = box('Day / date', date);
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
    box('Driver name', driver);
    box('Driver licence no.', licence);
    box('Work option', options);
    box('Vehicle registration', rego);
    const twoUpBox = box('Two-up driver name', twoUp);
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

    const cells = { W: [], R: [], X: [] };
    const totals = {};
    for (const [row, label] of [['W', 'WORK'], ['R', 'REST'], ['X', 'BREACH']]) {
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

    const breaches = el('div', 'sheet-breaches');
    sheet.append(breaches);

    $('#sheets').append(sheet);
    sheets.push({ sheet, date, driver, licence, options, twoUpBox, cells, totals, changesBody, breaches });
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
      drag = { grid, last: i };
      paint(i, i, cell.dataset.row);
      grid.setPointerCapture(e.pointerId);
    });
    // The row under the finger decides: the WORK row marks work, the REST row marks rest.
    grid.addEventListener('pointermove', (e) => {
      if (!drag || drag.grid !== grid) return;
      const cell = cellAt(e.clientX, e.clientY, grid);
      if (!cell || cell.dataset.row === 'X') return;
      const i = Number(cell.dataset.i);
      paint(Math.min(i, drag.last), Math.max(i, drag.last), cell.dataset.row);
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
    const label = () => {
      button.textContent = state.showDayBefore ? 'Remove the day before' : 'Show the day before';
      note.textContent = state.showDayBefore
        ? 'Its work is not added to the work-before totals: those already include this day.'
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
      label();
      update(true);
    });
    label();
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
    result = check(state.slots, state.ruleset, { fmtTime, prior: priorSlots(), history: historyOpts(), ...PRIOR });
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
        const next = i < N - 1 ? state.slots[i + 1] : null;
        if (v === 'W') work++;
        else rest++;
        for (const row of ['W', 'R']) {
          const c = s.cells[row][q];
          const on = lineRow(v) === row;
          c.classList.toggle('on', on);
          // Vertical pen strokes where the line moves between WORK and REST.
          c.classList.toggle('drop', on && prev != null && lineRow(prev) !== row);
          c.classList.toggle('end', on && next != null && lineRow(next) !== row);
          // Rest that isn't stationary is drawn as a dashed line.
          c.classList.toggle('ns', on && v === 'N');
          c.classList.toggle('breach', on && row === 'W' && breachSlots.has(i));
          c.classList.toggle('longnight', on && row === 'W' && result.longNight.has(i));
          c.title = `${fmtTime(i)}–${clock(i + 1)}`;
        }
        const x = s.cells.X[q];
        const n = breachSlots.get(i);
        x.classList.toggle('on', n != null);
        x.title = n != null ? result.breaches[n].message : '';
      }
      s.totals.W.textContent = formatHours(work);
      s.totals.R.textContent = formatHours(rest);
      const pageBreaches = result.breaches.filter((b) => Math.floor(b.slots[0] / SLOTS_PER_DAY) === p);
      s.totals.X.textContent = pageBreaches.length ? String(pageBreaches.length) : '';
      s.sheet.classList.toggle('has-breach', pageBreaches.length > 0);

      if (!full) return;
      s.sheet.hidden = p < FIRST && !state.showDayBefore;
      s.date.textContent = formatDate(pageDate(p), true);
      if (p === MIDDLE) syncMiddleDate();
      s.driver.textContent = state.driver || '—';
      s.licence.textContent = state.licence || '—';
      s.options.replaceChildren(...OPTIONS.map(([id, label]) => {
        const o = el('span', `option${ruleset.option === id ? ' ticked' : ''}`, label);
        o.prepend(el('span', 'tick', ruleset.option === id ? '✕' : ''));
        return o;
      }));
      s.twoUpBox.hidden = !ruleset.twoUp;
      renderChanges(s, p);
      renderSheetBreaches(s, pageBreaches);
    });

    if (full) {
      renderEarlier();
      renderRestBefore();
      renderSummary();
      renderLimits(ruleset);
      renderPlanner();
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
      const day = SHEETS.find((p) => isoDate(pageDate(p)) === state.planFrom.date);
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
      const i = Math.min(N - 1, Math.max(FIRST * SLOTS_PER_DAY, start + delta));
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
    day.replaceChildren(...SHEETS.map((p) => {
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

    let slots = state.slots;
    let base = from;
    const opts = { prior: priorSlots(), history: historyOpts(), ...PRIOR };
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
        input.addEventListener('input', () => {
          state.changes[i] = { ...state.changes[i], [field]: input.value };
          save();
        });
        td.append(input);
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
    const total = state.slots.filter((v, i) => v === 'W' && i >= FIRST * SLOTS_PER_DAY).length;
    const facts = [`Total work across the three sheets: ${formatDuration(total)}.`];
    const before = state.slots.filter((v, i) => v === 'W' && i < FIRST * SLOTS_PER_DAY).length;
    if (before) facts.push(`Work on the day before: ${formatDuration(before)}.`);
    if (result.longNight.size) facts.push(`Long/night work: ${formatDuration(result.longNight.size)}.`);
    const prior = priorSlots();
    for (const rule of RULESETS[state.ruleset].rules) {
      const key = priorKey(rule);
      if (key && prior[key] != null) {
        const days = rule.period / SLOTS_PER_DAY;
        facts.push(`${rule.maxLongNight != null ? 'Long/night work' : 'Work'} in the ${days - 2} days before: ${formatDuration(prior[key])}, checked with the first two sheets against the ${days}-day limit.`);
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
  function parseHours(text, maxHours) {
    const t = String(text || '').trim();
    if (!t) return null;
    let hours = NaN;
    let m = t.match(/^(\d+)(?:[.,](\d+))?$/);
    if (m) hours = Number(`${m[1]}.${m[2] || 0}`);
    m = t.match(/^(\d+):([0-5]\d)$/);
    if (m) hours = Number(m[1]) + Number(m[2]) / 60;
    if (!(hours >= 0) || hours > maxHours) return NaN;
    return Math.ceil(hours * (60 / SLOT_MINUTES) - 1e-9);
  }

  // The rules of the current work option that take an earlier total.
  function priorRules() {
    return RULESETS[state.ruleset].rules.filter((rule) => priorKey(rule));
  }

  function priorSlots() {
    const out = {};
    for (const rule of priorRules()) {
      const key = priorKey(rule);
      const days = rule.period / SLOTS_PER_DAY - 2;
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
    out.dayBeforeRecorded = state.showDayBefore;
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
    const signature = `${state.ruleset}|${state.startDate}|${state.showDayBefore}`;
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
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.placeholder = 'e.g. 40';
      input.value = h.workSince || '';
      input.addEventListener('input', () => setHistory({ workSince: input.value }));
      out.push(field('Work since then, before the first sheet', 'For the 84 hours between 24-hour rests. Needs the date above.', input, el('span', null, 'hours')));
    }
    for (const rule of q.longRests) {
      const days = q.days(rule);
      const key = `long-${days}`;
      const before = days - (MIDDLE - FIRST + 1);
      const counts = [['', 'Not entered']];
      for (let c = 0; c <= rule.restBlocks.count; c++) counts.push([String(c), String(c)]);
      out.push(field(`24-hour rests in the ${before} days before`, `${formatDate(pageDate(FIRST - before))} to ${formatDate(pageDate(FIRST - 1))} · for the ${days}-day rule (${rule.restText.toLowerCase()})`,
        selectOf(`rest-${key}`, `24-hour rests in the ${before} days before`, counts, h.longRests[key] == null ? '' : String(h.longRests[key]),
          (v) => setHistory({ longRests: { ...state.history.longRests, [key]: v } }))));
    }
    for (const rule of q.nights) {
      const days = q.days(rule);
      const key = `night-${days}`;
      const before = days - (MIDDLE - FIRST + 1);
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
        `${formatDate(pageDate(FIRST - before))} to ${formatDate(pageDate(FIRST - 1))}, counting the night into the first sheet · for the ${days}-day rule (${rule.restText.toLowerCase()})`,
        ...controls));
    }
    if (q.nights.some((r) => r.nightRests.consecutive) && !state.showDayBefore) {
      out.push(field('Was the night into the first sheet a night rest break?', 'At least 7 hours stationary rest between 10pm and 8am. It can pair with a night rest break on the sheets.',
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

  // Rebuilt only when the work option or dates change, so typing in a box keeps its focus.
  function renderEarlier() {
    const section = $('#earlier');
    const fields = $('#earlier-fields');
    const rules = priorRules();
    section.hidden = !rules.length;
    const signature = `${state.ruleset}|${state.startDate}`;
    if (signature !== earlierBuiltFor) {
      earlierBuiltFor = signature;
      fields.replaceChildren(...rules.map((rule) => {
        const key = priorKey(rule);
        const days = rule.period / SLOTS_PER_DAY - 2;
        const longNight = rule.maxLongNight != null;
        const d = describeRule(rule);
        const field = el('div', 'earlier-field');
        field.dataset.key = key;
        const id = `earlier-${key}`;
        const label = el('label', 'earlier-label', `${longNight ? 'Long/night work' : 'Work'} in the ${days} days before`);
        label.htmlFor = id;
        const dates = el('span', 'earlier-dates',
          `${formatDate(pageDate(FIRST - days))} to ${formatDate(pageDate(FIRST - 1))} · for the ${days + 2}-day limit, ending with the middle sheet (${d.work.toLowerCase()})`);
        const row = el('span', 'earlier-input');
        const input = el('input');
        input.id = id;
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        input.placeholder = 'e.g. 38.5';
        input.value = state.prior[key] || '';
        input.addEventListener('input', () => {
          state.prior = { ...state.prior, [key]: input.value };
          update(true);
        });
        row.append(input, el('span', null, 'hours'));
        const error = el('span', 'earlier-error', `Enter hours, like 38.5 or 38:30, up to ${days * 24}.`);
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
      const days = rule.period / SLOTS_PER_DAY - 2;
      const bad = Number.isNaN(parseHours(state.prior[key], days * 24));
      field.classList.toggle('invalid', bad);
      field.querySelector('.earlier-error').hidden = !bad;
      const warning = field.querySelector('.earlier-warning');
      const shorter = workKeys.filter((k) => k !== key && Number(k.split('-')[1]) < Number(key.split('-')[1]))
        .find((k) => totals[key] != null && totals[k] > totals[key]);
      warning.hidden = !shorter;
      if (shorter) {
        const shorterDays = Number(shorter.split('-')[1]) - 2;
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
