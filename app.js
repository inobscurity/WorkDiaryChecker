(function () {
  'use strict';

  const { RULESETS, SLOTS_PER_DAY, SLOT_MINUTES, H, check, plan, describeRule, formatDuration } = window.EWD;

  const PAGES = 3;
  const N = PAGES * SLOTS_PER_DAY;
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
    };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.slots) || saved.slots.length !== N || !RULESETS[saved.ruleset]) return null;
      const state = { ...defaultState(), ...saved };
      // Every block is work or rest; older saves had unmarked blocks, which count as rest.
      state.slots = state.slots.map((v) => (v === 'W' ? 'W' : 'R'));
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

  function pageDate(p) {
    const [y, m, d] = (state.startDate || yesterdayISO()).split('-').map(Number);
    return new Date(y, m - 1, d + p);
  }

  function formatDate(date, long) {
    return date.toLocaleDateString('en-AU', long
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function clock(i) {
    const minutes = (i % SLOTS_PER_DAY) * SLOT_MINUTES;
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

    // The date picker shows the middle sheet; the state keeps the first sheet's date.
    const middle = $('#middle-date');
    middle.value = addDays(state.startDate, 1);
    middle.addEventListener('input', () => {
      if (!middle.value) return;
      state.startDate = addDays(middle.value, -1);
      state.dateChosen = middle.value !== isoDate(new Date());
      update(true);
    });

    confirmButton($('#example'), 'Replace entries?', () => state.slots.includes('W'), loadExample);
    confirmButton($('#clear'), 'Tap again to clear', () => true, () => {
      state.slots = new Array(N).fill('R');
      state.changes = {};
      state.example = false;
      update(true);
    });
    const print = $('#print');
    if (print) print.addEventListener('click', () => window.print());
  }

  // Asks for a second tap instead of a dialog, so it also works where dialogs are blocked.
  function confirmButton(button, question, needsConfirm, action) {
    const label = button.textContent;
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
      button.textContent = question;
      button.classList.add('confirming');
      timer = setTimeout(reset, 4000);
    });
  }

  function buildSheet(p) {
    const sheet = el('article', 'sheet');
    sheet.setAttribute('aria-label', `Daily sheet ${p + 1}`);

    const head = el('div', 'sheet-head');
    head.append(el('div', 'sheet-title', 'DAILY SHEET'), el('div', 'sheet-no', `No. ${String(p + 1).padStart(4, '0')}`));
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
    box('Day / date', date);
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
    days.forEach((entries, d) => entries.forEach(([from, to, v]) => set(d, from, to, v)));
    state.slots = slots;
    state.changes = {};
    state.example = true;
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
    result = check(state.slots, state.ruleset, { fmtTime });
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
          const on = v === row;
          c.classList.toggle('on', on);
          // Vertical pen strokes where the line moves between WORK and REST.
          c.classList.toggle('drop', on && prev != null && prev !== v);
          c.classList.toggle('end', on && next != null && next !== v);
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
      s.date.textContent = formatDate(pageDate(p), true);
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
      const day = [...Array(PAGES).keys()].findIndex((p) => isoDate(pageDate(p)) === state.planFrom.date);
      const [hh, mm] = String(state.planFrom.time).split(':').map(Number);
      if (day >= 0 && Number.isInteger(hh) && Number.isInteger(mm)) {
        return { from: day * SLOTS_PER_DAY + Math.floor((hh * 60 + mm) / SLOT_MINUTES), custom: true };
      }
    }
    return { from: nowIndex(), custom: false };
  }

  function buildPlanControls() {
    const day = $('#plan-day');
    const time = $('#plan-time');
    const pick = () => {
      if (!time.value) return;
      state.planFrom = { date: day.value, time: time.value };
      update(true);
    };
    day.addEventListener('change', pick);
    time.addEventListener('change', pick);
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
    day.replaceChildren(...[...Array(PAGES).keys()].map((p) => {
      const iso = isoDate(pageDate(p));
      const opt = el('option', null, `${formatDate(pageDate(p))}${iso === todayIso ? ' (today)' : ''}`);
      opt.value = iso;
      return opt;
    }));
    const page = from >= 0 ? Math.floor(from / SLOTS_PER_DAY) : 1;
    day.value = isoDate(pageDate(page));
    if (document.activeElement !== time) {
      time.value = custom ? state.planFrom.time : from >= 0 ? clock(from) : '';
    }
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
    const items = plan(state.slots, state.ruleset, from);
    if (!items.length) {
      list.replaceChildren(el('li', 'plan-item plan-clear', 'No limit is reached before the end of the last sheet.'));
      return;
    }
    const startPage = Math.floor(from / SLOTS_PER_DAY);
    const duration = (minutes) => (minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`);
    list.replaceChildren(...items.map((item, k) => {
      const [action, detail] = planAction(item, custom);
      const li = el('li', `plan-item${k === 0 ? ' first' : ''}${item.overNow ? ' over' : ''}`);
      const when = el('div', 'plan-when');
      const page = Math.floor(item.stopAt / SLOTS_PER_DAY);
      if (item.overNow) {
        when.append(el('strong', 'plan-time', custom ? clock(from) : 'Now'));
      } else {
        when.append(el('strong', 'plan-time', clock(item.stopAt)));
        // From the time now, count down; from a picked time, say how long after it.
        const left = custom
          ? `after ${duration((item.stopAt - from) * SLOT_MINUTES)}`
          : `in ${duration(Math.max(0, Math.round((slotDate(item.stopAt) - now) / 60000)))}`;
        when.append(el('span', 'plan-left', `${page !== startPage ? `${formatDate(pageDate(page))} · ` : ''}${left}`));
      }
      const text = el('div', 'plan-text');
      text.append(el('strong', null, action), el('span', null, detail));
      li.append(when, text);
      return li;
    }));
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
      const i = b.slots[0];
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
    if (!hasWork) {
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
    const total = state.slots.filter((v) => v === 'W').length;
    const facts = [`Total work across the three sheets: ${formatDuration(total)}.`];
    if (result.longNight.size) facts.push(`Long/night work: ${formatDuration(result.longNight.size)}.`);
    parts.push(el('p', 'facts', facts.join(' ')));
    if (result.notes.length) {
      const notes = el('ul', 'notes');
      notes.append(...result.notes.map((n) => el('li', null, n)));
      parts.push(notes);
    }
    box.replaceChildren(...parts);
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
