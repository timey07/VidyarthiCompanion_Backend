/**
 * Calculates the max affordable meal price and filters nearby options.
 * @param {number} remainingBudget - Total budget left for the month
 * @param {number} daysRemaining - Days left in the current month
 * @param {Array} nearbyOptions - Array of food option objects
 * @returns {Object} Target threshold and filtered list
 */
export const calculateAffordableMeals = (remainingBudget, daysRemaining, nearbyOptions) => {
  // Assume a student buys 2 meals a day on campus
  const EXPECTED_MEALS_PER_DAY = 2;
  const FLEX_VARIANCE = 1.15; 

  if (daysRemaining <= 0 || remainingBudget <= 0) {
    return { targetThreshold: 0, affordableOptions: [] };
  }

  // Calculate the baseline Target Meal Threshold (T_meal)
  const targetThreshold = remainingBudget / (daysRemaining * EXPECTED_MEALS_PER_DAY);
  
  // Apply a 15% flex variance for the maximum allowable cost
  const maxAllowableCost = targetThreshold * FLEX_VARIANCE;

  // Filter out any options that exceed the max allowable cost
  const affordableOptions = nearbyOptions.filter(option => option.averageCost <= maxAllowableCost);

  // Sort from cheapest to most expensive
  affordableOptions.sort((a, b) => a.averageCost - b.averageCost);

  return {
    targetThreshold: Number(targetThreshold.toFixed(2)),
    maxAllowableCost: Number(maxAllowableCost.toFixed(2)),
    affordableOptions
  };
};