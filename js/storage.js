/**
 * Storage layer: persists bookings in localStorage as JSON.
 * Data model (Booking):
 * {
 *   id, customerName, phone, eventType,
 *   slots: [{ date: 'YYYY-MM-DD', slot: 'morning'|'evening'|'full' }, ...],
 *   totalAmount, advanceAmount, advancePaidDate,
 *   remainingPaid, remainingPaidDate,
 *   status: 'confirmed' | 'cancelled',
 *   notes, createdAt, updatedAt
 * }
 */
const Storage = (() => {
  const KEY = 'eventcal_bookings_v1';
  const TYPES_KEY = 'eventcal_event_types_v1';
  const BLOCKED_KEY = 'eventcal_blocked_dates_v1';
  const DEFAULT_EVENT_TYPES = ['Wedding', 'Birthday', 'Reception', 'Engagement', 'Corporate'];

  function loadCustomTypes() {
    try {
      const raw = localStorage.getItem(TYPES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.error('Failed to load event types', e);
      return [];
    }
  }

  // Built-in types first, then any custom ones the user has added.
  function getEventTypes() {
    const merged = DEFAULT_EVENT_TYPES.slice();
    loadCustomTypes().forEach((t) => {
      const clean = String(t || '').trim();
      if (clean && !merged.some((m) => m.toLowerCase() === clean.toLowerCase())) merged.push(clean);
    });
    return merged;
  }

  function addEventType(name) {
    const clean = String(name || '').trim();
    if (!clean) return getEventTypes();
    if (getEventTypes().some((t) => t.toLowerCase() === clean.toLowerCase())) return getEventTypes();
    const custom = loadCustomTypes();
    custom.push(clean);
    localStorage.setItem(TYPES_KEY, JSON.stringify(custom));
    return getEventTypes();
  }

  function uid() {
    return 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function loadAll() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to load bookings', e);
      return [];
    }
  }

  function saveAll(bookings) {
    localStorage.setItem(KEY, JSON.stringify(bookings));
  }

  function getAll() {
    return loadAll().filter((b) => b.status !== 'cancelled');
  }

  function getById(id) {
    return loadAll().find((b) => b.id === id) || null;
  }

  function upsert(booking) {
    const all = loadAll();
    const now = new Date().toISOString();
    if (booking.id) {
      const idx = all.findIndex((b) => b.id === booking.id);
      booking.updatedAt = now;
      if (idx >= 0) {
        all[idx] = { ...all[idx], ...booking };
      } else {
        booking.createdAt = now;
        all.push(booking);
      }
    } else {
      booking.id = uid();
      booking.createdAt = now;
      booking.updatedAt = now;
      booking.status = booking.status || 'confirmed';
      all.push(booking);
    }
    saveAll(all);
    return booking;
  }

  function remove(id) {
    const all = loadAll();
    const idx = all.findIndex((b) => b.id === id);
    if (idx >= 0) {
      all[idx].status = 'cancelled';
      all[idx].updatedAt = new Date().toISOString();
      saveAll(all);
    }
  }

  function hardRemove(id) {
    const all = loadAll().filter((b) => b.id !== id);
    saveAll(all);
  }

  // Returns bookings that occupy a given date+slot, excluding a given booking id.
  function findConflicts(dateSlots, excludeId) {
    const active = getAll();
    const conflicts = [];
    for (const b of active) {
      if (b.id === excludeId) continue;
      for (const s of b.slots) {
        for (const ds of dateSlots) {
          if (s.date !== ds.date) continue;
          const overlap =
            s.slot === 'full' || ds.slot === 'full' || s.slot === ds.slot;
          if (overlap) {
            conflicts.push({ booking: b, date: ds.date, slot: s.slot });
          }
        }
      }
    }
    return conflicts;
  }

  // Map of date -> { morning: booking|null, evening: booking|null }
  function getMonthMap(year, monthIndex) {
    const map = {};
    const all = getAll();
    for (const b of all) {
      for (const s of b.slots) {
        const d = new Date(s.date + 'T00:00:00');
        if (d.getFullYear() !== year || d.getMonth() !== monthIndex) continue;
        if (!map[s.date]) map[s.date] = { morning: null, evening: null };
        if (s.slot === 'full') {
          map[s.date].morning = b;
          map[s.date].evening = b;
        } else {
          map[s.date][s.slot] = b;
        }
      }
    }
    return map;
  }

  // ---- Blocked dates (special days like Aadi Kirthigai when no booking is taken) ----
  // Stored as { 'YYYY-MM-DD': 'reason label' }
  function loadBlockedDates() {
    try {
      const raw = localStorage.getItem(BLOCKED_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch (e) {
      console.error('Failed to load blocked dates', e);
      return {};
    }
  }

  function saveBlockedDates(map) {
    localStorage.setItem(BLOCKED_KEY, JSON.stringify(map));
  }

  function getBlockedDates() {
    return loadBlockedDates();
  }

  function getBlockedReason(dateISO) {
    const map = loadBlockedDates();
    return Object.prototype.hasOwnProperty.call(map, dateISO) ? (map[dateISO] || '') : null;
  }

  function isDateBlocked(dateISO) {
    return getBlockedReason(dateISO) !== null;
  }

  function blockDate(dateISO, reason) {
    const map = loadBlockedDates();
    map[dateISO] = String(reason || '').trim();
    saveBlockedDates(map);
  }

  function unblockDate(dateISO) {
    const map = loadBlockedDates();
    delete map[dateISO];
    saveBlockedDates(map);
  }

  function computeRemaining(booking) {    const total = Number(booking.totalAmount) || 0;
    const advance = Number(booking.advanceAmount) || 0;
    return Math.max(total - advance, 0);
  }

  function paymentStatus(booking) {
    const total = Number(booking.totalAmount) || 0;
    const advance = Number(booking.advanceAmount) || 0;
    const remaining = computeRemaining(booking);
    // No amount set at all = just a date block (walk-in reserved the date, nothing paid yet).
    if (total <= 0 && advance <= 0 && !booking.remainingPaid) return 'unpaid';
    if (remaining <= 0 || booking.remainingPaid) return 'paid';
    if (advance > 0) return 'partial';
    return 'unpaid';
  }

  function exportJSON() {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        eventTypes: loadCustomTypes(),
        blockedDates: loadBlockedDates(),
        bookings: loadAll(),
      },
      null,
      2
    );
  }

  // Wipes every booking, custom event type and blocked date. Restorable via Import.
  function clearAll() {
    const count = loadAll().length;
    localStorage.removeItem(KEY);
    localStorage.removeItem(TYPES_KEY);
    localStorage.removeItem(BLOCKED_KEY);
    return count;
  }

  function importJSON(jsonText, mode = 'merge') {
    const data = JSON.parse(jsonText);
    const incoming = Array.isArray(data) ? data : data.bookings;
    if (!Array.isArray(incoming)) throw new Error('Invalid file format');
    if (!Array.isArray(data) && Array.isArray(data.eventTypes)) {
      data.eventTypes.forEach((t) => addEventType(t));
    }
    if (!Array.isArray(data) && data.blockedDates && typeof data.blockedDates === 'object') {
      const merged = mode === 'replace' ? {} : loadBlockedDates();
      Object.keys(data.blockedDates).forEach((d) => {
        merged[d] = String(data.blockedDates[d] || '');
      });
      saveBlockedDates(merged);
    }
    if (mode === 'replace') {
      saveAll(incoming);
      return incoming.length;
    }
    // merge by id
    const existing = loadAll();
    const byId = new Map(existing.map((b) => [b.id, b]));
    for (const b of incoming) {
      byId.set(b.id, b);
    }
    saveAll(Array.from(byId.values()));
    return incoming.length;
  }

  return {
    getAll,
    getById,
    upsert,
    remove,
    hardRemove,
    findConflicts,
    getMonthMap,
    computeRemaining,
    paymentStatus,
    getEventTypes,
    addEventType,
    exportJSON,
    importJSON,
    clearAll,
    getBlockedDates,
    getBlockedReason,
    isDateBlocked,
    blockDate,
    unblockDate,
  };
})();
