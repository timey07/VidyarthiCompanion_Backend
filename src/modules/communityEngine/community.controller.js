const CommunityAlert = require('../../sharedModels/CommunityAlert.model');
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const CommunityNode = require('../../sharedModels/CommunityNode.model');
const ConsensusVote = require('../../sharedModels/ConsensusVote.model');
const consensusService = require('./consensus.service');
const { getUserNodeIds } = require('./node.controller');

// GET /api/v1/community/events
// Node-scoped schedule feed: events shared with the user's community nodes,
// plus the user's own personal events. Optionally filter by status or nodeId.
exports.listScheduleEvents = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, nodeId } = req.query;

    const myNodeIds = await getUserNodeIds(userId);

    // Visibility: events in one of my nodes OR my own personal events.
    const filter = { $or: [{ nodeId: { $in: myNodeIds } }, { userId } ] };
    if (status && ['pending', 'verified', 'rejected'].includes(status)) {
      filter.status = status;
    }
    if (nodeId) {
      // Narrow to a single node the user belongs to.
      filter.$or = [{ nodeId }];
    }

    const events = await AcademicEvent.find(filter).sort({ date: 1 }).limit(100);

    // Annotate with the current user's existing vote.
    const myVotes = await ConsensusVote.find({
      userId,
      eventId: { $in: events.map((e) => e._id) },
    });
    const voteMap = new Map(myVotes.map((v) => [v.eventId.toString(), v.voteType]));

    // Resolve node names for display.
    const nodeIds = [...new Set(events.map((e) => e.nodeId).filter(Boolean))];
    const nodes = await CommunityNode.find({ nodeId: { $in: nodeIds } }).select('nodeId name');
    const nodeNameMap = new Map(nodes.map((n) => [n.nodeId, n.name]));

    const data = events.map((e) => ({
      id: e._id,
      eventName: e.eventName,
      date: e.date,
      location: e.location,
      confidenceScore: e.confidenceScore,
      consensusScore: e.consensusScore,
      status: e.status,
      nodeId: e.nodeId,
      nodeName: e.nodeId ? nodeNameMap.get(e.nodeId) || null : null,
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



// GET /api/v1/community/alerts
// Active community alerts (mess overcrowding, etc.) with live vote tallies.
exports.listAlerts = async (req, res) => {
  try {
    const alerts = await CommunityAlert.find({ status: 'active' }).sort({ updatedAt: -1 }).limit(20);
    const data = alerts.map((a) => ({
      id: a.alertId,
      message: a.message,
      nodeType: a.nodeType,
      upvotes: a.upvotes,
      downvotes: a.downvotes,
      consensus: a.upvotes - a.downvotes,
    }));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('List Alerts Error:', error);
    return res.status(500).json({ success: false, message: 'Server error listing alerts.' });
  }
};
