const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const User = require('../../sharedModels/User.model');
const CommunityNode = require('../../sharedModels/CommunityNode.model');
const Meetup = require('../../sharedModels/Meetup.model');
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
 * Empathy Mesh cross-member cards. Two intertwined concerns:
 *
 *  1. Reach-out: a fellow member of one of the user's wellbeing (Empathy)
 *     communities has a HIGH burnout score and NO Meet Up arranged yet — show a
 *     gentle "Schedule a Meet Up" card.
 *  2. Meet Ups: once a Meet Up exists for a member, the burnout notice becomes a
 *     status card that every mesh member sees ("Y scheduled a Meet Up with X").
 *     The target gets an actionable invite (accept / decline / change time); the
 *     proposer sees a "pending"/"confirmed" card.
 */
const ACTIVE_MEETUP_STATUSES = ['proposed', 'accepted'];

const buildEmpathyAlerts = async (userId) => {
  const empathyNodes = await CommunityNode.find({
    members: userId,
    $or: [{ nature: 'wellbeing' }, { nodeType: 'Empathy' }],
  }).select('nodeId name members');

  if (!empathyNodes.length) return [];

  const empathyNodeIds = empathyNodes.map((n) => n.nodeId);
  const nodeNameOf = new Map(empathyNodes.map((n) => [n.nodeId, n.name]));

  // Unique fellow members across all the user's empathy circles.
  const peers = new Map(); // memberId -> { nodeId, nodeName }
  for (const node of empathyNodes) {
    for (const memberId of node.members) {
      if (memberId !== userId && !peers.has(memberId)) {
        peers.set(memberId, { nodeId: node.nodeId, nodeName: node.name });
      }
    }
  }
  const peerIds = [...peers.keys()];

  // Active Meet Ups anywhere in the user's empathy circles + peer burnout scores.
  const [meetups, scores] = await Promise.all([
    Meetup.find({ status: { $in: ACTIVE_MEETUP_STATUSES }, nodeId: { $in: empathyNodeIds } }),
    peerIds.length
      ? Promise.all(peerIds.map((id) => calculateBurnoutScore(id).catch(() => null)))
      : Promise.resolve([]),
  ]);
  const burnoutOf = new Map(peerIds.map((id, i) => [id, scores[i]]));

  // Names for anyone we might mention (peers + meetup participants).
  const mentionIds = new Set(peerIds);
  for (const m of meetups) {
    mentionIds.add(m.initiatorId);
    mentionIds.add(m.targetId);
  }
  const users = await User.find({ userId: { $in: [...mentionIds] } }).select('userId name');
  const nameOf = new Map(users.map((u) => [u.userId, u.name]));
  const label = (id) => nameOf.get(id) || 'A member';

  // Members already engaged in an active Meet Up -> suppress their reach-out card.
  const engaged = new Set();
  for (const m of meetups) {
    engaged.add(m.initiatorId);
    engaged.add(m.targetId);
  }

  const cards = [];

  // 1) Meet Up cards (these REPLACE the burnout notice once a Meet Up exists).
  for (const m of meetups) {
    const iAmParticipant = m.initiatorId === userId || m.targetId === userId;
    const otherId = m.initiatorId === userId ? m.targetId : m.initiatorId;
    const nodeName = nodeNameOf.get(m.nodeId) || 'your Empathy Mesh';
    const meetupId = m._id.toString();

    if (iAmParticipant && m.status === 'proposed' && m.pendingForId === userId) {
      // It's MY turn to respond -> actionable invite.
      cards.push({
        id: `meetup-invite-${meetupId}`,
        kind: 'wellbeing',
        type: 'meetup_invite',
        priority: 90,
        title: `${label(m.proposedById)} scheduled a Meet Up with you`,
        note: `In "${nodeName}". Accept, decline, or pick a new time.`,
        date: m.startAt,
        meetupId,
        nodeId: m.nodeId,
        otherUserId: otherId,
        status: m.status,
      });
      continue;
    }

    if (iAmParticipant && m.status === 'proposed') {
      // I proposed; waiting on the other side.
      cards.push({
        id: `meetup-wait-${meetupId}`,
        kind: 'wellbeing',
        type: 'empathy_alert',
        priority: 80,
        title: `Meet Up pending with ${label(otherId)}`,
        note: `Waiting for them to confirm the time in "${nodeName}".`,
        date: m.startAt,
      });
      continue;
    }

    if (iAmParticipant && m.status === 'accepted') {
      cards.push({
        id: `meetup-confirmed-${meetupId}`,
        kind: 'wellbeing',
        type: 'empathy_alert',
        priority: 80,
        title: `Meet Up confirmed with ${label(otherId)}`,
        note: `Added to your calendar · "${nodeName}".`,
        date: m.startAt,
      });
      continue;
    }

    // I'm a fellow member (not a participant): mesh-wide status visibility.
    cards.push({
      id: `meetup-mesh-${meetupId}`,
      kind: 'wellbeing',
      type: 'empathy_alert',
      priority: 70,
      title: `${label(m.initiatorId)} scheduled a Meet Up with ${label(m.targetId)}`,
      note: `In your Empathy Mesh "${nodeName}".`,
      date: m.startAt,
    });
  }

  // 2) Reach-out cards: HIGH-burnout peers WITHOUT a Meet Up arranged yet.
  for (const memberId of peerIds) {
    if (engaged.has(memberId)) continue;
    const score = burnoutOf.get(memberId);
    if (!score || !score.recommendSkip) continue;
    const ctx = peers.get(memberId);
    cards.push({
      id: `empathy-alert-${memberId}`,
      kind: 'wellbeing',
      type: 'empathy_alert',
      priority: 88,
      title: `${label(memberId)} may be struggling (burnout ${score.burnoutScore}/10)`,
      note: `In your Empathy Mesh "${ctx.nodeName}". Schedule a Meet Up to check in.`,
      action: 'meet_up',
      nodeId: ctx.nodeId,
      memberId,
    });
  }

  return cards;
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

  // 4. Empathy Mesh — fellow members in distress (reach-out cards).
  const empathyAlerts = await buildEmpathyAlerts(userId);
  for (const alert of empathyAlerts) cards.push(alert);

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
