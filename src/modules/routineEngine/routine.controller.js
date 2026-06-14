const { assembleDailyPlan } = require('./routine.service');

// GET /api/v1/routine/today
exports.getDailyPlan = async (req, res) => {
  try {
    const plan = await assembleDailyPlan(req.user.userId);
    return res.status(200).json({ success: true, data: plan });
  } catch (error) {
    console.error('Routine Engine Error:', error);
    return res.status(500).json({ success: false, message: 'Server error assembling daily plan.' });
  }
};
