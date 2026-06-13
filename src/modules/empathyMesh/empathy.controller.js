const LifestyleLog = require('../../sharedModels/LifestyleLog.model');
const safeSkipService = require('./safeSkip.service');

// 1. Let students log their lifestyle data
exports.logLifestyleMetric = async (req, res) => {
  try {
    const { userId, logType, severity, notes } = req.body;

    if (!userId || !logType || !severity) {
      return res.status(400).json({ success: false, message: 'Missing required logging fields.' });
    }

    const log = await LifestyleLog.create({ userId, logType, severity, notes });

    res.status(201).json({
      success: true,
      message: 'Lifestyle metric recorded in Empathy Mesh.',
      data: log
    });
  } catch (error) {
    console.error('Logging Error:', error);
    res.status(500).json({ success: false, message: 'Server Error recording metric.' });
  }
};

// 2. Evaluate if a student qualifies for a Safe-Skip right now
exports.evaluateSafeSkip = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId parameter.' });
    }

    const evaluation = await safeSkipService.calculateBurnoutScore(userId);

    res.status(200).json({
      success: true,
      data: evaluation
    });
  } catch (error) {
    console.error('Evaluation Error:', error);
    res.status(500).json({ success: false, message: 'Server Error evaluating Safe-Skip.' });
  }
};