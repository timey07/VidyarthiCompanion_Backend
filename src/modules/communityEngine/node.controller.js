const CommunityNode = require('../../sharedModels/CommunityNode.model');
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const ConsensusVote = require('../../sharedModels/ConsensusVote.model');
const User = require('../../sharedModels/User.model');
const BaselineRoutine = require('../../sharedModels/BaselineRoutine.model');
const MessMenu = require('../../sharedModels/MessMenu.model');

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

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MESS_MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'];

/** Sanitize an incoming timetable into clean baseline slots. */
const cleanSchedule = (slots) =>
  (Array.isArray(slots) ? slots : [])
    .filter((s) => s && s.subject && DAYS.includes(s.day))
    .map((s) => ({
      day: s.day,
      subject: String(s.subject).trim(),
      timeStart: s.timeStart || null,
      timeEnd: s.timeEnd || null,
      room: s.room || null,
    }));

/** Sanitize an incoming weekly menu (day -> {meal: dish}). */
const cleanMenu = (menu) => {
  const out = {};
  if (menu && typeof menu === 'object') {
    for (const day of DAYS) {
      const m = menu[day];
      if (m) {
        out[day] = {
          breakfast: m.breakfast || '',
          lunch: m.lunch || '',
          snacks: m.snacks || '',
          dinner: m.dinner || '',
        };
      }
    }
  }
  return out;
};

/** Whether a sanitized menu has at least one dish entered. */
const menuHasContent = (menu) =>
  Object.values(menu || {}).some((m) => MESS_MEALS.some((meal) => (m[meal] || '').trim()));

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

/** Whether a user has admin powers over a node. */
const isAdminOf = (node, userId) =>
  (node.admins || []).includes(userId) || node.crUserId === userId;

/** Map a node doc into the shape the client expects. */
const toNodeDTO = (n, userId) => {
  const admin = isAdminOf(n, userId);
  return {
    nodeId: n.nodeId,
    name: n.name,
    description: n.description || '',
    nodeType: n.nodeType,
    nature: n.nature,
    visibility: n.visibility,
    joinPolicy: n.joinPolicy,
    memberCount: n.members.length,
    isMember: n.members.includes(userId),
    isCr: admin,
    isAdmin: admin,
    isPending: (n.pendingRequests || []).includes(userId),
    pendingCount: (n.pendingRequests || []).length,
    votingEnabled: votingEnabled(n.nature),
    // Members can view the community baseline timetable (Academic communities).
    baselineSchedule: n.baselineSchedule || [],
    // Only admins ever see the invite code.
    inviteCode: admin ? n.inviteCode : undefined,
  };
};

// POST /api/v1/community/nodes
exports.createNode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, nodeType, nature, description, menu } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: 'Community name is required.' });

    const safeNature = ['accountability', 'wellbeing'].includes(nature)
      ? nature
      : 'accountability';
    const safeNodeType = nodeType || 'General';
    const isMess = safeNodeType === 'Mess';

    // Accountability communities MUST be created with a baseline timetable
    // (Class / Gym / General) or menu (Mess). Wellbeing groups carry neither.
    // The timetable falls back to the creator's saved routine when not supplied.
    let baselineSchedule = cleanSchedule(req.body.baselineSchedule);
    if (!baselineSchedule.length && !isMess) {
      const routine = await BaselineRoutine.findOne({ userId });
      if (routine && routine.slots.length) baselineSchedule = cleanSchedule(routine.slots);
    }
    const cleanedMenu = cleanMenu(menu);

    if (safeNature === 'accountability') {
      if (isMess && !menuHasContent(cleanedMenu)) {
        return res.status(400).json({
          success: false,
          message: 'A Mess community needs a menu. Upload or enter the weekly menu to create it.',
        });
      }
      if (!isMess && baselineSchedule.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Accountability communities need a timetable. Upload or enter it to create the community.',
        });
      }
    }

    const node = await CommunityNode.create({
      nodeId: buildNodeId(name),
      name: name.trim(),
      description: (description || '').trim(),
      nodeType: safeNodeType,
      nature: safeNature,
      // Every community is now PRIVATE: discovery is off and joining is invite-only.
      visibility: 'private',
      joinPolicy: 'locked',
      // The creator owns and administers the community they made.
      crUserId: userId,
      admins: [userId],
      members: [userId],
      pendingRequests: [],
      inviteCode: buildInviteCode(),
      baselineSchedule,
      nodeRules: { privacy: 'invite' },
    });

    // Mess communities store their shared menu in MessMenu (keyed by nodeId).
    if (isMess && menuHasContent(cleanedMenu)) {
      await MessMenu.findOneAndUpdate(
        { nodeId: node.nodeId },
        { $set: { menu: cleanedMenu, uploadedBy: userId } },
        { new: true, upsert: true }
      );
    }

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

/** Normalize a list of class slots into a stable, comparable shape. */
const normalizeSchedule = (slots = []) =>
  (slots || [])
    .map((s) => ({
      day: s.day,
      subject: String(s.subject || '').trim().toLowerCase(),
      timeStart: s.timeStart || '',
      timeEnd: s.timeEnd || '',
      room: String(s.room || '').trim().toLowerCase(),
    }))
    .sort((a, b) =>
      `${a.day}${a.timeStart}${a.subject}`.localeCompare(`${b.day}${b.timeStart}${b.subject}`)
    );

/** Normalize a weekly menu (Map or object) into a comparable plain object. */
const normalizeMenu = (src) => {
  const out = {};
  if (!src) return out;
  const entries = src instanceof Map ? src.entries() : Object.entries(src);
  for (const [day, meals] of entries) {
    const m = meals || {};
    out[day] = {
      breakfast: String(m.breakfast || '').trim().toLowerCase(),
      lunch: String(m.lunch || '').trim().toLowerCase(),
      snacks: String(m.snacks || '').trim().toLowerCase(),
      dinner: String(m.dinner || '').trim().toLowerCase(),
    };
  }
  return out;
};

const menuDocToObject = (doc) => {
  if (!doc) return null;
  const out = {};
  for (const [day, meals] of doc.menu.entries()) {
    out[day] = {
      breakfast: meals.breakfast || '',
      lunch: meals.lunch || '',
      snacks: meals.snacks || '',
      dinner: meals.dinner || '',
    };
  }
  return out;
};

/** Convert a stored personal-menu Map into a plain (case-preserving) object. */
const personalMenuToObject = (map) => {
  if (!map) return null;
  const out = {};
  const entries = map instanceof Map ? map.entries() : Object.entries(map);
  for (const [day, meals] of entries) {
    const m = meals || {};
    out[day] = {
      breakfast: m.breakfast || '',
      lunch: m.lunch || '',
      snacks: m.snacks || '',
      dinner: m.dinner || '',
    };
  }
  return Object.keys(out).length ? out : null;
};

/**
 * On joining a Class (Academic) or Mess community, OVERRIDE the member's
 * personal timetable / menu with the community's baseline and return an
 * "adoption" descriptor so the client can showcase what was applied (and offer
 * an undo back to the previous version). Returns null when the community has no
 * baseline to adopt.
 */
const applyJoinAdoption = async (node, userId) => {
  if (node.nodeType === 'Academic') {
    const communitySchedule = cleanSchedule(node.baselineSchedule || []);
    if (!communitySchedule.length) return null;

    const routine = await BaselineRoutine.findOne({ userId });
    const previousSchedule = routine ? cleanSchedule(routine.slots) : [];
    const changed =
      JSON.stringify(normalizeSchedule(communitySchedule)) !==
      JSON.stringify(normalizeSchedule(previousSchedule));

    // Override the personal timetable with the community's version.
    await BaselineRoutine.findOneAndUpdate(
      { userId },
      { $set: { slots: communitySchedule, source: 'community_sync' } },
      { new: true, upsert: true }
    );

    return {
      kind: 'class',
      nodeId: node.nodeId,
      nodeName: node.name,
      changed,
      communitySchedule,
      previousSchedule,
    };
  }

  if (node.nodeType === 'Mess') {
    const menuDoc = await MessMenu.findOne({ nodeId: node.nodeId });
    const communityMenu = menuDocToObject(menuDoc);
    if (!communityMenu) return null;

    const user = await User.findOne({ userId });
    if (!user) return null;
    const previousMenu = personalMenuToObject(user.personalMessMenu);
    const changed =
      JSON.stringify(normalizeMenu(communityMenu)) !== JSON.stringify(normalizeMenu(previousMenu || {}));

    // Override the personal menu with the community's version.
    user.personalMessMenu = communityMenu;
    await user.save();

    return {
      kind: 'mess',
      nodeId: node.nodeId,
      nodeName: node.name,
      changed,
      communityMenu,
      previousMenu,
    };
  }

  return null;
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

    const wasMember = node.members.includes(userId);
    await CommunityNode.updateOne({ nodeId: node.nodeId }, { $addToSet: { members: userId } });
    await syncUserNodes(userId);

    // Class/Mess: adopt (override personal with) the community baseline on a
    // fresh join, and tell the client so it can showcase the adopted version.
    let adopted = null;
    if (!wasMember) {
      adopted = await applyJoinAdoption(node, userId);
    }

    return res.status(200).json({
      success: true,
      status: 'joined',
      message: `Joined ${node.name}.`,
      data: toNodeDTO(node, userId),
      adopted,
    });
  } catch (error) {
    console.error('Join By Code Error:', error);
    return res.status(500).json({ success: false, message: 'Server error joining community.' });
  }
};

// PUT /api/v1/community/nodes/:nodeId/baseline   { schedule } | { menu }
// Admin-only: update the community's baseline timetable (Academic) or menu (Mess).
exports.updateBaseline = async (req, res) => {
  try {
    const userId = req.user.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });
    if (!isAdminOf(node, userId) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only an admin can update the community timetable.' });
    }

    if (node.nodeType === 'Mess') {
      const cleaned = cleanMenu(req.body.menu);
      if (!menuHasContent(cleaned)) {
        return res.status(400).json({ success: false, message: 'The menu cannot be empty.' });
      }
      const doc = await MessMenu.findOneAndUpdate(
        { nodeId: node.nodeId },
        { $set: { menu: cleaned, uploadedBy: userId } },
        { new: true, upsert: true }
      );
      return res.status(200).json({
        success: true,
        message: 'Community menu updated.',
        data: { menu: menuDocToObject(doc) },
      });
    }

    // Academic / other accountability types -> baseline timetable.
    const schedule = cleanSchedule(req.body.schedule);
    if (!schedule.length) {
      return res.status(400).json({ success: false, message: 'The timetable cannot be empty.' });
    }
    node.baselineSchedule = schedule;
    await node.save();
    return res.status(200).json({
      success: true,
      message: 'Community timetable updated.',
      data: { baselineSchedule: node.baselineSchedule },
    });
  } catch (error) {
    console.error('Update Baseline Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating community baseline.' });
  }
};

// POST /api/v1/community/nodes/:nodeId/leave
// Self-healing membership:
//  - if the last member leaves, the community (and its updates) are deleted
//  - if an admin leaves and no admins remain, the oldest remaining member is
//    promoted to admin so the community is never left leaderless
exports.leaveNode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });

    const remaining = node.members.filter((m) => m !== userId);

    // Last one out: tear the whole community down (updates + votes included).
    if (remaining.length === 0) {
      const events = await AcademicEvent.find({ nodeId: node.nodeId }).select('_id');
      const eventIds = events.map((e) => e._id);
      if (eventIds.length) await ConsensusVote.deleteMany({ eventId: { $in: eventIds } });
      await AcademicEvent.deleteMany({ nodeId: node.nodeId });
      await CommunityNode.deleteOne({ nodeId: node.nodeId });
      await syncUserNodes(userId);
      return res
        .status(200)
        .json({ success: true, status: 'deleted', message: `${node.name} was disbanded.` });
    }

    let admins = (node.admins || []).filter((a) => a !== userId);
    let crUserId = node.crUserId;

    // No admins left -> promote the oldest remaining member (join order).
    if (admins.length === 0) {
      admins = [remaining[0]];
      crUserId = remaining[0];
    } else if (crUserId === userId) {
      // Primary owner left but other admins remain: hand the title to one.
      crUserId = admins[0];
    }

    await CommunityNode.updateOne(
      { nodeId: node.nodeId },
      {
        $set: { members: remaining, admins, crUserId },
        $pull: { pendingRequests: userId },
      }
    );
    await syncUserNodes(userId);
    return res.status(200).json({ success: true, status: 'left', message: `Left ${node.name}.` });
  } catch (error) {
    console.error('Leave Node Error:', error);
    return res.status(500).json({ success: false, message: 'Server error leaving community.' });
  }
};

// POST /api/v1/community/nodes/:nodeId/approve   { userId }
// Admin-only: approve a pending join request on a locked public community.
exports.approveRequest = async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const targetUserId = req.body.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });
    if (!isAdminOf(node, requesterId) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only an admin can approve members.' });
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

// POST /api/v1/community/nodes/:nodeId/admins   { userId }
// Admin-only: promote an existing member to admin.
exports.promoteMember = async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const targetUserId = req.body.userId;
    const node = await CommunityNode.findOne({ nodeId: req.params.nodeId });
    if (!node) return res.status(404).json({ success: false, message: 'Community not found.' });
    if (!isAdminOf(node, requesterId) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only an admin can promote members.' });
    }
    if (!targetUserId || !node.members.includes(targetUserId)) {
      return res.status(400).json({ success: false, message: 'That user is not a member.' });
    }

    await CommunityNode.updateOne(
      { nodeId: node.nodeId },
      { $addToSet: { admins: targetUserId } }
    );
    return res.status(200).json({ success: true, message: 'Member promoted to admin.' });
  } catch (error) {
    console.error('Promote Member Error:', error);
    return res.status(500).json({ success: false, message: 'Server error promoting member.' });
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
      isCr: isAdminOf(node, u.userId),
      isAdmin: isAdminOf(node, u.userId),
    }));

    // Surface pending requests so admins can approve them.
    let pending = [];
    if (isAdminOf(node, userId) || req.user.role === 'admin') {
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
