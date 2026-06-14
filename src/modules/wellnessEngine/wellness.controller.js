const wellnessService = require('./wellness.service');

/**
 * GET /api/v1/wellness/summary
 * Returns the fully-automated tiredness, isolation and overall burnout scores
 * plus the supporting display series. userId comes from the JWT.
 */
exports.getSummary = async (req, res) => {
  try {
    const userId = req.user.userId;
    const summary = await wellnessService.getWellnessSummary(userId);
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    console.error('Wellness summary error:', error);
    res.status(500).json({ success: false, message: 'Server error computing wellness score.' });
  }
};

/**
 * POST /api/v1/wellness/sleep   body: { bucket: '4-6 hrs' | '6-8 hrs' | ... }
 * Records the student's nightly sleep-cycle selection (the one manual signal).
 */
exports.logSleep = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { bucket } = req.body;

    if (!bucket) {
      return res.status(400).json({ success: false, message: 'Missing sleep bucket.' });
    }

    const log = await wellnessService.logSleepCycle(userId, bucket);
    res.status(201).json({ success: true, message: 'Sleep cycle recorded.', data: log });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      message: status === 400 ? error.message : 'Server error recording sleep cycle.',
    });
  }
};
