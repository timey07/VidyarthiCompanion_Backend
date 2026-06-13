const LifestyleLog = require('../../sharedModels/LifestyleLog.model');

exports.calculateBurnoutScore = async (userId) => {
  // 1. Fetch the user's lifestyle logs from the last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentLogs = await LifestyleLog.find({
    userId,
    createdAt: { $gte: oneDayAgo }
  });

  if (recentLogs.length === 0) {
    return { burnoutScore: 0, recommendSkip: false, reason: "No lifestyle data recorded for today." };
  }

  // 2. Run the Safe-Skip Calculus
  let totalSeverity = 0;
  let weights = {
    stress_level: 1.5,      // High stress heavily impacts burnout
    sleep: 2.0,             // Sleep deprivation is critical
    meal_skipped: 1.0,
    social_isolation: 1.2
  };

  recentLogs.forEach(log => {
    const weight = weights[log.logType] || 1.0;
    totalSeverity += log.severity * weight;
  });

  // Calculate an average score out of 10
  const baseScore = totalSeverity / recentLogs.length;
  const finalBurnoutScore = Math.min(Math.round(baseScore * 10) / 10, 10); // Cap at 10

  // 3. Threshold check: If score is 7 or higher, approve the Safe-Skip
  const threshold = 7.0;
  const recommendSkip = finalBurnoutScore >= threshold;

  let reason = "Student wellness levels are within normal parameters. Stay regular!";
  if (recommendSkip) {
    reason = `Critical Burnout Alert (${finalBurnoutScore}/10). Sleep deprivation or extreme stress detected. Safe-Skip recommended to preserve mental health.`;
  }

  return {
    burnoutScore: finalBurnoutScore,
    recommendSkip,
    reason
  };
};