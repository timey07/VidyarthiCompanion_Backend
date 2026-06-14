/**
 * Seeds demo community graph + schedule events + wellness logs + a mess alert
 * so the consensus lifecycle, node sharing, and Empathy Mesh are demoable.
 *
 * Run AFTER seedUsers.js:  node src/seedDemoData.js
 * Idempotent: skips records that already exist.
 */
require('dotenv').config();
const connectDB = require('./core/db');
const User = require('./sharedModels/User.model');
const AcademicEvent = require('./sharedModels/AcademicEvent.model');
const LifestyleLog = require('./sharedModels/LifestyleLog.model');
const CommunityNode = require('./sharedModels/CommunityNode.model');
const CommunityAlert = require('./sharedModels/CommunityAlert.model');

const NODE_ID = 'cse-a-class';
const CR = 'cr_aarav';
const MEMBERS = ['cr_aarav', 'student_isha', 'student_rohan'];
const DEMO_USER = 'student_isha';

const day = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

// Shared class events (posted by the CR, so they auto-verify) + one personal event.
const EVENTS = [
  { userId: CR, nodeId: NODE_ID, eventName: 'Algorithms Lecture', date: day(1), location: 'Hall B', confidenceScore: 0.88, consensusScore: 3, status: 'verified' },
  { userId: CR, nodeId: NODE_ID, eventName: 'Data Structures Midterm', date: day(3), location: 'Room 402', confidenceScore: 0.95, consensusScore: 3, status: 'verified' },
  { userId: 'student_rohan', nodeId: NODE_ID, eventName: 'OS Class Reschedule', date: day(2), location: 'TBD', confidenceScore: 0.7, consensusScore: 1, status: 'pending' },
  { userId: DEMO_USER, nodeId: null, eventName: 'Robotics Club Fest', date: day(5), location: 'Auditorium', confidenceScore: 0.7, consensusScore: 1, status: 'pending' },
];

const LOGS = [
  { logType: 'sleep', severity: 9, notes: 'Only 3 hours of sleep' },
  { logType: 'stress_level', severity: 8, notes: 'Back-to-back deadlines' },
  { logType: 'meal_skipped', severity: 6 },
];

(async () => {
  try {
    await connectDB();

    // 1. Community node (class section).
    let node = await CommunityNode.findOne({ nodeId: NODE_ID });
    if (!node) {
      node = await CommunityNode.create({
        nodeId: NODE_ID,
        name: 'CSE-A Class',
        nodeType: 'Academic',
        crUserId: CR,
        members: MEMBERS,
        nodeRules: { privacy: 'open' },
      });
      console.log('[seed-demo] created node CSE-A Class.');
    } else {
      console.log('[seed-demo] node already exists; skipping.');
    }
    await User.updateMany({ userId: { $in: MEMBERS } }, { $addToSet: { communityNodeIds: NODE_ID } });

    // 1b. Logistical node (carpool circle) — powers the carpool synergy.
    const CARPOOL_ID = 'carpool-circle';
    const CARPOOL_MEMBERS = ['student_isha', 'student_rohan'];
    if (!(await CommunityNode.findOne({ nodeId: CARPOOL_ID }))) {
      await CommunityNode.create({
        nodeId: CARPOOL_ID,
        name: 'Hostel Carpool Circle',
        nodeType: 'Logistical',
        crUserId: null,
        members: CARPOOL_MEMBERS,
        nodeRules: { privacy: 'open' },
      });
      console.log('[seed-demo] created Logistical node Hostel Carpool Circle.');
    }
    await User.updateMany({ userId: { $in: CARPOOL_MEMBERS } }, { $addToSet: { communityNodeIds: CARPOOL_ID } });

    // 2. Schedule events.
    const existing = await AcademicEvent.countDocuments({ nodeId: NODE_ID });
    if (existing > 0) {
      console.log('[seed-demo] node events already exist; skipping events.');
    } else {
      await AcademicEvent.insertMany(EVENTS);
      console.log(`[seed-demo] inserted ${EVENTS.length} events.`);
    }

    // 3. Wellness logs (trigger a Safe-Skip for the demo user).
    const recentLogs = await LifestyleLog.countDocuments({
      userId: DEMO_USER,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (recentLogs > 0) {
      console.log('[seed-demo] recent wellness logs exist; skipping logs.');
    } else {
      await LifestyleLog.insertMany(LOGS.map((l) => ({ ...l, userId: DEMO_USER })));
      console.log(`[seed-demo] inserted ${LOGS.length} wellness logs.`);
    }

    // 4. Mess alert.
    const alertId = 'mess_overcrowded_main';
    const alert = await CommunityAlert.findOne({ alertId });
    if (!alert) {
      await CommunityAlert.create({
        alertId,
        message: 'Main Mess is overcrowded and dinner quality is flagged. Recommendation: outside/affordable dining.',
        nodeType: 'Mess',
        upvotes: 12,
        downvotes: 2,
      });
      console.log('[seed-demo] created mess alert.');
    } else {
      console.log('[seed-demo] mess alert already exists; skipping.');
    }

    console.log('[seed-demo] done.');
    process.exit(0);
  } catch (err) {
    console.error('[seed-demo] failed:', err);
    process.exit(1);
  }
})();
