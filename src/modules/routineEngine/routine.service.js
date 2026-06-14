const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const User = require('../../sharedModels/User.model');
const { calculateBurnoutScore } = require('../empathyMesh/safeSkip.service');
const { calculateAffordableMeals, daysRemainingInMonth } = require('../pocketBuddy/meal.service');
const { getUserNodeIds } = require('../communityEngine/node.controller');

// How far ahead the daily plan looks (today + upcoming week).
const HORIZON_DAYS = 7;

// Priority is the heart of the routine engine: tests ALWAYS rank highest, then
// strategic-rest, deadlines, budget, labs, classes, and social events last.
const EVENT_RULES = [
  { re: /exam|midterm|final|test|quiz|viva/i, type: 'exam', priority: 100 },
  { re: /assignment|deadline|submission|\bdue\b|project/i, type: 'deadline', priority: 85 },
  { re: /lab|practical/i, type: 'lab', priority: 65 },
  { re: /lecture|class|tutorial|seminar/i, type: 'class', priority: 55 },
  { re: /club|fest|meetup|sync|outing|party|event/i, type: 'event', priority: 35 },
];

/** Classify an event by name into a type + base priority. */
const classifyEvent = (name = '') => {
  for (const rule of EVENT_RULES) {
    if (rule.re.test(name)) return { type: rule.type, priority: rule.priority };
  }
  return { type: 'class', priority: 50 };
};

/**
 * Assemble the prioritized daily plan: a single read-time aggregation of the
 * student's verified/pending events + wellbeing + budget into Zero-UI cards.
 */
const assembleDailyPlan = async (userId) => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const horizon = new Date(start);
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);

  // Events visible to the user: their own + anything shared with their nodes.
  const myNodeIds = await getUserNodeIds(userId);

  const [user, events, burnout] = await Promise.all([
    User.findOne({ userId }),
    // Only FUTURE, consensus-VERIFIED events reach Today's Plan (more echoes
    // than flags). Pending / rejected updates live only in the community feed.
    AcademicEvent.find({
      $or: [{ userId }, { nodeId: { $in: myNodeIds } }],
      date: { $gte: now, $lte: horizon },
      status: 'verified',
    }).sort({ date: 1 }),
    calculateBurnoutScore(userId),
  ]);

  // Derive the live wallet view.
  let wallet = null;
  if (user) {
    const { amazonPayBalance, monthlyBudget, currency } = user.financialConfig;
    const meal = calculateAffordableMeals(amazonPayBalance, daysRemainingInMonth());
    wallet = {
      balance: Number(amazonPayBalance.toFixed(2)),
      currency,
      isCritical: amazonPayBalance < monthlyBudget * 0.1,
      cheapestOption: meal.affordableOptions[0] || null,
      dailyMealThreshold: meal.targetThreshold,
    };
  }

  const cards = [];

  // 1. Academic event cards (tests rank highest).
  for (const ev of events) {
    const { type, priority } = classifyEvent(ev.eventName);
    cards.push({
      id: ev._id.toString(),
      kind: 'event',
      type,
      priority,
      title: ev.eventName,
      date: ev.date,
      location: ev.location,
      status: ev.status,
      consensusScore: ev.consensusScore,
      note: type === 'exam' ? 'High priority — block study time before this.' : null,
    });
  }

  // 2. Strategic rest (Empathy Mesh) — outranks routine classes, never an exam.
  if (burnout?.recommendSkip) {
    cards.push({
      id: 'wellbeing-safe-skip',
      kind: 'wellbeing',
      type: 'wellbeing',
      priority: 92,
      title: `Burnout high (${burnout.burnoutScore}/10) — Safe-Skip available`,
      note: burnout.reason,
      action: 'safe_skip',
    });
  }

  // 3. Budget nudge (PocketBuddy) when the wallet is critical.
  if (wallet?.isCritical) {
    const opt = wallet.cheapestOption;
    cards.push({
      id: 'budget-critical',
      kind: 'budget',
      type: 'budget',
      priority: 75,
      title: 'Budget tight — pick mess over outside dining',
      note: opt
        ? `₹${wallet.balance.toFixed(0)} left this month. Affordable: ${opt.name} (₹${opt.averageCost}).`
        : `Only ₹${wallet.balance.toFixed(0)} left this month.`,
      action: 'view_meals',
    });
  }

  // Highest priority first; for ties, the sooner item wins.
  cards.sort(
    (a, b) => b.priority - a.priority || new Date(a.date || 0) - new Date(b.date || 0)
  );

  // Immediate upcoming event (events are already sorted ascending + future-only).
  const hoursUntil = (d) => Math.round(((new Date(d).getTime() - now.getTime()) / 3600000) * 10) / 10;
  const nextEv = events[0] || null;
  const nextEvent = nextEv
    ? {
        id: nextEv._id.toString(),
        title: nextEv.eventName,
        date: nextEv.date,
        location: nextEv.location,
        hoursUntil: hoursUntil(nextEv.date),
      }
    : null;

  // Nearest upcoming deadline/exam (so no deadline is missed).
  const deadlineEv = events.find((e) => ['exam', 'deadline'].includes(classifyEvent(e.eventName).type));
  const nextDeadline = deadlineEv
    ? {
        id: deadlineEv._id.toString(),
        title: deadlineEv.eventName,
        date: deadlineEv.date,
        location: deadlineEv.location,
        type: classifyEvent(deadlineEv.eventName).type,
        hoursUntil: hoursUntil(deadlineEv.date),
      }
    : null;

  return {
    date: now,
    summary: {
      itemsInHorizon: events.length,
      horizonDays: HORIZON_DAYS,
      burnoutScore: burnout?.burnoutScore ?? 0,
      recommendSkip: burnout?.recommendSkip ?? false,
      balance: wallet?.balance ?? null,
      currency: wallet?.currency ?? 'INR',
      isBudgetCritical: wallet?.isCritical ?? false,
    },
    nextEvent,
    nextDeadline,
    cards,
  };
};

module.exports = { assembleDailyPlan, classifyEvent };
