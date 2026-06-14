const AttendanceRecord = require('../../sharedModels/AttendanceRecord.model');
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const Transaction = require('../../sharedModels/Transaction.model');
const LifestyleLog = require('../../sharedModels/LifestyleLog.model');
const { classifyEvent } = require('../routineEngine/routine.service');

/**
 * Wellness Tracker & Burnout Score engine.
 *
 * Everything here is derived AUTOMATICALLY from telemetry the rest of the
 * platform already collects (presence/geofence check-ins, the PocketBuddy
 * ledger, the academic schedule) plus a single manual signal: the student's
 * nightly sleep-cycle dropdown.
 *
 *   Tiredness = 0.50*sleep + 0.35*study/class load + 0.15*attendance
 *   Isolation = 0.45*missing meals + 0.55*missed schedule (routine consistency)
 *   Burnout   = 0.50*Tiredness + 0.50*Isolation              (0..10)
 *
 * Levels:  0.0-3.9 LOW  ·  4.0-6.9 MODERATE  ·  7.0-10 HIGH
 */

// --- Tuning constants -------------------------------------------------------

// Sleep dropdown buckets -> { representative hours, tiredness contribution }.
const SLEEP_BUCKETS = {
  '4-6 hrs': { midHours: 5, tiredness: 8 },
  '6-8 hrs': { midHours: 7, tiredness: 4 },
  '8-10 hrs': { midHours: 9, tiredness: 1 },
  '10-12 hrs': { midHours: 11, tiredness: 2 },
};

const TIREDNESS_WEIGHTS = { sleep: 0.5, study: 0.35, attendance: 0.15 };
const ISOLATION_WEIGHTS = { meals: 0.45, schedule: 0.55 };
const OVERALL_WEIGHTS = { tiredness: 0.5, isolation: 0.5 };

const ATTENDANCE_WINDOW_DAYS = 10; // attendance + schedule history window
const SCHEDULE_DOTS = 5; // recent routines shown as red/grey dots
const EXPECTED_MEALS_PER_DAY = 2; // mirrors pocketBuddy/meal.service
const ASSUMED_CLASS_HOURS = 1.5; // duration per scheduled class/lab/exam block
const HEALTHY_STUDY_HOURS = 8; // study hours that map to max tiredness
const LOW_WELLNESS_OVERALL = 6; // overall >= this == a "poor wellness" day
const MOOD_PROMPT_DAYS = 2; // consecutive poor days before prompting a survey

const CLASS_ZONE = 'Room 402';
const MESS_ZONE = 'Campus Mess';
const ACADEMIC_TYPES = ['class', 'lab', 'exam', 'deadline'];

// --- Small helpers ----------------------------------------------------------

const clamp = (n, min = 0, max = 10) => Math.max(min, Math.min(max, n));
const round1 = (n) => Math.round(n * 10) / 10;

/** Start/end of the calendar day `dayOffset` days before `ref` (0 = today). */
function dayBounds(dayOffset = 0, ref = new Date()) {
  const start = new Date(ref);
  start.setDate(start.getDate() - dayOffset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** YYYY-MM-DD key in local time (used to group telemetry by day). */
function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// --- Factor: Sleep ----------------------------------------------------------

/**
 * Sleep tiredness uses the most recent dropdown log up to `dayEnd`; the
 * displayed average uses the representative hours of the last 7 logs.
 */
async function getSleep(userId, dayStart, dayEnd) {
  const logs = await LifestyleLog.find({
    userId,
    logType: 'sleep',
    createdAt: { $lte: dayEnd },
  })
    .sort({ createdAt: -1 })
    .limit(7);

  if (logs.length === 0) {
    return { hasToday: false, avgHours: null, tiredness: 5, series: [] };
  }

  const latest = logs[0];
  const latestBucket = SLEEP_BUCKETS[latest.notes] || null;
  const tiredness = latestBucket ? latestBucket.tiredness : clamp(latest.severity || 5);
  const hasToday = latest.createdAt >= dayStart && latest.createdAt <= dayEnd;

  // Representative-hours series (oldest -> newest) for the mini bar chart.
  const series = [...logs]
    .reverse()
    .map((l) => (SLEEP_BUCKETS[l.notes] ? SLEEP_BUCKETS[l.notes].midHours : null))
    .filter((h) => h != null);

  const avgHours = series.length
    ? round1(series.reduce((a, b) => a + b, 0) / series.length)
    : null;

  return { hasToday, avgHours, tiredness, series };
}

// --- Factor: Attendance + Schedule consistency ------------------------------

/**
 * Builds the 10-day attendance picture and the routine-consistency signal from
 * the same source so the two factors stay coherent:
 *   - attendance.pct        -> tiredness (being in class burns energy) + display
 *   - schedule misses/dots  -> isolation (missed routines, the inverse of
 *                              attendance, per the spec)
 *
 * A scheduled academic event counts as "attended" when there is a class-zone
 * check-in on the same calendar day. When the student has no scheduled events
 * in the window we fall back to a presence proxy (days seen on campus) so the
 * tracker still renders meaningful bars.
 */
async function getAttendanceAndSchedule(userId, windowStart, windowEnd) {
  const [events, checkins] = await Promise.all([
    AcademicEvent.find({
      userId,
      date: { $gte: windowStart, $lte: windowEnd },
      status: { $ne: 'rejected' },
    }).sort({ date: 1 }),
    AttendanceRecord.find({
      userId,
      locationName: CLASS_ZONE,
      action: 'check_in',
      timestamp: { $gte: windowStart, $lte: windowEnd },
    }).sort({ timestamp: 1 }),
  ]);

  const classEvents = events.filter((e) =>
    ACADEMIC_TYPES.includes(classifyEvent(e.eventName).type)
  );

  // Set of day-keys on which the student was physically in the class zone.
  const presenceDays = new Set(checkins.map((c) => dayKey(c.timestamp)));

  // Build the rolling list of the last N calendar days (oldest -> newest).
  const days = [];
  for (let i = ATTENDANCE_WINDOW_DAYS - 1; i >= 0; i--) {
    const { start } = dayBounds(i, windowEnd);
    days.push({ date: start, key: dayKey(start), label: WEEKDAY[start.getDay()] });
  }

  const usingSchedule = classEvents.length > 0;
  const hasPresence = checkins.length > 0;
  let totalScheduled = 0;
  let totalAttended = 0;
  const routinePoints = []; // chronological {date, attended} for the dots

  const series = days.map((d) => {
    let scheduled = 0;
    let attended = 0;

    if (usingSchedule) {
      const dayEvents = classEvents.filter((e) => dayKey(e.date) === d.key);
      scheduled = dayEvents.length;
      attended = dayEvents.filter(() => presenceDays.has(d.key)).length;
      dayEvents.forEach(() =>
        routinePoints.push({ date: d.date, attended: presenceDays.has(d.key) })
      );
    } else {
      // Presence proxy: each day is one implicit "routine". We only score this
      // when the student actually produces GPS check-ins; with zero telemetry
      // we cannot tell a brand-new user from an isolated one, so we stay
      // neutral (no fabricated misses) rather than report worst-case isolation.
      scheduled = 1;
      attended = presenceDays.has(d.key) ? 1 : 0;
      if (hasPresence) routinePoints.push({ date: d.date, attended: attended === 1 });
    }

    totalScheduled += scheduled;
    totalAttended += attended;
    const pct = scheduled > 0 ? Math.round((attended / scheduled) * 100) : 0;
    return { label: d.label, date: d.date, scheduled, attended, pct };
  });

  const pct = totalScheduled > 0 ? Math.round((totalAttended / totalScheduled) * 100) : 0;
  // Consistency is 1 (no misses) when there are no scored routines at all.
  const consistency = routinePoints.length > 0 ? totalAttended / totalScheduled : 1;

  // Most recent SCHEDULE_DOTS routines -> red(false)/grey-or-green(true) dots.
  const recent = routinePoints.slice(-SCHEDULE_DOTS);
  const dots = recent.map((p) => p.attended);
  const missedCount = recent.filter((p) => !p.attended).length;

  return {
    pct,
    series,
    usingSchedule,
    rawCheckins: checkins.length,
    rawEvents: classEvents.length,
    schedule: { consistency, missedCount, dots, totalRoutines: routinePoints.length },
  };
}

// --- Factor: Study / class load --------------------------------------------

/**
 * Hours spent in study/classes today. Uses the larger of (a) scheduled class
 * blocks * assumed duration and (b) the span of class-zone presence today.
 */
async function getStudyHours(userId, dayStart, dayEnd) {
  const [events, checkins] = await Promise.all([
    AcademicEvent.find({
      userId,
      date: { $gte: dayStart, $lte: dayEnd },
      status: { $ne: 'rejected' },
    }),
    AttendanceRecord.find({
      userId,
      locationName: CLASS_ZONE,
      action: 'check_in',
      timestamp: { $gte: dayStart, $lte: dayEnd },
    }).sort({ timestamp: 1 }),
  ]);

  const classCount = events.filter((e) =>
    ACADEMIC_TYPES.includes(classifyEvent(e.eventName).type)
  ).length;
  const scheduledHours = classCount * ASSUMED_CLASS_HOURS;

  let presenceHours = 0;
  if (checkins.length >= 2) {
    const first = checkins[0].timestamp.getTime();
    const last = checkins[checkins.length - 1].timestamp.getTime();
    presenceHours = (last - first) / 3600000;
  } else if (checkins.length === 1) {
    presenceHours = ASSUMED_CLASS_HOURS; // a single ping ~ one block
  }

  return round1(Math.max(scheduledHours, presenceHours));
}

// --- Factor: Missing meals --------------------------------------------------

/**
 * How many meals we expect to have been eaten by `ref` time-of-day. Avoids
 * flagging dinner as "missed" at 9am. Past days always expect the full count.
 */
function expectedMealsByNow(ref = new Date()) {
  const h = ref.getHours();
  if (h < 11) return 0; // morning: nothing reasonably missed yet
  if (h < 16) return 1; // afternoon: ~1 meal expected by now
  return EXPECTED_MEALS_PER_DAY; // evening: both meals expected
}

/**
 * A meal is "detected" via either a food-category spend or a Campus Mess
 * check-in. Mess pings are collapsed into ~3h windows so the 5-minute presence
 * loop can't fake multiple meals. Missed = max(0, expected - detected), where
 * `expected` is time-aware for the current day.
 */
async function getMeals(userId, dayStart, dayEnd, expected = EXPECTED_MEALS_PER_DAY) {
  const [foodTx, messCheckins] = await Promise.all([
    Transaction.find({
      userId,
      type: 'debit',
      category: 'food',
      createdAt: { $gte: dayStart, $lte: dayEnd },
    }),
    AttendanceRecord.find({
      userId,
      locationName: MESS_ZONE,
      action: 'check_in',
      timestamp: { $gte: dayStart, $lte: dayEnd },
    }),
  ]);

  // Distinct ~3-hour mess windows.
  const messWindows = new Set(
    messCheckins.map((c) => Math.floor(new Date(c.timestamp).getHours() / 3))
  );

  const detected = Math.min(EXPECTED_MEALS_PER_DAY, foodTx.length + messWindows.size);
  const missed = Math.max(0, expected - detected);

  let status;
  if (expected === 0) status = 'No meals expected yet today';
  else if (missed === 0) status = 'No mess/ordering missed';
  else if (detected === 0) status = 'No meals detected yet';
  else status = `${missed} of ${expected} meal${expected > 1 ? 's' : ''} missed`;

  return { detected, missed, expected, status };
}

// --- Per-day score assembly -------------------------------------------------

/**
 * Compute the tiredness/isolation/overall scores for a single calendar day.
 * `withSeries` controls whether the heavier display series are attached
 * (true for "today", false for the look-back days that only need `overall`).
 */
async function computeDayScores(userId, dayOffset = 0, withSeries = true) {
  const { start: dayStart, end: dayEnd } = dayBounds(dayOffset);
  const { end: windowEnd } = dayBounds(dayOffset); // attendance window ends this day

  // Today's meal expectation is time-aware; past days expect the full count.
  const expectedMeals = dayOffset === 0 ? expectedMealsByNow() : EXPECTED_MEALS_PER_DAY;

  const [sleep, attendance, studyHours, meals] = await Promise.all([
    getSleep(userId, dayStart, dayEnd),
    getAttendanceAndSchedule(userId, dayBounds(dayOffset + ATTENDANCE_WINDOW_DAYS - 1).start, windowEnd),
    getStudyHours(userId, dayStart, dayEnd),
    getMeals(userId, dayStart, dayEnd, expectedMeals),
  ]);

  // Tiredness sub-scores (0..10).
  const sleepT = sleep.tiredness;
  const studyT = clamp((studyHours / HEALTHY_STUDY_HOURS) * 10);
  const attendanceT = clamp((attendance.pct / 100) * 10);
  const tiredness = round1(
    TIREDNESS_WEIGHTS.sleep * sleepT +
      TIREDNESS_WEIGHTS.study * studyT +
      TIREDNESS_WEIGHTS.attendance * attendanceT
  );

  // Isolation sub-scores (0..10).
  const missingMealsScore = meals.expected > 0 ? (meals.missed / meals.expected) * 10 : 0;
  const missedScheduleScore = clamp((1 - attendance.schedule.consistency) * 10);
  const isolation = round1(
    ISOLATION_WEIGHTS.meals * missingMealsScore +
      ISOLATION_WEIGHTS.schedule * missedScheduleScore
  );

  const overall = round1(
    OVERALL_WEIGHTS.tiredness * tiredness + OVERALL_WEIGHTS.isolation * isolation
  );

  // No telemetry of any kind -> we shouldn't imply burnout from absence of data.
  const insufficientData =
    sleep.series.length === 0 &&
    attendance.rawCheckins === 0 &&
    attendance.rawEvents === 0 &&
    meals.detected === 0;

  const result = { tiredness, isolation, overall, insufficientData };

  if (withSeries) {
    result.detail = {
      sleep,
      attendance,
      studyHours,
      meals,
      studyTiredness: round1(studyT),
      attendanceTiredness: round1(attendanceT),
    };
  }
  return result;
}

function levelFor(overall) {
  if (overall >= 7) return 'high';
  if (overall >= 4) return 'moderate';
  return 'low';
}

// --- Public API -------------------------------------------------------------

/**
 * Full wellness snapshot for the dashboard widget.
 */
async function getWellnessSummary(userId) {
  const today = await computeDayScores(userId, 0, true);

  // Mood-questionnaire trigger: poor wellness sustained across recent days.
  // Skipped entirely when there's no telemetry to judge (insufficient data).
  let poorStreak = !today.insufficientData && today.overall >= LOW_WELLNESS_OVERALL ? 1 : 0;
  if (poorStreak > 0) {
    for (let offset = 1; offset < MOOD_PROMPT_DAYS; offset++) {
      // eslint-disable-next-line no-await-in-loop
      const past = await computeDayScores(userId, offset, false);
      if (!past.insufficientData && past.overall >= LOW_WELLNESS_OVERALL) poorStreak += 1;
      else break;
    }
  }
  const moodPromptDue = poorStreak >= MOOD_PROMPT_DAYS;

  const d = today.detail;
  return {
    overall: { score: today.overall, level: levelFor(today.overall) },
    tiredness: {
      score: today.tiredness,
      sleep: {
        avgHours: d.sleep.avgHours,
        hasToday: d.sleep.hasToday,
        tiredness: d.sleep.tiredness,
        series: d.sleep.series,
      },
      attendance: { pct: d.attendance.pct, series: d.attendance.series },
      study: { hoursToday: d.studyHours },
    },
    isolation: {
      score: today.isolation,
      meals: d.meals,
      schedule: d.attendance.schedule,
    },
    moodPromptDue,
    poorStreak,
    insufficientData: today.insufficientData,
    generatedAt: new Date(),
  };
}

/**
 * Persist the nightly sleep-cycle dropdown selection as a LifestyleLog so it
 * feeds the existing Empathy Mesh logs as well as this tracker.
 */
async function logSleepCycle(userId, bucket) {
  const cfg = SLEEP_BUCKETS[bucket];
  if (!cfg) {
    const err = new Error('Invalid sleep bucket.');
    err.statusCode = 400;
    throw err;
  }
  return LifestyleLog.create({
    userId,
    logType: 'sleep',
    severity: cfg.tiredness,
    notes: bucket,
  });
}

module.exports = {
  getWellnessSummary,
  logSleepCycle,
  // exported for testing / reuse
  SLEEP_BUCKETS,
  computeDayScores,
  levelFor,
};
