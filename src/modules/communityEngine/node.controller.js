const CommunityNode = require('../../sharedModels/CommunityNode.model');
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const ConsensusVote = require('../../sharedModels/ConsensusVote.model');
const User = require('../../sharedModels/User.model');
const consensusService = require('./consensus.service');
const alertScheduler = require('../../core/alertScheduler');

/** Build a stable, unique-ish nodeId slug from a name. */
const buildNodeId = (name) => {
  const base =
    String(name || 'node')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'node';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
};

/** Short, human-shareable invite code for private nodes (e.g. "FLOW-7K2Q9"). */
const buildInviteCode = () =>
  `FLOW-${Math.random().toString(36).toUpperCase().slice(2, 7)}`;

/** Keep the convenience array on the user in sync with node membership. */
const syncUserNodes = async (userId) => {
  const nodeIds = await CommunityNode.find({ members: userId }).distinct('nodeId');
  await User.updateOne({ userId }, { $set: { communityNodeIds: nodeIds } });
  return nodeIds;
};

/** Shared helper: all nodeIds the user belongs to (source of truth = node docs). */
exports.getUserNodeIds = async (userId) =>
  CommunityNode.find({ members: userId }).distinct('nodeId');

/** Whether consensus voting applies to a given nature (only accountability). */
const votingEnabled = (nature) => nature === 'accountability';

/** Map a node doc into the shape the client expects. */
const toNodeDTO = (n, userId) => ({
  nodeId: n.nodeId,
  name: n.name,
  description: n.description || '',
  nodeType: n.nodeType,
  nature: n.nature,
  visibility: n.visibility,
  joinPolicy: n.joinPolicy,
  memberCount: n.members.length,
  isMember: n.members.includes(userId),
  isCr: n.crUserId === userId,
  isPending: (n.pendingRequests || []).includes(userId),
  pendingCount: (n.pendingRequests || []).length,
  votingEnabled: votingEnabled(n.nature),
  // Only the owner ever sees the invite code.
  inviteCode: n.crUserId === userId ? n.inviteCode : undefined,
});

// POST /api/v1/community/nodes
exports.createNode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, nodeType, nature, visibility, joinPolicy, description } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: 'Community name is required.' });

    const safeNature = ['accountability', 'individuality', 'wellbeing'].includes(nature)
      ? nature
      : 'accountability';
    const safeVisibility = visibility === 'private' ? 'private' : 'public';
    const safeJoinPolicy = joinPolicy === 'locked' ? 'locked' : 'open';

    const node = await CommunityNode.create({
      nodeId: buildNodeId(name),
      name: name.trim(),
      description: (description || '').trim(),
      nodeType: nodeType || 'General',
      nature: safeNature,
      visibility: safeVisibility,
      // join policy is only meaningful for public nodes
      joinPolicy: safeVisibility === 'public' ? safeJoinPolicy : 'locked',
      // The creator owns and administers the community they made.
      crUserId: userId,
      members: [userId],
      pendingRequests: [],
      inviteCode: safeVisibility === 'private' ? buildInviteCode() : null,
      nodeRules: { privacy: safeVisibility === 'private' ? 'invite' : 'open' },
    });

    await syncUserNodes(userId);
    return res.status(201).json({ success: true, data: toNodeDTO(node, userId) });
  } catch (error) {
    console.error('Create Node Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating community.' });
  }
};

// GET /api/v1/community/nodes   (the user's communities)
exports.listMyNodes = async (req, res) => {
  try {
    const userId = req.user.userId;
    const nodes = await CommunityNode.find({ members: userId }).sort({ name: 1 });
    return res.status(200).json({ success: true, data: nodes.map((n) => toNodeDTO(n, userId)) });
  } catch (error) {
    console.error('List My Nodes Error:', error);
    return res.status(500).json({ success: false, message: 'Server error listing communities.' });
  }
};

// GET /api/v1/community/nodes/all   (discover)
// Privacy rule: only PUBLIC communities are discoverable. Private communities
// never surface here — they are reachable only via an invite code.
exports.listAllNodes = async (req, res) => {
  try {
    const userId = req.user.userId;
    const nodes = await CommunityNode.find({ visibility: 'public' })
      .sort({ name: 1 })
      .limit(100);
    return res.status(200).json({ success: true, data: nodes.map((n) => toNodeDTO(n, userId)) });
  } catch (error) {
    console.error('List All Nodes Error:', error);
    return res.status(500).json({ success: false, message: 'Server error listing communities.' });
  }
};

// POST /api/v1/community/nodes/:nodeId/join
// Honors the visibility + join policy contract:
//  - already a member  -> ok
//  - private           -> 403 (must use an invite code)
//  - public + open     -> joined instantly
//  - public + locked   -> queued as a pending request for owner approval
exports.joinNode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });

    if (node.members.includes(userId)) {
      return res.status(200).json({ success: true, status: 'joined', message: `Already in ${node.name}.` });
    }

    if (node.visibility === 'private') {
      return res.status(403).json({
        success: false,
        status: 'invite_required',
        message: 'This is a private community. Join with an invite code.',
      });
    }

    if (node.joinPolicy === 'locked') {
      await CommunityNode.updateOne(
        { nodeId: node.nodeId },
        { $addToSet: { pendingRequests: userId } }
      );
      return res.status(202).json({
        success: true,
        status: 'requested',
        message: `Request sent. An admin of ${node.name} must approve you.`,
      });
    }

    await CommunityNode.updateOne({ nodeId: node.nodeId }, { $addToSet: { members: userId } });
    await syncUserNodes(userId);
    return res.status(200).json({ success: true, status: 'joined', message: `Joined ${node.name}.` });
  } catch (error) {
    console.error('Join Node Error:', error);
    return res.status(500).json({ success: false, message: 'Server error joining community.' });
  }
};

// POST /api/v1/community/nodes/join-by-code   { code }
// The invite-based path for PRIVATE communities (token-style deep link).
exports.joinByCode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: 'Invite code is required.' });

    const node = await CommunityNode.findOne({ inviteCode: code });
    if (!node)
      return res.status(404).json({ success: false, message: 'No community matches that invite code.' });

    await CommunityNode.updateOne({ nodeId: node.nodeId }, { $addToSet: { members: userId } });
    await syncUserNodes(userId);
    return res
      .status(200)
      .json({ success: true, status: 'joined', message: `Joined ${node.name}.`, data: toNodeDTO(node, userId) });
  } catch (error) {
    console.error('Join By Code Error:', error);
    return res.status(500).json({ success: false, message: 'Server error joining community.' });
  }
};

// POST /api/v1/community/nodes/:nodeId/leave
exports.leaveNode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });

    await CommunityNode.updateOne(
      { nodeId: node.nodeId },
      { $pull: { members: userId, pendingRequests: userId } }
    );
    await syncUserNodes(userId);
    return res.status(200).json({ success: true, message: `Left ${node.name}.` });
  } catch (error) {
    console.error('Leave Node Error:', error);
    return res.status(500).json({ success: false, message: 'Server error leaving community.' });
  }
};

// POST /api/v1/community/nodes/:nodeId/approve   { userId }
// Owner-only: approve a pending join request on a locked public community.
exports.approveRequest = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const targetUserId = req.body.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });
    if (node.crUserId !== ownerId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the community admin can approve members.' });
    }
    if (!targetUserId || !node.pendingRequests.includes(targetUserId)) {
      return res.status(400).json({ success: false, message: 'No such pending request.' });
    }

    await CommunityNode.updateOne(
      { nodeId: node.nodeId },
      { $addToSet: { members: targetUserId }, $pull: { pendingRequests: targetUserId } }
    );
    await syncUserNodes(targetUserId);
    return res.status(200).json({ success: true, message: 'Member approved.' });
  } catch (error) {
    console.error('Approve Request Error:', error);
    return res.status(500).json({ success: false, message: 'Server error approving member.' });
  }
};

// GET /api/v1/community/nodes/:nodeId/members
exports.listNodeMembers = async (req, res) => {
  try {
    const userId = req.user.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });
    if (!node.members.includes(userId)) {
      return res.status(403).json({ success: false, message: 'Join this community to view members.' });
    }

    const users = await User.find({ userId: { $in: node.members } }).select(
      'userId name role trustScore'
    );
    const members = users.map((u) => ({
      userId: u.userId,
      name: u.name,
      role: u.role,
      trustScore: u.trustScore,
      isCr: node.crUserId === u.userId,
    }));

    // Surface pending requests so the owner can approve them.
    let pending = [];
    if (node.crUserId === userId || req.user.role === 'admin') {
      const pendingUsers = await User.find({ userId: { $in: node.pendingRequests } }).select(
        'userId name role'
      );
      pending = pendingUsers.map((u) => ({ userId: u.userId, name: u.name, role: u.role }));
    }

    return res.status(200).json({
      success: true,
      data: { node: toNodeDTO(node, userId), members, pending },
    });
  } catch (error) {
    console.error('List Node Members Error:', error);
    return res.status(500).json({ success: false, message: 'Server error listing members.' });
  }
};

// GET /api/v1/community/nodes/:nodeId/feed
// The community's OWN column of updates. Every update is shown here regardless
// of consensus status (verified / pending / rejected) — only verified updates
// are promoted to the dashboard + master calendar elsewhere.
exports.getNodeFeed = async (req, res) => {
  try {
    const userId = req.user.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });
    if (!node.members.includes(userId)) {
      return res.status(403).json({ success: false, message: 'Join this community to view its feed.' });
    }

    const events = await AcademicEvent.find({ nodeId: node.nodeId })
      .sort({ createdAt: -1, date: 1 })
      .limit(100);

    // Annotate each update with the viewer's existing vote + raw tallies.
    const eventIds = events.map((e) => e._id);
    const votes = await ConsensusVote.find({ eventId: { $in: eventIds } });
    const myVoteMap = new Map();
    const echoMap = new Map();
    const flagMap = new Map();
    for (const v of votes) {
      const key = v.eventId.toString();
      if (v.userId === userId) myVoteMap.set(key, v.voteType);
      if (v.voteType === 1) echoMap.set(key, (echoMap.get(key) || 0) + 1);
      else flagMap.set(key, (flagMap.get(key) || 0) + 1);
    }

    const updates = events.map((e) => {
      const key = e._id.toString();
      return {
        id: key,
        eventName: e.eventName,
        date: e.date,
        location: e.location,
        confidenceScore: e.confidenceScore,
        consensusScore: e.consensusScore,
        status: e.status,
        echoes: echoMap.get(key) || 0,
        flags: flagMap.get(key) || 0,
        myVote: myVoteMap.get(key) || 0,
      };
    });

    return res.status(200).json({
      success: true,
      data: { node: toNodeDTO(node, userId), updates },
    });
  } catch (error) {
    console.error('Get Node Feed Error:', error);
    return res.status(500).json({ success: false, message: 'Server error loading community feed.' });
  }
};

// POST /api/v1/community/nodes/:nodeId/updates   { eventName, date, location }
// Any member can broadcast an update into the community. It enters the feed as
// PENDING and rises to VERIFIED once peers Echo it past the consensus threshold.
exports.postNodeUpdate = async (req, res) => {
  try {
    const userId = req.user.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });
    if (!node.members.includes(userId)) {
      return res.status(403).json({ success: false, message: 'Join this community to post updates.' });
    }

    const { eventName, date, location } = req.body;
    if (!eventName || !eventName.trim()) {
      return res.status(400).json({ success: false, message: 'An update title is required.' });
    }

    const when = date ? new Date(date) : new Date();
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date/time.' });
    }

    const { event: saved, status } = await consensusService.upsertEvent({
      userId,
      nodeId: node.nodeId,
      eventName: eventName.trim(),
      date: when,
      location: (location && location.trim()) || 'TBD',
      confidenceScore: 1.0, // a human-posted update is high-confidence by definition
    });

    if (status === 'created') alertScheduler.scheduleEventAlert(saved);

    return res.status(status === 'created' ? 201 : 200).json({
      success: true,
      mergeStatus: status,
      data: {
        id: saved._id,
        eventName: saved.eventName,
        date: saved.date,
        location: saved.location,
        consensusScore: saved.consensusScore,
        status: saved.status,
      },
    });
  } catch (error) {
    console.error('Post Node Update Error:', error);
    return res.status(500).json({ success: false, message: 'Server error posting update.' });
  }
};
