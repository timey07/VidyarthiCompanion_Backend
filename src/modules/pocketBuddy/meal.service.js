/**
 * Hyper-local meal optimisation math (India-centric, INR).
 *
 * Note: converted to CommonJS to match the rest of the backend (the file
 * previously used ESM `export`, which would crash when required).
 */

// A small static list of nearby campus food options (INR).
// In production this would be crowd-sourced via the Mess Ticker / community graph.
const DEFAULT_NEARBY_OPTIONS = [
  { name: 'Mess Thali', averageCost: 60, category: 'mess' },
  { name: 'Campus Canteen Combo', averageCost: 90, category: 'canteen' },
  { name: 'Local Dhaba', averageCost: 120, category: 'outside' },
  { name: 'Cafe Sandwich + Chai', averageCost: 160, category: 'cafe' },
  { name: 'Restaurant Meal', averageCost: 250, category: 'outside' },
  { name: 'Food Delivery (avg)', averageCost: 320, category: 'delivery' },
];

/**
 * Calculates the max affordable meal price and filters nearby options.
 * @param {number} remainingBudget - Budget left for the rest of the month (INR)
 * @param {number} daysRemaining - Days left in the current month
 * @param {Array} [nearbyOptions] - Food options; defaults to a static India list
 * @returns {Object} Target threshold, max allowable cost, and filtered list
 */
const calculateAffordableMeals = (remainingBudget, daysRemaining, nearbyOptions = DEFAULT_NEARBY_OPTIONS) => {
  // Assume a student buys 2 meals a day on campus
  const EXPECTED_MEALS_PER_DAY = 2;
  const FLEX_VARIANCE = 1.15;

  if (daysRemaining <= 0 || remainingBudget <= 0) {
    return { targetThreshold: 0, maxAllowableCost: 0, affordableOptions: [] };
  }

  // Baseline Target Meal Threshold (T_meal)
  const targetThreshold = remainingBudget / (daysRemaining * EXPECTED_MEALS_PER_DAY);

  // Apply a 15% flex variance for the maximum allowable cost
  const maxAllowableCost = targetThreshold * FLEX_VARIANCE;

  // Filter out any options that exceed the max allowable cost, cheapest first
  const affordableOptions = nearbyOptions
    .filter((option) => option.averageCost <= maxAllowableCost)
    .sort((a, b) => a.averageCost - b.averageCost);

  return {
    targetThreshold: Number(targetThreshold.toFixed(2)),
    maxAllowableCost: Number(maxAllowableCost.toFixed(2)),
    affordableOptions,
  };
};

/** Days remaining in the current calendar month, including today. */
const daysRemainingInMonth = (now = new Date()) => {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
};

/** Total days in the current calendar month. */
const daysInMonth = (now = new Date()) => new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

/* -------------------------- budget-tiered meal plans ------------------------- */

/**
 * Mock "past routine orders" (India, INR). In production this would be mined
 * from the user's real PocketBuddy transaction history. Each order notes which
 * meal slots it suits. We classify these into low / mid / high PRICE CONTAINERS
 * so the engine can suggest the right meal for the budget left.
 */
const PAST_ROUTINE_ORDERS = [
  { name: 'Poha + chai', price: 30, slots: ['breakfast'] },
  { name: 'Idli + sambar', price: 35, slots: ['breakfast'] },
  { name: 'Maggi', price: 30, slots: ['breakfast', 'snacks', 'dinner'] },
  { name: 'Bread omelette', price: 45, slots: ['breakfast'] },
  { name: 'Fruit bowl', price: 50, slots: ['breakfast', 'snacks'] },
  { name: 'Aloo paratha + curd', price: 60, slots: ['breakfast'] },
  { name: 'Rajma chawal', price: 65, slots: ['lunch', 'dinner'] },
  { name: 'Veg thali', price: 70, slots: ['lunch', 'dinner'] },
  { name: 'Masala dosa', price: 80, slots: ['breakfast', 'lunch'] },
  { name: 'Veg biryani', price: 110, slots: ['lunch', 'dinner'] },
  { name: 'Chicken curry + rice', price: 130, slots: ['lunch', 'dinner'] },
  { name: 'Cold coffee + sandwich', price: 140, slots: ['breakfast', 'snacks'] },
  { name: 'Paneer butter masala + roti', price: 150, slots: ['lunch', 'dinner'] },
  { name: 'Cafe pasta', price: 160, slots: ['lunch', 'dinner'] },
  { name: 'Chicken biryani', price: 180, slots: ['lunch', 'dinner'] },
  { name: 'Personal pizza', price: 220, slots: ['lunch', 'dinner'] },
  { name: 'Restaurant combo meal', price: 280, slots: ['lunch', 'dinner'] },
];

// Price containers (INR) the past orders are bucketed into.
const TIER_BANDS = {
  low: {
    key: 'low',
    min: 0,
    max: 70,
    label: 'Money low',
    headline: 'Eat in the mess — here is a low-budget plan to stay on track.',
  },
  mid: {
    key: 'mid',
    min: 70,
    max: 150,
    label: 'Money at the limit',
    headline: 'You are right around your daily average — a balanced mid-budget plan.',
  },
  high: {
    key: 'high',
    min: 150,
    max: Infinity,
    label: 'Money enough',
    headline: 'You have room today — treat yourself with a higher-budget plan.',
  },
};

/** Group the mock past orders into low / mid / high price containers. */
const classifyMealContainers = (orders = PAST_ROUTINE_ORDERS) => {
  const containers = { low: [], mid: [], high: [] };
  for (const o of orders) {
    if (o.price <= TIER_BANDS.low.max) containers.low.push(o);
    else if (o.price <= TIER_BANDS.mid.max) containers.mid.push(o);
    else containers.high.push(o);
  }
  return containers;
};

/**
 * Compare the user's set daily average (monthly limit / days in month) with the
 * current average (money left / days left) to choose a budget tier.
 *  - current well below set    -> 'low'  (money low)
 *  - current within ±15% of set -> 'mid'  (at the limit)
 *  - current above set          -> 'high' (money enough)
 */
const computeBudgetTier = ({ monthlyBudget, remaining, daysLeft, now = new Date() }) => {
  const totalDays = daysInMonth(now);
  const setDailyAverage = totalDays > 0 ? monthlyBudget / totalDays : 0;
  const currentAverage = daysLeft > 0 ? Math.max(remaining, 0) / daysLeft : 0;
  const ratio = setDailyAverage > 0 ? currentAverage / setDailyAverage : 1;

  let tier = 'mid';
  if (ratio < 0.85) tier = 'low';
  else if (ratio > 1.15) tier = 'high';

  return {
    setDailyAverage: Number(setDailyAverage.toFixed(2)),
    currentAverage: Number(currentAverage.toFixed(2)),
    ratio: Number(ratio.toFixed(2)),
    tier,
  };
};

/**
 * Build a one-day meal plan (breakfast / lunch / dinner) drawn from the price
 * container that matches the tier. For 'low' we pick the cheapest fit; for
 * 'mid'/'high' we pick the best meal you can afford in that band.
 */
const buildTierMealPlan = (tier) => {
  const band = TIER_BANDS[tier] || TIER_BANDS.mid;

  const pickForSlot = (slot) => {
    const inBand = PAST_ROUTINE_ORDERS.filter(
      (o) => o.slots.includes(slot) && o.price > band.min && o.price <= band.max
    );
    const pool = (inBand.length ? inBand : PAST_ROUTINE_ORDERS.filter((o) => o.slots.includes(slot)))
      .slice()
      .sort((a, b) => a.price - b.price);
    if (!pool.length) return null;
    return tier === 'low' ? pool[0] : pool[pool.length - 1];
  };

  const meals = {
    breakfast: pickForSlot('breakfast'),
    lunch: pickForSlot('lunch'),
    dinner: pickForSlot('dinner'),
  };
  const dayTotal = Object.values(meals).reduce((s, m) => s + (m ? m.price : 0), 0);

  return {
    tier: band.key,
    tierLabel: band.label,
    headline: band.headline,
    priceBand: { min: band.min, max: band.max === Infinity ? null : band.max },
    meals,
    dayTotal,
  };
};

module.exports = {
  calculateAffordableMeals,
  daysRemainingInMonth,
  daysInMonth,
  DEFAULT_NEARBY_OPTIONS,
  PAST_ROUTINE_ORDERS,
  TIER_BANDS,
  classifyMealContainers,
  computeBudgetTier,
  buildTierMealPlan,
};
