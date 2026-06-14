const { scanSynergies } = require('./recommendation.service');

// GET /api/v1/recommendations/synergies
exports.getSynergies = async (req, res) => {
  try {
    const synergies = await scanSynergies(req.user.userId);
    return res.status(200).json({ success: true, data: synergies });
  } catch (error) {
    console.error('Recommendation Engine Error:', error);
    return res.status(500).json({ success: false, message: 'Server error scanning synergies.' });
  }
};
