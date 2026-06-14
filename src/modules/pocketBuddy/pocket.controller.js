const User = require('../../sharedModels/User.model');
const Transaction = require('../../sharedModels/Transaction.model');
const CampusMerchant = require('../../sharedModels/CampusMerchant.model');
const CommunityNode = require('../../sharedModels/CommunityNode.model');
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const ConsensusVote = require('../../sharedModels/ConsensusVote.model');
const MessMenu = require('../../sharedModels/MessMenu.model');
const { calculateAffordableMeals, daysRemainingInMonth, DEFAULT_NEARBY_OPTIONS } = require('./meal.service');
const { normalizeMerchantId, prettyName, inferCategory } = require('./merchant.service');
const gemini = require('../../core/gemini.service');

const HIGH_SPEND_ABS = 500; // a single debit over this is "high spend"
const SPEND_WINDOW_DAYS = 14; // window used to estimate baseline daily spend
const VALID_CATEGORIES = [
  'food',
  'cafe',
  'restaurant',
  'grocery',
  'stationery',
  'transport',
  'entertainment',
  'recharge',
  'general',
];

// Budget-friendly, protein-forward fuel options for gym-goers (INR).
const PROTEIN_OPTIONS = [
  { name: '2 boiled eggs + banana', cost: 40, protein: '~16g' },
  { name: 'Sprouts chaat', cost: 45, protein: '~14g' },
  { name: 'Peanut chikki + milk', cost: 55, protein: '~15g' },
  { name: 'Soya chunks curry + rice', cost: 70, protein: '~22g' },
  { name: 'Paneer bhurji roll', cost: 90, protein: '~20g' },
  { name: 'Chana + curd bowl', cost: 60, protein: '~18g' },
];

/* --------------------------------- analytics -------------------------------- */

const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Budget-first analytics. The primary metric is REMAINING BUDGET, computed as
 * (effective budget) - (this month's spend), where the effective budget honours
 * the user's optional "safe buffer" savings. Runway is remaining/avg-daily-spend.
 */
const computeAnalytics = async (userId, user) => {
  const fc = user.financialConfig;
  const monthlyBudget = fc.monthlyBudget;
  const safeBufferPct = fc.safeBufferPct || 0;
  const effectiveBudget = Math.round(monthlyBudget * (1 - safeBufferPct / 100));
  const balance = Number(fc.amazonPayBalance.toFixed(2)); // live wallet (reference)
  const daysLeft = daysRemainingInMonth();

  const monthDebits = await Transaction.find({
    userId,
    type: 'debit',
    createdAt: { $gte: startOfMonth() },
  }).select('amount category');

  const spentThisMonth = monthDebits.reduce((s, t) => s + t.amount, 0);
  const remainingBudget = Number((effectiveBudget - spentThisMonth).toFixed(2)); // may be negative
  const remainingForRunway = Math.max(remainingBudget, 0);

  // Category breakdown for the month (crowdsourced tags).
  const byCat = new Map();
  for (const t of monthDebits) {
    const c = t.category || 'unknown';
    const e = byCat.get(c) || { category: c, total: 0, count: 0 };
    e.total += t.amount;
    e.count += 1;
    byCat.set(c, e);
  }
  const categoryBreakdown = [...byCat.values()]
    .map((e) => ({
      ...e,
      total: Number(e.total.toFixed(2)),
      pct: spentThisMonth > 0 ? Math.round((e.total / spentThisMonth) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Baseline daily spend over the trailing window -> runway.
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - SPEND_WINDOW_DAYS);
  const windowDebits = await Transaction.find({
    userId,
    type: 'debit',
    createdAt: { $gte: windowStart },
  }).select('amount');
  const windowSpend = windowDebits.reduce((s, t) => s + t.amount, 0);
  const avgDailySpend = Number((windowSpend / SPEND_WINDOW_DAYS).toFixed(2));
  const runwayDays = avgDailySpend > 0 ? Math.floor(remainingForRunway / avgDailySpend) : null;
  const onTrack = runwayDays == null || runwayDays >= daysLeft;

  const meal = calculateAffordableMeals(remainingForRunway, daysLeft);
  const untaggedCount = await Transaction.countDocuments({ userId, category: 'unknown' });

  return {
    balance,
    monthlyBudget,
    effectiveBudget,
    safeBufferPct,
    currency: fc.currency,
    daysLeftInMonth: daysLeft,
    spentThisMonth: Number(spentThisMonth.toFixed(2)),
    remainingBudget,
    avgDailySpend,
    runwayDays,
    onTrack,
    dailyMealThreshold: meal.targetThreshold,
    maxAffordableMeal: meal.maxAllowableCost,
    affordableOptions: meal.affordableOptions,
    // "Critical" now means the BUDGET is nearly/already exhausted, not the wallet.
    isCritical: remainingBudget <= effectiveBudget * 0.1,
    categoryBreakdown,
    untaggedCount,
  };
};

const txnDTO = (t) => ({
  id: t._id,
  vendor: t.vendor,
  merchantId: t.merchantId,
  merchantName: t.vendor,
  amount: t.amount,
  type: t.type,
  category: t.category,
  isUnknown: t.category === 'unknown',
  note: t.note || null,
  source: t.source,
  balanceAfter: t.balanceAfter,
  createdAt: t.createdAt,
});

/* ------------------------------- merchant graph ----------------------------- */

/**
 * Ensure a CampusMerchant exists, bump its txn count, and resolve a category
 * using (in order): explicit user category > crowdsourced graph > AI/text hint.
 * Mutates the graph so the campus collaboratively maps new vendors.
 */
const resolveAndLearnMerchant = async ({ merchantId, merchantRaw, note, explicitCategory, hintCategory }) => {
  let merchant = await CampusMerchant.findOne({ merchantId });
  if (!merchant) {
    merchant = await CampusMerchant.create({
      merchantId,
      displayName: prettyName(merchantRaw),
      category: 'unknown',
      categorySource: 'unknown',
    });
  }
  merchant.txnCount += 1;
  if (!merchant.displayName && merchantRaw) merchant.displayName = prettyName(merchantRaw);

  const explicit = VALID_CATEGORIES.includes(explicitCategory) ? explicitCategory : null;
  const hint = VALID_CATEGORIES.includes(hintCategory) ? hintCategory : null;

  let category = 'unknown';
  if (explicit) {
    category = explicit;
  } else if (merchant.category && merchant.category !== 'unknown') {
    category = merchant.category; // crowdsourced auto-resolution
  } else {
    category = hint || inferCategory(merchantRaw, note, merchant.displayName) || 'unknown';
  }

  // Grow the graph so other students auto-resolve later.
  if (merchant.category === 'unknown' && category !== 'unknown') {
    merchant.category = category;
    merchant.categorySource = explicit ? 'user_tag' : 'auto';
  }

  await merchant.save();
  return { category, merchant };
};

/* --------------------------------- summary ---------------------------------- */

// GET /api/v1/pocket/summary
exports.getWalletSummary = async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const analytics = await computeAnalytics(req.user.userId, user);
    const recent = await Transaction.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(8);

    return res.status(200).json({
      success: true,
      data: { ...analytics, recentTransactions: recent.map(txnDTO) },
    });
  } catch (error) {
    console.error('PocketBuddy Summary Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching wallet.' });
  }
};

// GET /api/v1/pocket/transactions?limit=&skip=
exports.listTransactions = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const skip = parseInt(req.query.skip, 10) || 0;
    const txns = await Transaction.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    return res.status(200).json({ success: true, data: txns.map(txnDTO) });
  } catch (error) {
    console.error('PocketBuddy List Txns Error:', error);
    return res.status(500).json({ success: false, message: 'Server error listing transactions.' });
  }
};

/* --------------------------------- ingest ----------------------------------- */

// POST /api/v1/pocket/ingest   (also mounted at /webhook for back-compat)
// Accepts EITHER a raw notification string { raw } (parsed by Gemini) OR
// structured fields { merchant|vendor, amount, transactionType, category, note }.
exports.ingestTransaction = async (req, res) => {
  try {
    const userId = req.user.userId;
    const body = req.body || {};

    // 1. Parse raw text with Gemini (falls back to the local parser if no key).
    let parsed = {};
    if (body.raw) parsed = await gemini.parseTransaction(body.raw);

    const amount = Number(body.amount ?? parsed.amount);
    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'Could not read a valid amount from the payment.' });
    }

    const merchantRaw = body.merchant || body.vendor || parsed.merchant || 'Unknown merchant';
    const note = body.note || parsed.note || null;
    const type = (body.transactionType || parsed.type) === 'credit' ? 'credit' : 'debit';
    const source = ['notification', 'sms', 'upi', 'amazon_pay', 'manual'].includes(body.source)
      ? body.source
      : body.raw
      ? 'notification'
      : 'amazon_pay';

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // 2. Resolve + learn the merchant category (skip graph work for credits).
    const merchantId = normalizeMerchantId(merchantRaw);
    let category = 'general';
    let merchantName = prettyName(merchantRaw);
    let resolvedVia = parsed.via || (body.raw ? 'local' : 'manual');
    if (type === 'debit') {
      const resolved = await resolveAndLearnMerchant({
        merchantId,
        merchantRaw,
        note,
        explicitCategory: body.category,
        hintCategory: parsed.inferredTag,
      });
      category = resolved.category;
      merchantName = resolved.merchant.displayName || merchantName;
    }

    // 3. Apply to the live wallet balance.
    const delta = type === 'credit' ? amount : -amount;
    user.financialConfig.amazonPayBalance = Number(
      (user.financialConfig.amazonPayBalance + delta).toFixed(2)
    );
    await user.save();

    // 4. Log the ledger entry.
    const txn = await Transaction.create({
      userId,
      vendor: merchantName,
      merchantId: type === 'debit' ? merchantId : null,
      amount,
      type,
      category,
      balanceAfter: user.financialConfig.amazonPayBalance,
      note,
      source,
    });

    const analytics = await computeAnalytics(userId, user);

    let alert = null;
    if (type === 'debit' && amount > HIGH_SPEND_ABS) {
      alert = `High spend: ₹${amount.toFixed(0)} at ${merchantName}.`;
    } else if (analytics.isCritical) {
      alert = `Budget nearly spent: ₹${analytics.remainingBudget.toFixed(0)} left for ${analytics.daysLeftInMonth} days.`;
    }

    return res.status(201).json({
      success: true,
      message: 'Transaction recorded.',
      data: {
        transaction: txnDTO(txn),
        needsTag: txn.category === 'unknown',
        parsedVia: resolvedVia,
        alert,
        summary: { ...analytics, recentTransactions: [] },
      },
    });
  } catch (error) {
    console.error('PocketBuddy Ingest Error:', error);
    return res.status(500).json({ success: false, message: 'Server error recording transaction.' });
  }
};

/* ----------------------------- crowdsourced tag ----------------------------- */

// POST /api/v1/pocket/transactions/:id/tag   { category, displayName? }
exports.tagTransaction = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { category, displayName } = req.body;
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: 'A valid category is required.' });
    }

    const txn = await Transaction.findOne({ _id: req.params.id, userId });
    if (!txn) return res.status(404).json({ success: false, message: 'Transaction not found.' });

    const merchantId = txn.merchantId || normalizeMerchantId(txn.vendor);

    const merchant = await CampusMerchant.findOneAndUpdate(
      { merchantId },
      {
        $set: {
          category,
          categorySource: 'user_tag',
          ...(displayName ? { displayName: displayName.trim() } : {}),
        },
        $setOnInsert: { taggedBy: userId },
        $inc: { confirmations: 1 },
      },
      { new: true, upsert: true }
    );
    if (!merchant.taggedBy) {
      merchant.taggedBy = userId;
      await merchant.save();
    }

    txn.category = category;
    txn.merchantId = merchantId;
    if (displayName) txn.vendor = displayName.trim();
    else if (merchant.displayName) txn.vendor = merchant.displayName;
    await txn.save();

    const backfill = await Transaction.updateMany(
      { merchantId, category: 'unknown' },
      { $set: { category } }
    );

    return res.status(200).json({
      success: true,
      message: `Tagged as ${category}. ${backfill.modifiedCount || 0} matching transactions updated campus-wide.`,
      data: { transaction: txnDTO(txn), autoResolved: backfill.modifiedCount || 0 },
    });
  } catch (error) {
    console.error('PocketBuddy Tag Error:', error);
    return res.status(500).json({ success: false, message: 'Server error tagging merchant.' });
  }
};

/* ----------------------- wallet vs wellness recommendation ------------------ */

/** Which meal slot is "current" by time of day. */
const currentMealSlot = (d = new Date()) => {
  const h = d.getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 19) return 'snacks';
  return 'dinner';
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Today's dish for the current meal slot from a community menu. */
const getTodaysDish = async (nodeId) => {
  if (!nodeId) return null;
  const menuDoc = await MessMenu.findOne({ nodeId });
  if (!menuDoc) return null;
  const today = DAY_NAMES[new Date().getDay()];
  const meals = menuDoc.menu.get(today);
  if (!meals) return null;
  const slot = currentMealSlot();
  const dish = meals[slot];
  return dish ? { slot, dish } : null;
};

/**
 * Judge Mess food quality from the consensus on recent updates in the user's
 * (preferred) Mess community. Net vote score > 0 = good, < 0 = poor.
 */
const assessMessQuality = async (userId, preferredNodeId) => {
  let messNodes = await CommunityNode.find({ members: userId, nodeType: 'Mess' }).select('nodeId name');
  if (preferredNodeId) {
    const only = messNodes.filter((n) => n.nodeId === preferredNodeId);
    if (only.length) messNodes = only;
  }
  if (messNodes.length === 0) {
    return { quality: 'unknown', netVotes: 0, echoes: 0, flags: 0, nodeCount: 0, sample: null, nodeId: null, nodeName: null };
  }

  const since = new Date();
  since.setHours(since.getHours() - 36);
  const nodeIds = messNodes.map((n) => n.nodeId);
  const events = await AcademicEvent.find({
    nodeId: { $in: nodeIds },
    createdAt: { $gte: since },
  })
    .sort({ consensusScore: 1 })
    .limit(50);

  if (events.length === 0) {
    return {
      quality: 'unknown',
      netVotes: 0,
      echoes: 0,
      flags: 0,
      nodeCount: messNodes.length,
      sample: null,
      nodeId: messNodes[0].nodeId,
      nodeName: messNodes[0].name,
    };
  }

  const votes = await ConsensusVote.find({ eventId: { $in: events.map((e) => e._id) } }).select('voteType');
  const echoes = votes.filter((v) => v.voteType === 1).length;
  const flags = votes.filter((v) => v.voteType === -1).length;
  const netVotes = echoes - flags;
  const worst = events[0];

  return {
    quality: netVotes < 0 ? 'poor' : 'good',
    netVotes,
    echoes,
    flags,
    nodeCount: messNodes.length,
    sample: worst ? { name: worst.eventName, consensusScore: worst.consensusScore } : null,
    nodeId: messNodes[0].nodeId,
    nodeName: messNodes[0].name,
  };
};

/** Most popular affordable cafe/restaurant picks, priced from real history. */
const pickCrowdsourcedSpots = async (ceiling, limit = 2) => {
  const spots = await CampusMerchant.find({ category: { $in: ['cafe', 'restaurant'] } })
    .sort({ confirmations: -1, txnCount: -1 })
    .limit(12);

  const picks = [];
  for (const spot of spots) {
    const agg = await Transaction.aggregate([
      { $match: { merchantId: spot.merchantId, type: 'debit' } },
      { $group: { _id: null, avg: { $avg: '$amount' } } },
    ]);
    const avgCost = agg[0]?.avg ? Math.round(agg[0].avg) : null;
    if (avgCost && avgCost <= ceiling) {
      picks.push({
        name: spot.displayName || 'Popular campus spot',
        category: spot.category,
        averageCost: avgCost,
        popularity: spot.txnCount,
        crowdsourced: true,
      });
    }
    if (picks.length >= limit) break;
  }

  if (picks.length === 0) {
    DEFAULT_NEARBY_OPTIONS.filter((o) => ['cafe', 'outside'].includes(o.category) && o.averageCost <= ceiling)
      .sort((a, b) => a.averageCost - b.averageCost)
      .slice(0, limit)
      .forEach((o) =>
        picks.push({ name: o.name, category: 'cafe', averageCost: o.averageCost, crowdsourced: false })
      );
  }
  return picks;
};

/** Cheapest tagged grocery/food merchant for budget-safe snacks. */
const pickBudgetMerchant = async () => {
  const spots = await CampusMerchant.find({ category: { $in: ['grocery', 'food'] } })
    .sort({ txnCount: -1 })
    .limit(10);
  for (const spot of spots) {
    const agg = await Transaction.aggregate([
      { $match: { merchantId: spot.merchantId, type: 'debit' } },
      { $group: { _id: null, avg: { $avg: '$amount' } } },
    ]);
    const avgCost = agg[0]?.avg ? Math.round(agg[0].avg) : null;
    if (avgCost) return { name: spot.displayName, category: spot.category, averageCost: avgCost };
  }
  return null;
};

/** Budget-aware protein tip for gym-goers. */
const buildGymFuel = (ceiling) => {
  const affordable = PROTEIN_OPTIONS.filter((o) => o.cost <= Math.max(ceiling, 45)).slice(0, 2);
  const picks = affordable.length ? affordable : PROTEIN_OPTIONS.slice(0, 1);
  return {
    title: 'Gym day fuel',
    message: `Hit your protein under budget: ${picks
      .map((p) => `${p.name} (~₹${p.cost}, ${p.protein})`)
      .join(' or ')}.`,
    options: picks,
  };
};

// GET /api/v1/pocket/recommendation
exports.getRecommendation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const analytics = await computeAnalytics(userId, user);
    const mess = await assessMessQuality(userId, user.primaryMessNodeId);
    const todaysDish = await getTodaysDish(mess.nodeId);
    mess.todaysDish = todaysDish;

    const remaining = analytics.remainingBudget;
    const treatCeiling = Math.max(analytics.maxAffordableMeal, 200);
    const budgetHealthy = !analytics.isCritical && remaining >= analytics.maxAffordableMeal;
    const dishLabel = todaysDish ? `Today's ${todaysDish.slot} (${todaysDish.dish})` : 'Mess food';

    let scenario = 'neutral';
    let title = 'Connect your Mess community';
    let message =
      'Set a primary Mess community in your Profile so PocketBuddy can warn you on bad-food days and suggest wallet-safe alternatives.';
    let suggestions = [];

    if (mess.quality === 'unknown' && mess.nodeCount > 0) {
      // Member but no recent votes yet.
      scenario = 'eat_in';
      title = 'No mess verdict yet today';
      message = `No votes on ${mess.nodeName} yet. Eat in to preserve your ₹${Math.max(remaining, 0).toFixed(0)} budget — vote after your meal to help the community.`;
    } else if (mess.quality === 'good') {
      // State A: food is good -> passive wellness card.
      scenario = 'eat_in';
      title = `${dishLabel} is rated well today`;
      message = `${dishLabel} is rated well (+${mess.netVotes} net votes). Eat in to preserve your ₹${Math.max(remaining, 0).toFixed(0)} budget runway.`;
    } else if (mess.quality === 'poor') {
      if (budgetHealthy) {
        // State B: food bad + healthy budget -> recommendation engine.
        suggestions = await pickCrowdsourcedSpots(treatCeiling, 2);
        scenario = 'treat';
        title = `${dishLabel} is flagged as poor today`;
        message = suggestions.length
          ? `${dishLabel} is flagged (${mess.netVotes} net votes). You have ₹${remaining.toFixed(0)} — based on campus spending we recommend ${suggestions
              .map((s) => `${s.name} (~₹${s.averageCost})`)
              .join(' or ')}.`
          : `${dishLabel} is flagged (${mess.netVotes} net votes). You have ₹${remaining.toFixed(0)} — a cafe run is well within budget today.`;
      } else {
        // State C: food bad + budget low -> budget-safe alternative.
        const budgetMerchant = await pickBudgetMerchant();
        scenario = 'conserve';
        title = `${dishLabel} is flagged, but budget is tight`;
        message = budgetMerchant
          ? `Only ₹${Math.max(remaining, 0).toFixed(0)} left for ${analytics.daysLeftInMonth} days. Skip eating out — grab a budget snack from ${budgetMerchant.name} (~₹${budgetMerchant.averageCost}) or check the Campus Freebies community.`
          : `Only ₹${Math.max(remaining, 0).toFixed(0)} left for ${analytics.daysLeftInMonth} days. Skip eating out — make Maggi in the dorm or check the Campus Freebies community.`;
      }
    }

    // Gym fuel tip if the user belongs to / picked a Gym community.
    let gymFuel = null;
    const gymNode = user.primaryGymNodeId
      ? await CommunityNode.findOne({ nodeId: user.primaryGymNodeId, members: userId })
      : await CommunityNode.findOne({ members: userId, nodeType: 'Gym' });
    if (gymNode) gymFuel = buildGymFuel(analytics.maxAffordableMeal);

    return res.status(200).json({
      success: true,
      data: {
        scenario,
        title,
        message,
        suggestions,
        budgetHealthy,
        remainingBudget: remaining,
        runwayDays: analytics.runwayDays,
        onTrack: analytics.onTrack,
        daysLeftInMonth: analytics.daysLeftInMonth,
        mess,
        gymFuel,
      },
    });
  } catch (error) {
    console.error('PocketBuddy Recommendation Error:', error);
    return res.status(500).json({ success: false, message: 'Server error building recommendation.' });
  }
};

/* ----------------------------------- meals ---------------------------------- */

// GET /api/v1/pocket/meals
exports.getMealPlan = async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const analytics = await computeAnalytics(req.user.userId, user);
    return res.status(200).json({
      success: true,
      data: {
        currency: analytics.currency,
        daysLeftInMonth: analytics.daysLeftInMonth,
        targetThreshold: analytics.dailyMealThreshold,
        maxAllowableCost: analytics.maxAffordableMeal,
        affordableOptions: analytics.affordableOptions,
      },
    });
  } catch (error) {
    console.error('PocketBuddy Meal Plan Error:', error);
    return res.status(500).json({ success: false, message: 'Server error generating meal plan.' });
  }
};

// Back-compat alias used by the old sandbox button.
exports.processTransaction = exports.ingestTransaction;
