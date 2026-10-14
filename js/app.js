/**
 * App controller: wires up calendar, agenda, dashboard views and the booking modal.
 */
(() => {
  let currentYear, currentMonth; // monthIndex 0-based
  let editingBookingId = null;
  let dayModalDate = null;
  let agendaRangeStart = null;
  let agendaRangeEnd = null;

  const el = (id) => document.getElementById(id);

  function init() {
    const today = new Date();
    currentYear = today.getFullYear();
    currentMonth = today.getMonth();

    registerServiceWorker();
    bindNav();
    bindViewTabs();
    bindModal();
    bindDayModal();
    bindExportImport();
    bindAgendaDateFilter();

    el('fabAdd').addEventListener('click', () => openBookingModal());

    renderCalendar();
    renderAgenda();
    renderDashboard();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    let reloading = false;
    // A new worker took over (new version deployed) — reload once so the running
    // page picks up the fresh HTML/CSS/JS without any manual cache clearing.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register('service-worker.js')
      .then((reg) => {
        reg.update();
        // Also check for a new deploy whenever the app is brought back to the front.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update();
        });
      })
      .catch((e) => console.warn('SW failed', e));
  }

  // ---------- View switching ----------
  function bindViewTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
        el('view-' + btn.dataset.view).classList.add('active');
        if (btn.dataset.view === 'agenda') renderAgenda();
        if (btn.dataset.view === 'dashboard') renderDashboard();
        if (btn.dataset.view === 'calendar') renderCalendar();
      });
    });
  }

  // ---------- Calendar ----------
  function bindNav() {
    el('prevMonth').addEventListener('click', () => {
      currentMonth--;
      if (currentMonth < 0) { currentMonth = 11; currentYear--; }
      renderCalendar();
    });
    el('nextMonth').addEventListener('click', () => {
      currentMonth++;
      if (currentMonth > 11) { currentMonth = 0; currentYear++; }
      renderCalendar();
    });
    el('todayBtn').addEventListener('click', () => {
      const today = new Date();
      currentYear = today.getFullYear();
      currentMonth = today.getMonth();
      renderCalendar();
    });
  }

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function renderCalendar() {
    el('monthLabel').textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    const monthMap = Storage.getMonthMap(currentYear, currentMonth);
    CalendarView.renderMonth(el('calendarGrid'), currentYear, currentMonth, monthMap, openDayModal);
  }

  // ---------- Day modal (quick view of a date's bookings) ----------
  function bindDayModal() {
    el('dayModalClose').addEventListener('click', closeDayModal);
    el('dayModalOverlay').addEventListener('click', (e) => {
      if (e.target === el('dayModalOverlay')) closeDayModal();
    });
    el('dayAddBtn').addEventListener('click', () => {
      closeDayModal();
      openBookingModal(null, dayModalDate);
    });
    el('dayBlockBtn').addEventListener('click', onToggleBlockedDate);
  }

  function onToggleBlockedDate() {
    if (!dayModalDate) return;
    if (Storage.isDateBlocked(dayModalDate)) {
      Storage.unblockDate(dayModalDate);
      showToast('Date is available again.');
      openDayModal(dayModalDate);
      renderCalendar();
      renderAgenda();
    } else {
      showBlockReasonForm();
    }
  }

  // Inline reason prompt inside the day modal (native prompt() is unavailable in PWAs).
  function showBlockReasonForm() {
    const existing = el('dayModalBody').querySelector('.block-reason-form');
    if (existing) {
      existing.querySelector('input').focus();
      return;
    }
    const form = document.createElement('div');
    form.className = 'block-reason-form';
    form.innerHTML = `
      <label>Reason (optional)
        <input type="text" class="block-reason-input" placeholder="e.g. Aadi Kirthigai" />
      </label>
      <div class="block-reason-actions">
        <button type="button" class="small-btn block-reason-cancel">Cancel</button>
        <button type="button" class="primary-btn block-reason-save">🚫 Mark unavailable</button>
      </div>
    `;
    el('dayModalBody').prepend(form);
    const input = form.querySelector('.block-reason-input');
    input.focus();
    const save = () => {
      Storage.blockDate(dayModalDate, input.value);
      showToast('Date marked unavailable.');
      openDayModal(dayModalDate);
      renderCalendar();
      renderAgenda();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
    });
    form.querySelector('.block-reason-save').addEventListener('click', save);
    form.querySelector('.block-reason-cancel').addEventListener('click', () => form.remove());
  }

  function openDayModal(iso) {
    dayModalDate = iso;
    const map = Storage.getMonthMap(new Date(iso).getFullYear(), new Date(iso).getMonth());
    const info = map[iso] || { morning: null, evening: null };
    const dateLabel = new Date(iso + 'T00:00:00').toDateString();
    el('dayModalTitle').textContent = dateLabel;

    const body = el('dayModalBody');
    body.innerHTML = '';

    const blockedReason = Storage.getBlockedReason(iso);
    const isBlocked = blockedReason !== null;
    if (isBlocked) {
      const banner = document.createElement('div');
      banner.className = 'blocked-banner';
      banner.innerHTML = `<span class="blocked-banner-icon">🚫</span><div><strong>Marked unavailable</strong>${
        blockedReason ? `<div class="muted">${escapeHtml(blockedReason)}</div>` : ''
      }</div>`;
      body.appendChild(banner);
    }
    const blockBtn = el('dayBlockBtn');
    blockBtn.textContent = isBlocked ? '✅ Make available' : '🚫 Mark unavailable';

    ['morning', 'evening'].forEach((slotKey) => {
      const booking = info[slotKey];
      const row = document.createElement('div');
      row.className = 'day-slot-row';
      const label = slotKey === 'morning' ? 'Morning' : 'Evening';
      if (booking) {
        const status = Storage.paymentStatus(booking);
        const remaining = Storage.computeRemaining(booking);
        const total = Number(booking.totalAmount) || 0;
        const advance = Number(booking.advanceAmount) || 0;
        const paidPct = total > 0 ? Math.min(100, Math.round((advance / total) * 100)) : 0;
        const name = (booking.customerName || '').trim();
        const phone = (booking.phone || '').trim();
        const billNo = (booking.billNo || '').trim();
        const contactParts = [];
        if (billNo) contactParts.push('🧾 Bill ' + escapeHtml(billNo));
        if (name) contactParts.push('👤 ' + escapeHtml(name));
        if (phone) contactParts.push('📞 ' + escapeHtml(phone));
        const contactHtml = contactParts.length
          ? `<div class="muted">${contactParts.join(' · ')}</div>`
          : '';
        row.className = `day-slot-row status-${status}`;
        row.innerHTML = `
          <div class="day-slot-label">${SLOT_ICONS[slotKey] || ''} ${label}</div>
          <div class="day-slot-info">
            <div class="agenda-card-title">
              <span class="event-type-tag"><span class="event-icon">${eventIcon(booking.eventType)}</span>${escapeHtml(booking.eventType || 'Event')}</span>
              <span class="badge ${status}">${status}</span>
            </div>
            ${contactHtml}
            <div class="pay-bar-row">
              <div class="pay-bar"><div class="pay-bar-fill status-${status}" style="width:${paidPct}%"></div></div>
              <span class="pay-amounts">${formatAmountLine(total, advance, remaining)}</span>
            </div>
          </div>
          <button class="small-btn edit-slot-btn">✏️ Edit</button>
        `;
        row.querySelector('.edit-slot-btn').addEventListener('click', () => {
          closeDayModal();
          openBookingModal(booking.id);
        });
      } else {
        row.innerHTML = `<div class="day-slot-label">${SLOT_ICONS[slotKey] || ''} ${label}</div><div class="day-slot-info muted">Free</div>`;
      }
      body.appendChild(row);
    });

    el('dayModalOverlay').classList.remove('hidden');
  }

  function closeDayModal() {
    el('dayModalOverlay').classList.add('hidden');
  }

  // ---------- Booking modal ----------
  function bindModal() {
    el('modalClose').addEventListener('click', closeBookingModal);
    el('cancelBtn').addEventListener('click', closeBookingModal);
    el('modalOverlay').addEventListener('click', (e) => {
      if (e.target === el('modalOverlay')) closeBookingModal();
    });
    el('addSlotRow').addEventListener('click', () => addSlotRow());
    el('bookingForm').addEventListener('submit', onSaveBooking);
    el('deleteBookingBtn').addEventListener('click', onDeleteBooking);
    el('eventType').addEventListener('change', onEventTypeChange);

    el('totalAmount').addEventListener('input', updateRemainingDisplay);
    el('advanceAmount').addEventListener('input', updateRemainingDisplay);

    DatePicker.attach(el('advancePaidDate'), (dates) => {
      el('advancePaidDate').value = dates[0];
    }, { allowRange: false });
    DatePicker.attach(el('remainingPaidDate'), (dates) => {
      el('remainingPaidDate').value = dates[0];
    }, { allowRange: false });
  }

  function updateRemainingDisplay() {
    const total = Number(el('totalAmount').value) || 0;
    const advance = Number(el('advanceAmount').value) || 0;
    const remaining = Math.max(total - advance, 0);
    el('remainingDisplay').value = `₹${remaining}`;
  }

  const CUSTOM_TYPE_VALUE = '__custom__';

  // Fills the event-type dropdown with saved types plus the "add custom" entry.
  function populateEventTypes(selected) {
    const select = el('eventType');
    const types = Storage.getEventTypes();
    const current = (selected || '').trim();
    if (current && !types.some((t) => t.toLowerCase() === current.toLowerCase())) {
      types.push(current);
    }
    select.innerHTML =
      '<option value="" disabled>Select event type…</option>' +
      types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('') +
      `<option value="${CUSTOM_TYPE_VALUE}">➕ Add custom type…</option>`;
    select.value = current || '';
    el('customEventType').value = '';
    el('customEventTypeWrap').classList.add('hidden');
  }

  function onEventTypeChange() {
    const isCustom = el('eventType').value === CUSTOM_TYPE_VALUE;
    el('customEventTypeWrap').classList.toggle('hidden', !isCustom);
    if (isCustom) el('customEventType').focus();
  }

  // Resolves the chosen type, saving a brand-new custom type for future use.
  function resolveEventType() {
    const selected = el('eventType').value;
    if (selected !== CUSTOM_TYPE_VALUE) return selected.trim();
    const custom = el('customEventType').value.trim();
    if (!custom) return '';
    Storage.addEventType(custom);
    return custom;
  }

  // Multi-day events run from the first evening to the last morning.
  function slotForIndex(index, total) {
    if (total <= 1) return 'morning';
    if (index === 0) return 'evening';
    if (index === total - 1) return 'morning';
    return 'full';
  }

  function addSlotRow(date, slot) {
    const rowsContainer = el('slotRows');
    const row = document.createElement('div');
    row.className = 'slot-row';
    row.innerHTML = `
      <input type="text" class="slot-date" value="${date || ''}" placeholder="Tap to pick date" readonly required />
      <select class="slot-select">
        <option value="morning">Morning</option>
        <option value="evening">Evening</option>
        <option value="full">Full Day</option>
      </select>
      <button type="button" class="small-btn remove-slot-btn">✕</button>
    `;
    if (slot) row.querySelector('.slot-select').value = slot;
    row.querySelector('.remove-slot-btn').addEventListener('click', () => {
      if (rowsContainer.children.length > 1) row.remove();
    });
    const dateInput = row.querySelector('.slot-date');
    DatePicker.attach(dateInput, (dates) => {
      // First picked date fills this row; a dragged range adds the rest,
      // auto-slotted as evening → full day(s) → morning.
      dateInput.value = dates[0];
      if (dates.length > 1) {
        row.querySelector('.slot-select').value = slotForIndex(0, dates.length);
        dates.slice(1).forEach((d, i) => addSlotRow(d, slotForIndex(i + 1, dates.length)));
      }
    });
    rowsContainer.appendChild(row);
  }

  function openBookingModal(bookingId, presetDate) {
    editingBookingId = bookingId || null;
    el('bookingForm').reset();
    el('slotRows').innerHTML = '';
    el('conflictWarning').classList.add('hidden');
    el('remainingDisplay').value = '₹0';

    if (bookingId) {
      const b = Storage.getById(bookingId);
      el('modalTitle').textContent = 'Edit Booking';
      el('bookingId').value = b.id;
      el('customerName').value = b.customerName || '';
      el('phone').value = b.phone || '';
      el('billNo').value = b.billNo || '';
      populateEventTypes(b.eventType || '');
      el('totalAmount').value = b.totalAmount || 0;
      el('advanceAmount').value = b.advanceAmount || 0;
      el('advancePaidDate').value = b.advancePaidDate || '';
      el('remainingPaid').checked = !!b.remainingPaid;
      el('remainingPaidDate').value = b.remainingPaidDate || '';
      el('notes').value = b.notes || '';
      (b.slots || []).forEach((s) => addSlotRow(s.date, s.slot));
      el('deleteBookingBtn').classList.remove('hidden');
      updateRemainingDisplay();
    } else {
      el('modalTitle').textContent = 'New Booking';
      el('bookingId').value = '';
      populateEventTypes('');
      el('deleteBookingBtn').classList.add('hidden');
      addSlotRow(presetDate || CalendarView.toISODate(new Date()));
    }

    el('modalOverlay').classList.remove('hidden');
  }

  function closeBookingModal() {
    el('modalOverlay').classList.add('hidden');
    editingBookingId = null;
  }

  function collectSlots() {
    return Array.from(document.querySelectorAll('#slotRows .slot-row')).map((row) => ({
      date: row.querySelector('.slot-date').value,
      slot: row.querySelector('.slot-select').value,
    }));
  }

  function onSaveBooking(e) {
    e.preventDefault();
    const slots = collectSlots();
    const eventType = resolveEventType();
    if (!eventType) {
      const isCustom = el('eventType').value === CUSTOM_TYPE_VALUE;
      showToast(isCustom ? 'Please type the new event type name.' : 'Please select the event type.');
      el(isCustom ? 'customEventType' : 'eventType').focus();
      return;
    }
    if (slots.some((s) => !s.date)) {
      showToast('Please fill in all date fields.');
      return;
    }

    const conflicts = Storage.findConflicts(slots, editingBookingId);
    if (conflicts.length) {
      const names = [...new Set(conflicts.map((c) => `${c.date} (${c.slot}) - ${displayName(c.booking)}`))];
      el('conflictWarning').textContent = 'Conflict with existing booking: ' + names.join('; ');
      el('conflictWarning').classList.remove('hidden');
      return;
    }
    el('conflictWarning').classList.add('hidden');

    // Blocked dates are a soft guard — the owner can still override if they decide to.
    const blocked = [...new Set(slots.map((s) => s.date))]
      .filter((d) => Storage.isDateBlocked(d))
      .map((d) => {
        const reason = Storage.getBlockedReason(d);
        return reason ? `${d} (${reason})` : d;
      });
    if (blocked.length && !confirm(`These dates are marked unavailable:\n${blocked.join('\n')}\n\nBook anyway?`)) {
      return;
    }

    const booking = {
      id: editingBookingId || undefined,
      customerName: el('customerName').value.trim(),
      phone: el('phone').value.trim(),
      billNo: el('billNo').value.trim(),
      eventType: eventType,
      slots,
      totalAmount: Number(el('totalAmount').value) || 0,
      advanceAmount: Number(el('advanceAmount').value) || 0,
      advancePaidDate: el('advancePaidDate').value || null,
      remainingPaid: el('remainingPaid').checked,
      remainingPaidDate: el('remainingPaidDate').value || null,
      notes: el('notes').value.trim(),
      status: 'confirmed',
    };

    Storage.upsert(booking);
    closeBookingModal();
    renderCalendar();
    renderAgenda();
    renderDashboard();
    showToast('Booking saved.');
  }

  function onDeleteBooking() {
    if (!editingBookingId) return;
    if (!confirm('Delete this booking? This cannot be undone easily.')) return;
    Storage.remove(editingBookingId);
    closeBookingModal();
    renderCalendar();
    renderAgenda();
    renderDashboard();
    showToast('Booking deleted.');
  }

  // ---------- Agenda / List view ----------
  function bindExportImportAgendaFilters() {}

  function formatRangeLabel(startISO, endISO) {
    const opts = { day: 'numeric', month: 'short' };
    const startLabel = new Date(startISO + 'T00:00:00').toLocaleDateString('en-IN', opts);
    if (startISO === endISO) return `📅 ${startLabel}`;
    const endLabel = new Date(endISO + 'T00:00:00').toLocaleDateString('en-IN', opts);
    return `📅 ${startLabel} – ${endLabel}`;
  }

  function bindAgendaDateFilter() {
    const input = el('agendaDateRange');
    const clearBtn = el('agendaDateClear');
    DatePicker.attach(input, (dates) => {
      const sorted = dates.slice().sort();
      agendaRangeStart = sorted[0];
      agendaRangeEnd = sorted[sorted.length - 1];
      input.value = formatRangeLabel(agendaRangeStart, agendaRangeEnd);
      clearBtn.classList.remove('hidden');
      renderAgenda();
    }, { allowRange: true });
    clearBtn.addEventListener('click', () => {
      agendaRangeStart = null;
      agendaRangeEnd = null;
      input.value = '';
      clearBtn.classList.add('hidden');
      renderAgenda();
    });
  }

  function renderAgenda() {
    const search = (el('agendaSearch').value || '').toLowerCase();
    const filter = el('agendaFilter').value;
    el('agendaSearch').oninput = renderAgenda;
    el('agendaFilter').onchange = renderAgenda;

    const todayISO = CalendarView.toISODate(new Date());
    let bookings = Storage.getAll().slice();

    bookings = bookings.map((b) => ({
      booking: b,
      earliestDate: b.slots.map((s) => s.date).sort()[0],
    }));

    bookings.sort((a, b) => a.earliestDate.localeCompare(b.earliestDate));

    bookings = bookings.filter(({ booking, earliestDate }) => {
      if (search) {
        const haystack = `${booking.customerName || ''} ${booking.phone || ''} ${booking.eventType || ''} ${booking.billNo || ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (agendaRangeStart && agendaRangeEnd) {
        const inRange = booking.slots.some((s) => s.date >= agendaRangeStart && s.date <= agendaRangeEnd);
        if (!inRange) return false;
      }
      if (filter === 'unpaid' && Storage.paymentStatus(booking) === 'paid') return false;
      if (filter === 'upcoming' && earliestDate < todayISO) return false;
      if (filter === 'past' && earliestDate >= todayISO) return false;
      return true;
    });

    renderAgendaList(el('agendaFullList'), bookings.map((x) => x.booking));
  }

  const EVENT_ICONS = {
    wedding: '💍',
    marriage: '💍',
    engagement: '💑',
    birthday: '🎂',
    reception: '🥂',
    corporate: '🏢',
  };

  function eventIcon(type) {
    const key = (type || '').trim().toLowerCase();
    return EVENT_ICONS[key] || '🎉';
  }

  const SLOT_ICONS = { morning: '🌅', evening: '🌆', full: '🌞' };
  const SLOT_LABELS = { morning: 'Morning', evening: 'Evening', full: 'Full Day' };

  function formatSlotDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  // When no amount is set at all, the booking is just a "date block" (walk-in reserved the
  // date, nothing to collect yet) — show that instead of a misleading "₹0 / ₹0".
  function formatAmountLine(total, advance, remaining) {
    if (total <= 0 && advance <= 0) {
      return '<span class="muted">📌 Date blocked · no amount set yet</span>';
    }
    return `₹${advance} / ₹${total}${remaining > 0 ? ` · <span class="due-amount">₹${remaining} due</span>` : ''}`;
  }

  function renderAgendaList(container, bookings) {
    container.innerHTML = '';
    if (!bookings.length) {
      container.innerHTML = '<p class="muted empty-state">No bookings found.</p>';
      return;
    }
    bookings.forEach((b) => {
      const status = Storage.paymentStatus(b);
      const remaining = Storage.computeRemaining(b);
      const total = Number(b.totalAmount) || 0;
      const advance = Number(b.advanceAmount) || 0;
      const paidPct = total > 0 ? Math.min(100, Math.round((advance / total) * 100)) : 0;

      const sortedSlots = (b.slots || []).slice().sort((a, s) => a.date.localeCompare(s.date));
      const first = sortedSlots[0];
      const dateObj = first ? new Date(first.date + 'T00:00:00') : null;
      const dayNum = dateObj ? dateObj.getDate() : '--';
      const monthAbbr = dateObj ? dateObj.toLocaleDateString('en-IN', { month: 'short' }) : '';

      const slotPillsHtml = sortedSlots
        .map((s) => `<span class="slot-pill">${SLOT_ICONS[s.slot] || ''} ${formatSlotDate(s.date)} · ${SLOT_LABELS[s.slot] || s.slot}</span>`)
        .join('');

      const phone = (b.phone || '').trim();
      const name = (b.customerName || '').trim();
      const billNo = (b.billNo || '').trim();
      const footerParts = [];
      if (billNo) footerParts.push('🧾 Bill ' + escapeHtml(billNo));
      if (name) footerParts.push('👤 ' + escapeHtml(name));
      if (phone) footerParts.push('📞 ' + escapeHtml(phone));
      const footerHtml = footerParts.length
        ? `<div class="agenda-card-footer muted">${footerParts.join(' · ')}</div>`
        : '';

      const card = document.createElement('div');
      card.className = `agenda-card status-${status}`;
      card.innerHTML = `
        <div class="agenda-date-badge">
          <div class="agenda-date-day">${dayNum}</div>
          <div class="agenda-date-month">${monthAbbr}</div>
        </div>
        <div class="agenda-card-main">
          <div class="agenda-card-title">
            <span class="event-type-tag"><span class="event-icon">${eventIcon(b.eventType)}</span>${escapeHtml(b.eventType || 'Event')}</span>
            <span class="badge ${status}">${status}</span>
          </div>
          <div class="slot-pills">${slotPillsHtml}</div>
          <div class="pay-bar-row">
            <div class="pay-bar"><div class="pay-bar-fill status-${status}" style="width:${paidPct}%"></div></div>
            <span class="pay-amounts">${formatAmountLine(total, advance, remaining)}</span>
          </div>
          ${footerHtml}
        </div>
        <button class="small-btn edit-agenda-btn" title="Edit booking">✏️ Edit</button>
      `;
      card.querySelector('.edit-agenda-btn').addEventListener('click', () => openBookingModal(b.id));
      container.appendChild(card);
    });
  }

  // ---------- Dashboard ----------
  const FALLBACK_EVENT_COUNT = 4;

  function renderDashboard() {
    const all = Storage.getAll();
    const todayISO = CalendarView.toISODate(new Date());
    const now = new Date();
    const monthEndISO = CalendarView.toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const totalBookings = all.length;
    const pendingAmount = all.reduce((sum, b) => sum + (Storage.paymentStatus(b) !== 'paid' ? Storage.computeRemaining(b) : 0), 0);
    const unpaidCount = all.filter((b) => Storage.paymentStatus(b) !== 'paid').length;
    const upcomingCount = all.filter((b) => b.slots.some((s) => s.date >= todayISO)).length;

    el('summaryGrid').innerHTML = `
      <div class="summary-card"><div class="summary-num">${totalBookings}</div><div class="summary-label">Total Bookings</div></div>
      <div class="summary-card"><div class="summary-num">${upcomingCount}</div><div class="summary-label">Upcoming Events</div></div>
      <div class="summary-card"><div class="summary-num">${unpaidCount}</div><div class="summary-label">Pending Payments</div></div>
      <div class="summary-card"><div class="summary-num">₹${pendingAmount}</div><div class="summary-label">Amount Due</div></div>
    `;

    // Soonest-upcoming-date first, for sorting either list below.
    const withNextDate = all
      .map((b) => ({ booking: b, nextDate: b.slots.map((s) => s.date).filter((d) => d >= todayISO).sort()[0] }))
      .filter((x) => x.nextDate)
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate));

    const thisMonth = withNextDate.filter((x) => x.nextDate <= monthEndISO);
    let list = thisMonth;
    let title = 'Upcoming This Month';
    if (thisMonth.length === 0) {
      list = withNextDate.slice(0, FALLBACK_EVENT_COUNT);
      title = 'Next Upcoming Events';
    }

    el('upcomingTitle').textContent = title;
    renderAgendaList(el('upcomingList'), list.map((x) => x.booking));
  }

  // ---------- Export / Import ----------
  function bindExportImport() {
    el('btnExport').addEventListener('click', () => {
      const json = Storage.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `event-bookings-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Backup exported.');
    });

    el('btnClearAll').addEventListener('click', () => {
      const total = Storage.getAll().length;
      if (!total) {
        showToast('Nothing to delete — no bookings saved.');
        return;
      }
      const ok = confirm(
        `Delete all ${total} booking(s) from this device?\n\n` +
        'Make sure you exported a backup first — you can restore it later with Import.\n\n' +
        'This cannot be undone.'
      );
      if (!ok) return;
      const removed = Storage.clearAll();
      renderCalendar();
      renderAgenda();
      renderDashboard();
      showToast(`Deleted ${removed} booking(s). Restore anytime with Import.`);
    });

    el('btnImport').addEventListener('click', () => el('fileImport').click());    el('fileImport').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const replace = confirm('Click OK to REPLACE all current data with this file, or Cancel to MERGE it with existing data.');
          const count = Storage.importJSON(reader.result, replace ? 'replace' : 'merge');
          renderCalendar();
          renderAgenda();
          renderDashboard();
          showToast(`Imported ${count} booking(s).`);
        } catch (err) {
          showToast('Import failed: ' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  // ---------- Utilities ----------
  function showToast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.add('hidden'), 2800);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Name is optional since this app is primarily used to look up payments by date.
  function displayName(booking) {
    return (booking.customerName || '').trim() || 'Walk-in guest';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
