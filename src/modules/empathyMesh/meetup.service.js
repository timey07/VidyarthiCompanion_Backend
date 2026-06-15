const BaselineRoutine = require('../../sharedModels/BaselineRoutine.model');
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');

/**
 * "Meet Up" free-slot finder for the Empathy Mesh.
 *
 * A FREE SLOT is any part of the day between 08:00 and 23:00, over the NEXT
 * THREE days, where BOTH members have nothing in their daily schedule. A
 * member's schedule = their weekly baseline timetable slots + their dated
 * academic events (each event assumed to occupy ~90 minutes).
 */

const DAY_START_MIN = 8 * 60; // 08:00
const DAY_END_MIN = 23 * 60; // 23:00
const LOOKAHEAD_DAYS = 3; // today + next 2 (3-day window)
const EVENT_BLOCK_MIN = 90; // assumed duration of a dated event
const MIN_SLOT_MIN = 45; // ignore slivers shorter than this

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "HH:MM" -> minutes from midnight, or null if unparseable. */
const toMinutes = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) ? mins : null;
};

/** minutes from midnight -> "HH:MM". */
const toHHMM = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** Merge overlapping [start,end] intervals (sorted ascending). */
const mergeIntervals = (intervals) => {
  const sorted = intervals
    .filter((i) => i && i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
};

/** Free gaps within [DAY_START_MIN, DAY_END_MIN] given busy intervals. */
const freeGaps = (busy) => {
  const merged = mergeIntervals(busy);
  const gaps = [];
  let cursor = DAY_START_MIN;
  for (const b of merged) {
    if (b.end <= DAY_START_MIN || b.start >= DAY_END_MIN) continue;
    const bStart = Math.max(b.start, DAY_START_MIN);
    const bEnd = Math.min(b.end, DAY_END_MIN);
    if (bStart > cursor) gaps.push({ start: cursor, end: bStart });
    cursor = Math.max(cursor, bEnd);
  }
  if (cursor < DAY_END_MIN) gaps.push({ start: cursor, end: DAY_END_MIN });
  return gaps;
};

/** Intersection of two free-gap lists. */
const intersectGaps = (a, b) => {
  const out = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end - start >= MIN_SLOT_MIN) out.push({ start, end });
    }
  }
  return out.sort((p, q) => p.start - q.start);
};

const dayBounds = (date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

/** Busy intervals (minutes from midnight) for one user on one calendar day. */
const busyForUserOnDay = async (userId, date) => {
  const weekday = DAY_NAMES[date.getDay()];
  const { start, end } = dayBounds(date);

  const [routine, events] = await Promise.all([
    BaselineRoutine.findOne({ userId }),
    AcademicEvent.find({ userId, date: { $gte: start, $lte: end }, status: { $ne: 'rejected' } }),
  ]);

  const busy = [];

  // Weekly baseline timetable slots for this weekday.
  if (routine && Array.isArray(routine.slots)) {
    for (const s of routine.slots) {
      if (s.day !== weekday) continue;
      const a = toMinutes(s.timeStart);
      const b = toMinutes(s.timeEnd);
      if (a != null && b != null && b > a) busy.push({ start: a, end: b });
    }
  }

  // Dated academic events -> ~90-minute blocks (only if they carry a time of day).
  for (const ev of events) {
    const d = new Date(ev.date);
    const mins = d.getHours() * 60 + d.getMinutes();
    if (mins <= 0) continue; // date-only events (midnight) don't block a time slot
    busy.push({ start: mins, end: mins + EVENT_BLOCK_MIN });
  }

  return busy;
};

/**
 * Find shared free slots between two users over the next LOOKAHEAD_DAYS days.
 * For "today" we never suggest a slot that has already started.
 * @returns {Promise<Array<{date, day, dateLabel, start, end, durationMin}>>}
 */
const findMeetupSlots = async (userIdA, userIdB, now = new Date()) => {
  const results = [];

  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);

    // eslint-disable-next-line no-await-in-loop
    const [busyA, busyB] = await Promise.all([
      busyForUserOnDay(userIdA, day),
      busyForUserOnDay(userIdB, day),
    ]);

    let shared = intersectGaps(freeGaps(busyA), freeGaps(busyB));

    // On today, drop slots that already ended / trim ones in progress.
    if (offset === 0) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      shared = shared
        .map((s) => ({ start: Math.max(s.start, nowMin), end: s.end }))
        .filter((s) => s.end - s.start >= MIN_SLOT_MIN);
    }

    const { start: dayStart } = dayBounds(day);
    for (const s of shared) {
      results.push({
        date: dayStart,
        day: DAY_NAMES[day.getDay()],
        dateLabel: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : DAY_NAMES[day.getDay()],
        start: toHHMM(s.start),
        end: toHHMM(s.end),
        durationMin: s.end - s.start,
      });
    }
  }

  return results;
};

module.exports = { findMeetupSlots, LOOKAHEAD_DAYS };
