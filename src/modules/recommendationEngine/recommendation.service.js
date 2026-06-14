const User = require('../../sharedModels/User.model');
const CommunityNode = require('../../sharedModels/CommunityNode.model');
const CommunityAlert = require('../../sharedModels/CommunityAlert.model');

const MEAL_ORDER_TOTAL = 300; // INR for a shared outside order
const RIDE_TOTAL = 120; // INR for a shared auto

/**
 * Scan the user's community graph for cross-functional synergies:
 *  - a meal split when the mess is flagged and a node-mate can share the cost
 *  - a carpool split when the user shares a Logistical node with someone
 * Everything is derived from real node membership + live wallet balances.
 */
const scanSynergies = async (userId) => {
  const me = await User.findOne({ userId });
  if (!me) return [];

  const myNodes = await CommunityNode.find({ members: userId });
  if (myNodes.length === 0) return [];

  // Collect co-members (exclude self) and the node each belongs to.
  const coMemberIds = new Set();
  for (const node of myNodes) {
    for (const m of node.members) if (m !== userId) coMemberIds.add(m);
  }
  if (coMemberIds.size === 0) return [];

  const coMembers = await User.find({ userId: { $in: [...coMemberIds] } }).select(
    'userId name financialConfig'
  );
  const byId = new Map(coMembers.map((u) => [u.userId, u]));

  const messFlagged = await CommunityAlert.exists({ status: 'active', nodeType: /mess/i });
  const synergies = [];

  // --- Meal split synergy ---
  const mealPerHead = MEAL_ORDER_TOTAL / 2;
  const myBalance = me.financialConfig.amazonPayBalance;
  // Trigger when the mess is flagged OR the user's budget is getting tight.
  const mealTrigger = messFlagged || myBalance < me.financialConfig.monthlyBudget * 0.4;
  if (mealTrigger && myBalance >= mealPerHead) {
    // Pick the affordable co-member with the lowest balance (help the tighter budget).
    const candidate = coMembers
      .filter((u) => u.financialConfig.amazonPayBalance >= mealPerHead)
      .sort((a, b) => a.financialConfig.amazonPayBalance - b.financialConfig.amazonPayBalance)[0];

    if (candidate) {
      synergies.push({
        id: `meal-${candidate.userId}`,
        type: 'meal',
        title: 'Community Meal Split',
        detail: messFlagged
          ? `Mess flagged today. You and ${candidate.name} both have budget — split a ₹${MEAL_ORDER_TOTAL} order (₹${mealPerHead} each).`
          : `Budget running tight. Split a ₹${MEAL_ORDER_TOTAL} order with ${candidate.name} (₹${mealPerHead} each) to save.`,
        partner: { userId: candidate.userId, name: candidate.name },
        amount: MEAL_ORDER_TOTAL,
        perHead: mealPerHead,
        action: 'split_meal',
      });
    }
  }

  // --- Carpool synergy (Logistical node) ---
  const logisticalNode = myNodes.find((n) => n.nodeType === 'Logistical');
  if (logisticalNode) {
    const mate = logisticalNode.members.find((m) => m !== userId && byId.has(m));
    if (mate) {
      const ridePerHead = RIDE_TOTAL / 2;
      synergies.push({
        id: `carpool-${mate}`,
        type: 'carpool',
        title: 'Carpool Split',
        detail: `You and ${byId.get(mate).name} are both in ${logisticalNode.name}. Split an auto (₹${RIDE_TOTAL} → ₹${ridePerHead} each).`,
        partner: { userId: mate, name: byId.get(mate).name },
        amount: RIDE_TOTAL,
        perHead: ridePerHead,
        action: 'split_ride',
      });
    }
  }

  return synergies;
};

module.exports = { scanSynergies };
