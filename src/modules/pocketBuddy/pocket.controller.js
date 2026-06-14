const User = require('../../sharedModels/User.model');
const Transaction = require('../../sharedModels/Transaction.model');
const { calculateAffordableMeals, daysRemainingInMonth } = require('./meal.service');

// INR thresholds for spend alerts.
const HIGH_SPEND_ABS = 500; // a single debit over this is "high spend"
const CRITICAL_BALANCE_RATIO = 0.1; // balance under 10% of monthly budget is critical

/**
 * Build a wallet snapshot + (optional) hyper-local meal recommendation.
 * Shared by the summary endpoint and the post-transaction response.
 */
const buildWalletSummary = (user, recentTransactions = []) => {
  const { amazonPayBalance, monthlyBudget, currency } = user.financialConfig;
  const daysLeft = daysRemainingInMonth();
  const meal = calculateAffordableMeals(amazonPayBalance, daysLeft);
  const criticalBalance = monthlyBudget * CRITICAL_BALANCE_RATIO;

  return {
    balance: Number(amazonPayBalance.toFixed(2)),
    monthlyBudget,
    currency,
    daysLeftInMonth: daysLeft,
    dailyMealThreshold: meal.targetThreshold,
    maxAffordableMeal: meal.maxAllowableCost,
    affordableOptions: meal.affordableOptions,
    isCritical: amazonPayBalance < criticalBalance,
    recentTransactions,
  };
};

// GET /api/v1/pocket/summary
exports.getWalletSummary = async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const recent = await Transaction.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(10);

    return res.status(200).json({ success: true, data: buildWalletSummary(user, recent) });
  } catch (error) {
    console.error('PocketBuddy Summary Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching wallet.' });
  }
};

// POST /api/v1/pocket/webhook  (Amazon Pay sandbox)
exports.processTransaction = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { vendor, amount, transactionType, category, note } = req.body;

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'A positive amount is required.' });
    }

    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const type = transactionType === 'credit' ? 'credit' : 'debit';
    const delta = type === 'credit' ? amt : -amt;

    // Apply to the live wallet balance.
    user.financialConfig.amazonPayBalance = Number(
      (user.financialConfig.amazonPayBalance + delta).toFixed(2)
    );
    await user.save();

    const txn = await Transaction.create({
      userId,
      vendor: vendor || 'Amazon Pay',
      amount: amt,
      type,
      category: category || 'general',
      balanceAfter: user.financialConfig.amazonPayBalance,
      note,
    });

    // Build a fresh summary so the client gets the authoritative balance + meal advice.
    const recent = await Transaction.find({ userId }).sort({ createdAt: -1 }).limit(10);
    const summary = buildWalletSummary(user, recent);

    // Decide on an alert.
    let alert = null;
    if (type === 'debit' && amt > HIGH_SPEND_ABS) {
      alert = `High spend detected: ₹${amt.toFixed(0)} at ${txn.vendor}.`;
    } else if (summary.isCritical) {
      alert = `Budget critical: ₹${summary.balance.toFixed(0)} left for ${summary.daysLeftInMonth} days. Recommending mess food over outside dining.`;
    }

    return res.status(200).json({
      success: true,
      message: 'Transaction recorded successfully',
      data: {
        newBalance: summary.balance,
        alert,
        transaction: txn,
        summary,
      },
    });
  } catch (error) {
    console.error('PocketBuddy Error:', error);
    return res.status(500).json({ success: false, message: 'Server Error processing transaction' });
  }
};

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
