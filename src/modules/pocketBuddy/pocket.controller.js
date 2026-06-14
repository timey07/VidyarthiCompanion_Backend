const User = require('../../sharedModels/User.model');
const Transaction = require('../../sharedModels/Transaction.model');
const CampusMerchant = require('../../sharedModels/CampusMerchant.model');
const CommunityNode = require('../../sharedModels/CommunityNode.model');
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const { calculateAffordableMeals, daysRemainingInMonth, DEFAULT_NEARBY_OPTIONS } = require('./meal.service');
const {
  normalizeMerchantId,
  prettyName,
  inferCategory,
  parseNotification,
} = require('./merchant.service');

const CRITICAL_BALANCE_RATIO = 0.1; // balance under 10% of monthly budget is critical
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

/* --------------------------------- analytics -------------------------------- */

const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Compute the spend analytics that power the runway viz + category breakdown.
 */
const computeAnalytics = async (userId, user) => {
  const balance = user.financialConfig.amazonPayBalance;
  const monthlyBudget = user.financialConfig.monthlyBudget;
  const daysLeft = daysRemainingInMonth();
  const meal = calculateAffordableMeals(balance, daysLeft);

  const monthDebits = await Transaction.find({
    userId,
    type: 'debit',
    createdAt: { $gte: startOfMonth() },
  }).select('amount category');

  const spentThisMonth = monthDebits.reduce((s, t) => s + t.amount, 0);

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
  const runwayDays = avgDailySpend > 0 ? Math.floor(balance / avgDailySpend) : null;

  const untaggedCount = await Transaction.countDocuments({ userId, category: 'unknown' });

  return {
    balance: Number(balance.toFixed(2)),
    monthlyBudget,
    currency: user.financialConfig.currency,
    daysLeftInMonth: daysLeft,
    spentThisMonth: Number(spentThisMonth.toFixed(2)),
    remainingBudget: Number(Math.max(monthlyBudget - spentThisMonth, 0).toFixed(2)),
    avgDailySpend,
    runwayDays,
    dailyMealThreshold: meal.targetThreshold,
    maxAffordableMeal: meal.maxAllowableCost,
    affordableOptions: meal.affordableOptions,
    isCritical: balance < monthlyBudget * CRITICAL_BALANCE_RATIO,
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
 * using (in order): explicit tag > crowdsourced graph > note/text inference.
 * Mutates the graph so the campus collaboratively maps new vendors.
 *
 * @returns {Promise<{category, merchant, resolvedBy}>}
 */
const resolveAndLearnMerchant = async ({ merchantId, merchantRaw, note, explicitCategory }) => {
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

  let category = 'unknown';
  let resolvedBy = 'none';

  const explicit =
    explicitCategory && VALID_CATEGORIES.includes(explicitCategory) ? explicitCategory : null;

  if (explicit) {
    category = explicit;
    resolvedBy = 'explicit';
  } else if (merchant.category && merchant.category !== 'unknown') {
    // Crowdsourced auto-resolution: someone already mapped this vendor.
    category = merchant.category;
    resolvedBy = 'graph';
  } else {
    const inferred = inferCategory(merchantRaw, note, merchant.displayName);
    if (inferred) {
      category = inferred;
      resolvedBy = 'inferred';
    }
  }

  // Grow the graph: if it was unknown and we just learned a category from this
  // payment (explicit/note), persist it so other students auto-resolve later.
  if (merchant.category === 'unknown' && category !== 'unknown') {
    merchant.category = category;
    merchant.categorySource = 'auto';
  }

  await merchant.save();
  return { category, merchant, resolvedBy };
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
// Accepts EITHER a raw notification string { raw } OR structured fields
// { merchant|vendor, amount, transactionType, category, note, source }.
exports.ingestTransaction = async (req, res) => {
  try {
    const userId = req.user.userId;
    const body = req.body || {};

    // 1. Parse raw notification text when provided; merge with structured fields.
    let parsed = {};
    if (body.raw) parsed = parseNotification(body.raw) || {};

    const amount = Number(body.amount ?? parsed.amount);
    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'Could not read a valid amount from the payment.' });
    }

    const merchantRaw = body.merchant || body.vendor || parsed.merchantRaw || 'Unknown merchant';
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
    let category = 'unknown';
    let merchantName = prettyName(merchantRaw);
    if (type === 'debit') {
      const resolved = await resolveAndLearnMerchant({
        merchantId,
        merchantRaw,
        note,
        explicitCategory: body.category,
      });
      category = resolved.category;
      merchantName = resolved.merchant.displayName || merchantName;
    } else {
      category = 'general';
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
      alert = `Budget critical: ₹${analytics.balance.toFixed(0)} left for ${analytics.daysLeftInMonth} days.`;
    }

    return res.status(201).json({
      success: true,
      message: 'Transaction recorded.',
      data: {
        transaction: txnDTO(txn),
        needsTag: txn.category === 'unknown',
        newBalance: analytics.balance,
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
// Tags a transaction's merchant. This updates the GLOBAL merchant graph and
// silently auto-categorizes every other student's untagged hit on that vendor.
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

    // Authoritatively update the campus merchant graph.
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

    // Update this transaction.
    txn.category = category;
    txn.merchantId = merchantId;
    if (displayName) txn.vendor = displayName.trim();
    else if (merchant.displayName) txn.vendor = merchant.displayName;
    await txn.save();

    // Crowdsource backfill: auto-resolve every still-unknown hit on this vendor,
    // for THIS user and everyone else on campus.
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

/**
 * Read the user's Mess "Accountability" communities and judge food quality from
 * the consensus on recent updates (rejected = downvoted = poor).
 */
const assessMessQuality = async (userId) => {
  const messNodes = await CommunityNode.find({ members: userId, nodeType: 'Mess' }).select(
    'nodeId name'
  );
  if (messNodes.length === 0) {
    return { quality: 'unknown', verified: 0, rejected: 0, nodeCount: 0, sample: null };
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
    return { quality: 'unknown', verified: 0, rejected: 0, nodeCount: messNodes.length, sample: null };
  }

  const rejected = events.filter((e) => e.status === 'rejected').length;
  const verified = events.filter((e) => e.status === 'verified').length;
  const worst = events[0]; // lowest consensusScore
  const quality = rejected > verified && rejected > 0 ? 'poor' : 'ok';

  return {
    quality,
    verified,
    rejected,
    nodeCount: messNodes.length,
    sample: worst ? { name: worst.eventName, consensusScore: worst.consensusScore } : null,
  };
};

/**
 * Pick the most popular affordable cafe/restaurant from the crowdsourced graph,
 * pricing it from real transaction history. Falls back to the static list.
 */
const pickCrowdsourcedSpot = async (ceiling) => {
  const spots = await CampusMerchant.find({ category: { $in: ['cafe', 'restaurant'] } })
    .sort({ confirmations: -1, txnCount: -1 })
    .limit(10);

  for (const spot of spots) {
    const agg = await Transaction.aggregate([
      { $match: { merchantId: spot.merchantId, type: 'debit' } },
      { $group: { _id: null, avg: { $avg: '$amount' }, count: { $sum: 1 } } },
    ]);
    const avgCost = agg[0]?.avg ? Math.round(agg[0].avg) : null;
    if (avgCost && avgCost <= ceiling) {
      return {
        name: spot.displayName || 'Popular campus spot',
        category: spot.category,
        averageCost: avgCost,
        popularity: spot.txnCount,
        crowdsourced: true,
      };
    }
  }

  // Fallback: static nearby options (cafe/restaurant) within the ceiling.
  const fallback = DEFAULT_NEARBY_OPTIONS.filter(
    (o) => ['cafe', 'outside'].includes(o.category) && o.averageCost <= ceiling
  ).sort((a, b) => a.averageCost - b.averageCost)[0];
  return fallback
    ? { name: fallback.name, category: 'cafe', averageCost: fallback.averageCost, crowdsourced: false }
    : null;
};

// GET /api/v1/pocket/recommendation
exports.getRecommendation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const analytics = await computeAnalytics(userId, user);
    const mess = await assessMessQuality(userId);

    const balance = analytics.balance;
    const treatCeiling = Math.min(balance, Math.max(analytics.maxAffordableMeal, 200));
    const budgetHealthy = !analytics.isCritical && balance >= analytics.maxAffordableMeal;

    let scenario = 'neutral';
    let title = 'Mess looks fine today';
    let message = 'No strong downvotes on your Mess community right now — the mess is a safe bet.';
    let suggestion = null;

    if (mess.quality === 'unknown') {
      scenario = 'neutral';
      title = 'Connect your Mess community';
      message =
        'Join your hostel/mess community so PocketBuddy can warn you on bad-food days and suggest wallet-safe alternatives.';
    } else if (mess.quality === 'poor') {
      if (budgetHealthy) {
        suggestion = await pickCrowdsourcedSpot(treatCeiling);
        scenario = 'treat';
        title = 'Mess food is rated poorly today';
        message = suggestion
          ? `You have ₹${balance.toFixed(0)} in your wallet. Treat yourself to ${suggestion.name} (~₹${suggestion.averageCost}) — a campus favourite.`
          : `You have ₹${balance.toFixed(0)} to spare. A cafe run is well within budget today.`;
      } else {
        scenario = 'conserve';
        title = 'Mess isn’t great, but budget is tight';
        message = `Only ₹${balance.toFixed(0)} left for ${analytics.daysLeftInMonth} days. Skip eating out — make Maggi in the dorm, or catch free snacks at a club meetup.`;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        scenario,
        title,
        message,
        suggestion,
        budgetHealthy,
        balance,
        remainingBudget: analytics.remainingBudget,
        runwayDays: analytics.runwayDays,
        daysLeftInMonth: analytics.daysLeftInMonth,
        mess,
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

    const { amazonPayBalance, currency } = user.financialConfig;
    const daysLeft = daysRemainingInMonth();
    const meal = calculateAffordableMeals(amazonPayBalance, daysLeft);

    return res.status(200).json({
      success: true,
      data: { currency, daysLeftInMonth: daysLeft, ...meal },
    });
  } catch (error) {
    console.error('PocketBuddy Meal Plan Error:', error);
    return res.status(500).json({ success: false, message: 'Server error generating meal plan.' });
  }
};

// Back-compat alias used by the old sandbox button.
exports.processTransaction = exports.ingestTransaction;
