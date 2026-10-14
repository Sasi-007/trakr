/**
 * Calendar rendering helpers: builds the month grid markup and date utilities.
 */
const CalendarView = (() => {
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function toISODate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function isSameDay(a, b) {
    return toISODate(a) === toISODate(b);
  }

  function initials(name) {
    if (!name) return '?';
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  // Renders a month grid (6 weeks x 7 days) into the given container.
  function renderMonth(container, year, monthIndex, monthMap, onDayClick) {
    container.innerHTML = '';
    const firstOfMonth = new Date(year, monthIndex, 1);
    const startDay = firstOfMonth.getDay(); // 0=Sun
    const gridStart = new Date(year, monthIndex, 1 - startDay);
    const today = new Date();

    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);
      const iso = toISODate(cellDate);
      const inMonth = cellDate.getMonth() === monthIndex;
      const isToday = isSameDay(cellDate, today);

      const cell = document.createElement('div');
      cell.className = 'day-cell' + (inMonth ? '' : ' dim') + (isToday ? ' today' : '');
      cell.dataset.date = iso;

      const dayNum = document.createElement('div');
      dayNum.className = 'day-num';
      dayNum.textContent = cellDate.getDate();
      cell.appendChild(dayNum);

      const blockedReason = Storage.getBlockedReason(iso);
      if (blockedReason !== null) {
        cell.classList.add('day-blocked');
        cell.title = blockedReason ? `Unavailable · ${blockedReason}` : 'Unavailable';
        const tag = document.createElement('div');
        tag.className = 'blocked-tag';
        tag.textContent = blockedReason ? `🚫 ${blockedReason}` : '🚫 Unavailable';
        cell.appendChild(tag);
      }

      const dayInfo = monthMap[iso] || { morning: null, evening: null };

      const amChip = buildSlotChip('AM', dayInfo.morning);
      const pmChip = buildSlotChip('PM', dayInfo.evening);
      // Morning sits at the top of the cell, evening at the bottom — when only one
      // slot is booked, pin it to its natural half instead of both hugging the top.
      if (amChip) cell.appendChild(amChip);
      if (pmChip) {
        if (!amChip) pmChip.classList.add('slot-chip-pinned-bottom');
        cell.appendChild(pmChip);
      }

      cell.addEventListener('click', () => onDayClick(iso));
      container.appendChild(cell);
    }
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

  function buildSlotChip(label, booking) {
    if (!booking) return null;
    const chip = document.createElement('div');
    chip.className = 'slot-chip empty';
    const status = Storage.paymentStatus(booking);
    const remaining = Storage.computeRemaining(booking);
    const total = Number(booking.totalAmount) || 0;
    const advance = Number(booking.advanceAmount) || 0;
    const name = (booking.customerName || '').trim() || 'Walk-in guest';
    const eventType = (booking.eventType || '').trim() || 'Event';
    chip.className = `slot-chip ${status}`;
    const amountLabel = total <= 0 && advance <= 0
      ? 'date blocked, no amount set'
      : status === 'paid' ? '✓ paid' : `due ₹${remaining}`;
    const fullLabel = label === 'AM' ? 'Morning' : 'Evening';
    chip.title = `${name} (${fullLabel}) - ${eventType} - ${status.toUpperCase()} - ${amountLabel}`;
    chip.textContent = `${eventIcon(eventType)} ${eventType}`;
    return chip;
  }

  return { toISODate, isSameDay, initials, renderMonth };
})();
