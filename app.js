(function () {
  'use strict';

  const { RULESETS, SLOTS_PER_DAY, SLOT_MINUTES, H, check, describeRule, formatDuration } = window.EWD;

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
    }
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

  function breachItem(b) {
    const li = el('li', 'breach-item');
    const label = b.severity ? `${b.escalated ? 'escalated ' : ''}${b.severity} risk` : 'breach';
    const tag = el('span', `severity${b.severity ? ` sev-${b.severity}` : ''}`, label);
    li.append(tag, el('strong', null, `${b.ruleLabel}: `), document.createTextNode(b.message));
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
  for (let p = 0; p < PAGES; p++) buildSheet(p);
  if (saved) update(true);
  else loadExample();
})();
