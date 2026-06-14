const CommunityAlert = require('../../sharedModels/CommunityAlert.model');
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const consensusService = require('./consensus.service');

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



// GET /api/v1/community/events
// Campus-wide schedule feed with consensus state (node scoping arrives in Phase 2).
exports.listScheduleEvents = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && ['pending', 'verified', 'rejected'].includes(status)) {
      filter.status = status;
    }

    const events = await AcademicEvent.find(filter).sort({ date: 1 }).limit(50);

    // Annotate each event with whether the current user has already voted.
    const ConsensusVote = require('../../sharedModels/ConsensusVote.model');
    const myVotes = await ConsensusVote.find({
      userId: req.user.userId,
      eventId: { $in: events.map((e) => e._id) },
    });
    const voteMap = new Map(myVotes.map((v) => [v.eventId.toString(), v.voteType]));

    const data = events.map((e) => ({
      id: e._id,
      eventName: e.eventName,
      date: e.date,
      location: e.location,
      confidenceScore: e.confidenceScore,
      consensusScore: e.consensusScore,
      status: e.status,
      myVote: voteMap.get(e._id.toString()) || 0,
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('List Events Error:', error);
    return res.status(500).json({ success: false, message: 'Server error listing events.' });
  }
};

// POST /api/v1/community/events/vote
// Trust-weighted consensus vote on an academic event (Echo +1 / Flag -1).
exports.submitEventVote = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { eventId, voteType } = req.body;

    if (!eventId || ![1, -1].includes(voteType)) {
      return res
        .status(400)
        .json({ success: false, message: 'eventId and voteType (1 or -1) are required.' });
    }

    const result = await consensusService.applyVote({ eventId, userId, voteType });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const { event, tallies } = result;
    return res.status(200).json({
      success: true,
      message: 'Vote recorded.',
      data: {
        eventId: event._id,
        consensusScore: event.consensusScore,
        status: event.status,
        ...tallies,
      },
    });
  } catch (error) {
    console.error('Event Vote Error:', error);
    return res.status(500).json({ success: false, message: 'Server error processing event vote.' });
  }
};
