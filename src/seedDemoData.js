/**
 * Seeds demo schedule events + wellness logs so the consensus lifecycle and
 * Empathy Mesh are immediately visible in a demo.
 *
 * Run AFTER seedUsers.js:  node src/seedDemoData.js
 * Idempotent: skips if demo events already exist for the user.
 */
require('dotenv').config();
const connectDB = require('./core/db');
const AcademicEvent = require('./sharedModels/AcademicEvent.model');
const LifestyleLog = require('./sharedModels/LifestyleLog.model');

const DEMO_USER = 'student_isha';
const day = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const EVENTS = [
  { eventName: 'Algorithms Lecture', date: day(1), location: 'Hall B', confidenceScore: 0.88, consensusScore: 3, status: 'verified' },
  { eventName: 'Data Structures Midterm', date: day(3), location: 'Room 402', confidenceScore: 0.95, consensusScore: 1, status: 'pending' },
  { eventName: 'Robotics Club Fest', date: day(5), location: 'Auditorium', confidenceScore: 0.7, consensusScore: 0, status: 'pending' },
];

// High sleep deficit + stress in the last 24h -> burnout score crosses the Safe-Skip threshold.
const LOGS = [
  { logType: 'sleep', severity: 9, notes: 'Only 3 hours of sleep' },
  { logType: 'stress_level', severity: 8, notes: 'Back-to-back deadlines' },
  { logType: 'meal_skipped', severity: 6 },
];

(async () => {
  try {
    await connectDB();

    const existing = await AcademicEvent.countDocuments({ userId: DEMO_USER });
    if (existing > 0) {
      console.log(`[seed-demo] ${DEMO_USER} already has ${existing} events; skipping events.`);
    } else {
      await AcademicEvent.insertMany(EVENTS.map((e) => ({ ...e, userId: DEMO_USER })));
      console.log(`[seed-demo] inserted ${EVENTS.length} events for ${DEMO_USER}.`);
    }

    const recentLogs = await LifestyleLog.countDocuments({
      userId: DEMO_USER,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (recentLogs > 0) {
      console.log(`[seed-demo] ${DEMO_USER} already has recent wellness logs; skipping logs.`);
    } else {
      await LifestyleLog.insertMany(LOGS.map((l) => ({ ...l, userId: DEMO_USER })));
      console.log(`[seed-demo] inserted ${LOGS.length} wellness logs for ${DEMO_USER}.`);
    }

    console.log('[seed-demo] done.');
    process.exit(0);
  } catch (err) {
    console.error('[seed-demo] failed:', err);
    process.exit(1);
  }
})();
