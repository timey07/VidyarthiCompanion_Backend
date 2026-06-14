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

module.exports = {
  calculateAffordableMeals,
  daysRemainingInMonth,
  DEFAULT_NEARBY_OPTIONS,
};
