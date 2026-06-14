const CommunityNode = require('../../sharedModels/CommunityNode.model');
const User = require('../../sharedModels/User.model');

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

/** Keep the convenience array on the user in sync with node membership. */
const syncUserNodes = async (userId) => {
  const nodeIds = await CommunityNode.find({ members: userId }).distinct('nodeId');
  await User.updateOne({ userId }, { $set: { communityNodeIds: nodeIds } });
  return nodeIds;
};

/** Shared helper: all nodeIds the user belongs to (source of truth = node docs). */
exports.getUserNodeIds = async (userId) =>
  CommunityNode.find({ members: userId }).distinct('nodeId');

// POST /api/v1/community/nodes
exports.createNode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, nodeType, privacy } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Node name is required.' });

    const node = await CommunityNode.create({
      nodeId: buildNodeId(name),
      name: name.trim(),
      nodeType: nodeType || 'General',
      // A CR who creates a node becomes its CR; others just own membership.
      crUserId: req.user.role === 'cr' || req.user.role === 'admin' ? userId : null,
      members: [userId],
      nodeRules: { privacy: privacy === 'invite' ? 'invite' : 'open' },
    });

    await syncUserNodes(userId);
    return res.status(201).json({ success: true, data: node });
  } catch (error) {
    console.error('Create Node Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating node.' });
  }
};

// GET /api/v1/community/nodes   (the user's nodes)
exports.listMyNodes = async (req, res) => {
  try {
    const nodes = await CommunityNode.find({ members: req.user.userId }).sort({ name: 1 });
    const data = nodes.map((n) => ({
      nodeId: n.nodeId,
      name: n.name,
      nodeType: n.nodeType,
      crUserId: n.crUserId,
      memberCount: n.members.length,
      isCr: n.crUserId === req.user.userId,
    }));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('List My Nodes Error:', error);
    return res.status(500).json({ success: false, message: 'Server error listing nodes.' });
  }
};

// GET /api/v1/community/nodes/all   (discover)
exports.listAllNodes = async (req, res) => {
  try {
    const nodes = await CommunityNode.find().sort({ name: 1 }).limit(100);
    const data = nodes.map((n) => ({
      nodeId: n.nodeId,
      name: n.name,
      nodeType: n.nodeType,
      memberCount: n.members.length,
      isMember: n.members.includes(req.user.userId),
    }));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('List All Nodes Error:', error);
    return res.status(500).json({ success: false, message: 'Server error listing nodes.' });
  }
};

// POST /api/v1/community/nodes/:nodeId/join
exports.joinNode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Node not found.' });

    await CommunityNode.updateOne({ nodeId: node.nodeId }, { $addToSet: { members: userId } });
    await syncUserNodes(userId);
    return res.status(200).json({ success: true, message: `Joined ${node.name}.` });
  } catch (error) {
    console.error('Join Node Error:', error);
    return res.status(500).json({ success: false, message: 'Server error joining node.' });
  }
};

// POST /api/v1/community/nodes/:nodeId/leave
exports.leaveNode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Node not found.' });

    await CommunityNode.updateOne({ nodeId: node.nodeId }, { $pull: { members: userId } });
    await syncUserNodes(userId);
    return res.status(200).json({ success: true, message: `Left ${node.name}.` });
  } catch (error) {
    console.error('Leave Node Error:', error);
    return res.status(500).json({ success: false, message: 'Server error leaving node.' });
  }
};

// GET /api/v1/community/nodes/:nodeId/members
exports.listNodeMembers = async (req, res) => {
  try {
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Node not found.' });

    const users = await User.find({ userId: { $in: node.members } }).select('userId name role trustScore');
    const data = users.map((u) => ({
      userId: u.userId,
      name: u.name,
      role: u.role,
      trustScore: u.trustScore,
      isCr: node.crUserId === u.userId,
    }));
    return res.status(200).json({ success: true, data: { node: { nodeId: node.nodeId, name: node.name, nodeType: node.nodeType }, members: data } });
  } catch (error) {
    console.error('List Node Members Error:', error);
    return res.status(500).json({ success: false, message: 'Server error listing members.' });
  }
};
