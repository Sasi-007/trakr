// Lightweight custom date picker popover with click-drag range selection.
// Replaces the native <input type="date"> inside booking slot rows so the
// owner can see per-day booking status (free/partial/full) while picking,
// and drag across multiple days to add them all at once (like travel-site
// date-range pickers).
const DatePicker = (() => {
  let popover = null;
  let activeInput = null;
  let onPickCallback = null;
  let viewYear, viewMonth;
  let anchorDate = null;
  let hoverDate = null;
  let dragging = false;
  let rangeAllowed = true;

  function iso(d) {
    return CalendarView.toISODate(d);
  }

  function parseISO(s) {
    return new Date(s + 'T00:00:00');
  }

  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function sortedRange(a, b) {
    return a <= b ? [a, b] : [b, a];
  }

  function datesBetween(startISO, endISO) {
    const out = [];
    let cur = parseISO(startISO);
    const end = parseISO(endISO);
    while (cur <= end) {
      out.push(iso(cur));
      cur = addDays(cur, 1);
    }
    return out;
  }

  function dayStatus(dateISO) {
    const d = parseISO(dateISO);
    const map = Storage.getMonthMap(d.getFullYear(), d.getMonth());
    const entry = map[dateISO];
    if (!entry) return 'free';
    const morningBooked = !!entry.morning;
    const eveningBooked = !!entry.evening;
    if (morningBooked && eveningBooked) return 'full';
    if (morningBooked || eveningBooked) return 'partial';
    return 'free';
  }

  function buildPopover() {
    const pop = document.createElement('div');
    pop.className = 'dp-popover hidden';
    pop.innerHTML = `
      <div class="dp-header">
        <button type="button" class="icon-btn dp-prev">‹</button>
        <strong class="dp-label"></strong>
        <button type="button" class="icon-btn dp-next">›</button>
      </div>
      <div class="dp-weekdays">
        <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
      </div>
      <div class="dp-grid"></div>
      <p class="dp-hint">Tap a day to pick it, or press &amp; drag across days to select a range.</p>
      <div class="dp-legend">
        <span><i class="dp-dot dp-dot-free"></i>Free</span>
        <span><i class="dp-dot dp-dot-partial"></i>Partial</span>
        <span><i class="dp-dot dp-dot-full"></i>Full</span>
      </div>
      <div class="dp-footer hidden">
        <span class="dp-range-label"></span>
        <div class="dp-footer-actions">
          <button type="button" class="small-btn dp-clear">Clear</button>
          <button type="button" class="primary-btn dp-apply">Add dates</button>
        </div>
      </div>
    `;
    document.body.appendChild(pop);

    pop.querySelector('.dp-prev').addEventListener('click', () => {
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      renderGrid();
    });
    pop.querySelector('.dp-next').addEventListener('click', () => {
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      renderGrid();
    });
    pop.querySelector('.dp-clear').addEventListener('click', () => {
      anchorDate = null;
      hoverDate = null;
      renderGrid();
    });
    pop.querySelector('.dp-apply').addEventListener('click', () => {
      if (!anchorDate || !hoverDate) return;
      const [start, end] = sortedRange(anchorDate, hoverDate);
      finish(datesBetween(start, end));
    });

    pop.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.dp-day:not(.dp-pad)');
      if (!cell) return;
      e.preventDefault();
      if (!rangeAllowed) {
        // Single-date fields (e.g. payment dates): pick immediately, no drag.
        finish([cell.dataset.date]);
        return;
      }
      dragging = true;
      anchorDate = cell.dataset.date;
      hoverDate = cell.dataset.date;
      updateHighlight();
    });

    return pop;
  }

  function onPointerMove(e) {
    if (!dragging || !rangeAllowed) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest && el.closest('.dp-day:not(.dp-pad)');
    if (cell && cell.dataset.date !== hoverDate) {
      hoverDate = cell.dataset.date;
      updateHighlight();
    }
  }

  function onPointerUp() {
    if (!dragging || !rangeAllowed) return;
    dragging = false;
    if (anchorDate && hoverDate && anchorDate === hoverDate) {
      // Plain tap, no drag: pick the single date immediately.
      finish([anchorDate]);
    } else if (anchorDate && hoverDate) {
      showFooter();
    }
  }

  function showFooter() {
    const [start, end] = sortedRange(anchorDate, hoverDate);
    const count = datesBetween(start, end).length;
    const footer = popover.querySelector('.dp-footer');
    footer.classList.remove('hidden');
    footer.querySelector('.dp-range-label').textContent =
      `${formatShort(start)} - ${formatShort(end)} (${count} day${count > 1 ? 's' : ''})`;
    footer.querySelector('.dp-apply').textContent = `Add ${count} date${count > 1 ? 's' : ''}`;
  }

  function formatShort(dateISO) {
    const d = parseISO(dateISO);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function updateHighlight() {
    if (!popover) return;
    popover.querySelector('.dp-footer').classList.add('hidden');
    const cells = popover.querySelectorAll('.dp-day:not(.dp-pad)');
    if (!anchorDate || !hoverDate) {
      cells.forEach((c) => c.classList.remove('dp-in-range', 'dp-range-edge'));
      return;
    }
    const [start, end] = sortedRange(anchorDate, hoverDate);
    cells.forEach((c) => {
      const d = c.dataset.date;
      const inRange = d >= start && d <= end;
      c.classList.toggle('dp-in-range', inRange);
      c.classList.toggle('dp-range-edge', d === start || d === end);
    });
  }

  function renderGrid() {
    const label = popover.querySelector('.dp-label');
    label.textContent = new Date(viewYear, viewMonth, 1).toLocaleString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    const grid = popover.querySelector('.dp-grid');
    grid.innerHTML = '';
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayISO = iso(new Date());

    for (let i = 0; i < startOffset; i++) {
      const pad = document.createElement('div');
      pad.className = 'dp-day dp-pad';
      grid.appendChild(pad);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(viewYear, viewMonth, day);
      const dISO = iso(dateObj);
      const cell = document.createElement('div');
      cell.className = 'dp-day dp-status-' + dayStatus(dISO);
      cell.dataset.date = dISO;
      cell.textContent = String(day);
      if (dISO === todayISO) cell.classList.add('dp-today');
      grid.appendChild(cell);
    }
    updateHighlight();
  }

  function finish(dates) {
    hide();
    if (onPickCallback) onPickCallback(dates);
  }

  function position() {
    if (!activeInput || !popover) return;
    const rect = activeInput.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + margin;
    if (top + popRect.height > window.innerHeight) {
      top = Math.max(margin, rect.top - popRect.height - margin);
    }
    let left = rect.left;
    if (left + popRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popRect.width - margin;
    }
    left = Math.max(margin, left);
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function outsideClick(e) {
    if (!popover || popover.classList.contains('hidden')) return;
    if (popover.contains(e.target) || e.target === activeInput) return;
    hide();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') hide();
  }

  function show(input, presetISO, onPick, allowRange = true) {
    if (!popover) popover = buildPopover();
    rangeAllowed = allowRange;
    popover.classList.toggle('dp-single-mode', !allowRange);
    popover.querySelector('.dp-hint').textContent = allowRange
      ? 'Tap a day to pick it, or press & drag across days to select a range.'
      : 'Tap a day to pick it.';
    activeInput = input;
    onPickCallback = onPick;
    anchorDate = presetISO || null;
    hoverDate = presetISO || null;
    const base = presetISO ? parseISO(presetISO) : new Date();
    viewYear = base.getFullYear();
    viewMonth = base.getMonth();
    popover.classList.remove('hidden');
    renderGrid();
    position();
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointerdown', outsideClick, true);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
  }

  function hide() {
    if (!popover) return;
    popover.classList.add('hidden');
    dragging = false;
    activeInput = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointerdown', outsideClick, true);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
  }

  // Wires a text input so tapping/clicking it opens the popover.
  // onPick(dates) receives an array of one or more ISO date strings
  // (more than one when a range was dragged). Pass { allowRange: false }
  // for simple single-date fields (e.g. payment dates) to disable
  // drag-range selection and the availability dots/legend.
  function attach(input, onPick, options = {}) {
    const allowRange = options.allowRange !== false;
    input.addEventListener('click', () => {
      show(input, input.value || null, onPick, allowRange);
    });
  }

  return { attach };
})();
