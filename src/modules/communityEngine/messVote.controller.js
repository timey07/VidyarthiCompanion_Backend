const CommunityNode = require('../../sharedModels/CommunityNode.model');
const MessMealVote = require('../../sharedModels/MessMealVote.model');
const MessMenu = require('../../sharedModels/MessMenu.model');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Local YYYY-MM-DD key (server local time) for "today". */
const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Which meal is currently being voted on, time-gated (Module 2):
 *  - morning (before ~11:00)  -> breakfast  (vote appears before lunch)
 *  - afternoon (before ~17:00) -> lunch      (vote appears before dinner)
 *  - evening                   -> dinner
 */
const currentVotableSlot = (d = new Date()) => {
  const h = d.getHours();
  if (h < 11) return 'breakfast';
  if (h < 17) return 'lunch';
  return 'dinner';
};

const SLOTS = ['breakfast', 'lunch', 'dinner'];

/** Aggregate eatable/leave tallies for each meal slot of the node today. */
const tallyToday = async (nodeId, dateKey) => {
  const votes = await MessMealVote.find({ nodeId, dateKey }).select('slot verdict');
  const base = {};
  for (const slot of SLOTS) base[slot] = { eatable: 0, leave: 0, total: 0, net: 0 };
  for (const v of votes) {
    const bucket = base[v.slot];
    if (!bucket) continue;
    if (v.verdict === 'eatable') bucket.eatable += 1;
    else bucket.leave += 1;
    bucket.total += 1;
    bucket.net = bucket.eatable - bucket.leave;
  }
  return base;
};

/** Today's dish for a given slot from the community menu (if uploaded). */
const dishFor = async (nodeId, slot) => {
  const menuDoc = await MessMenu.findOne({ nodeId });
  if (!menuDoc) return null;
  const meals = menuDoc.menu.get(DAY_NAMES[new Date().getDay()]);
  if (!meals) return null;
  // 'dinner'/'lunch'/'breakfast' map directly; the menu also has 'snacks'.
  return meals[slot] || null;
};

const loadMessNode = async (nodeId, userId) => {
  const node = await CommunityNode.findOne({ nodeId });
  if (!node) return { error: { code: 404, message: 'Community not found.' } };
  if (!node.members.includes(userId)) {
    return { error: { code: 403, message: 'Join this community to vote on meals.' } };
  }
  if (node.nodeType !== 'Mess') {
    return { error: { code: 400, message: 'Meal voting is only available in Mess communities.' } };
  }
  return { node };
};

// GET /api/v1/community/nodes/:nodeId/mess-vote
exports.getMessVotes = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { node, error } = await loadMessNode(req.params.nodeId, userId);
    if (error) return res.status(error.code).json({ success: false, message: error.message });

    const dateKey = todayKey();
    const slot = currentVotableSlot();
    const [tallies, myVotes, dish] = await Promise.all([
      tallyToday(node.nodeId, dateKey),
      MessMealVote.find({ nodeId: node.nodeId, userId, dateKey }).select('slot verdict'),
      dishFor(node.nodeId, slot),
    ]);

    const myVoteMap = {};
    for (const slotName of SLOTS) myVoteMap[slotName] = null;
    for (const v of myVotes) myVoteMap[v.slot] = v.verdict;

    return res.status(200).json({
      success: true,
      data: {
        nodeId: node.nodeId,
        dateKey,
        currentSlot: slot,
        currentDish: dish,
        slots: tallies,
        myVotes: myVoteMap,
      },
    });
  } catch (err) {
    console.error('Get Mess Votes Error:', err);
    return res.status(500).json({ success: false, message: 'Server error loading meal votes.' });
  }
};

// POST /api/v1/community/nodes/:nodeId/mess-vote   { slot, verdict }
// Honors time-gating: you can only vote on the CURRENT meal slot.
exports.castMessVote = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { node, error } = await loadMessNode(req.params.nodeId, userId);
    if (error) return res.status(error.code).json({ success: false, message: error.message });

    const verdict = req.body.verdict === 'leave' ? 'leave' : req.body.verdict === 'eatable' ? 'eatable' : null;
    if (!verdict) {
      return res.status(400).json({ success: false, message: 'Vote must be "eatable" or "leave".' });
    }

    const slot = currentVotableSlot();
    // Members vote on the CURRENT meal only (time-gated).
    if (req.body.slot && req.body.slot !== slot) {
      return res.status(409).json({
        success: false,
        message: `Voting for ${req.body.slot} is closed. The current meal is ${slot}.`,
      });
    }

    const dateKey = todayKey();
    await MessMealVote.findOneAndUpdate(
      { nodeId: node.nodeId, userId, dateKey, slot },
      { $set: { verdict } },
      { upsert: true, new: true }
    );

    const tallies = await tallyToday(node.nodeId, dateKey);
    return res.status(200).json({
      success: true,
      message: verdict === 'eatable' ? 'Marked as eatable.' : 'Marked to leave this meal.',
      data: { currentSlot: slot, slots: tallies, myVerdict: verdict },
    });
  } catch (err) {
    console.error('Cast Mess Vote Error:', err);
    return res.status(500).json({ success: false, message: 'Server error casting vote.' });
  }
};

// Exported helpers reused by the recommendation engine.
exports._helpers = { todayKey, currentVotableSlot, tallyToday, SLOTS };
