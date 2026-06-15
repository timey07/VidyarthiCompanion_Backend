/**
 * Seeds a few demo users for VidyarthiCompanion (India-centric, INR).
 *
 * Usage:  node src/seedUsers.js
 * Requires MONGO_URI in the environment (.env).
 *
 * Idempotent: existing emails are skipped, not duplicated.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('./core/db');
const User = require('./sharedModels/User.model');

const DEMO_USERS = [
  {
    userId: 'cr_aarav',
    name: 'Aarav Sharma',
    email: 'cr@vidyarthicompanion.in',
    password: 'password123',
    role: 'cr',
    trustScore: 3.0,
    financialConfig: { monthlyBudget: 9000, amazonPayBalance: 2500, currency: 'INR' },
  },
  {
    userId: 'student_isha',
    name: 'Isha Patel',
    email: 'isha@vidyarthicompanion.in',
    password: 'password123',
    role: 'student',
    trustScore: 1.0,
    financialConfig: { monthlyBudget: 8000, amazonPayBalance: 2000, currency: 'INR' },
  },
  {
    userId: 'student_rohan',
    name: 'Rohan Mehta',
    email: 'rohan@vidyarthicompanion.in',
    password: 'password123',
    role: 'student',
    trustScore: 1.0,
    financialConfig: { monthlyBudget: 7000, amazonPayBalance: 1500, currency: 'INR' },
  },
];

(async () => {
  try {
    await connectDB();
    for (const u of DEMO_USERS) {
      const existing = await User.findOne({ email: u.email });
      if (existing) {
        console.log(`[seed] skip existing: ${u.email}`);
        continue;
      }
      const passwordHash = await bcrypt.hash(u.password, 10);
      const { password, ...rest } = u;
      await User.create({ ...rest, passwordHash });
      console.log(`[seed] created: ${u.email} (${u.role})`);
    }
    console.log('[seed] done.');
    process.exit(0);
  } catch (err) {
    console.error('[seed] failed:', err);
    process.exit(1);
  }
})();
