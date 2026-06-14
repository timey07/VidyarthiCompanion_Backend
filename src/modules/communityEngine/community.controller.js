const CommunityAlert = require('../../sharedModels/CommunityAlert.model');

exports.submitVote = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { eventId, voteType } = req.body;

    if (!eventId || !voteType) {
      return res.status(400).json({ success: false, message: 'Missing eventId or voteType' });
    }

    // 1. Find the alert (or create a mock one if it doesn't exist yet for testing)
    let alert = await CommunityAlert.findOne({ alertId: eventId });
    if (!alert) {
      alert = await CommunityAlert.create({
        alertId: eventId,
        message: 'Main Mess is currently overcrowded. Recommendation: Outside Dining.',
        nodeType: 'Wellness Community'
      });
    }

    // 2. Apply the vote
    if (voteType === 1) {
      alert.upvotes += 1;
    } else if (voteType === -1) {
      alert.downvotes += 1;
    }

    await alert.save();

    console.log(`User ${userId} voted ${voteType === 1 ? 'UP' : 'DOWN'} on alert ${eventId}. New counts: +${alert.upvotes} / -${alert.downvotes}`);

    // 3. Respond to User 1
    res.status(200).json({
      success: true,
      message: 'Vote recorded successfully',
      data: {
        upvotes: alert.upvotes,
        downvotes: alert.downvotes
      }
    });

  } catch (error) {
    console.error('Community Vote Error:', error);
    res.status(500).json({ success: false, message: 'Server error processing vote' });
  }
};