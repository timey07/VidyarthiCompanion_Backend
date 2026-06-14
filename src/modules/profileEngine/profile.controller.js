const User = require('../../sharedModels/User.model');
const CommunityNode = require('../../sharedModels/CommunityNode.model');
const BaselineRoutine = require('../../sharedModels/BaselineRoutine.model');
const MessMenu = require('../../sharedModels/MessMenu.model');
const gemini = require('../../core/gemini.service');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Communities of a given nodeType the user belongs to (for dropdowns). */
const listUserNodesByType = async (userId, nodeType) => {
  const nodes = await CommunityNode.find({ members: userId, nodeType }).select('nodeId name');
  return nodes.map((n) => ({ nodeId: n.nodeId, name: n.name }));
};

const menuToObject = (doc) => {
  if (!doc) return null;
  const menu = {};
  for (const [day, meals] of doc.menu.entries()) {
    menu[day] = {
      breakfast: meals.breakfast || '',
      lunch: meals.lunch || '',
      snacks: meals.snacks || '',
      dinner: meals.dinner || '',
    };
  }
  return { nodeId: doc.nodeId, menu, uploadedBy: doc.uploadedBy, updatedAt: doc.updatedAt };
};

// GET /api/v1/profile
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const [messCommunities, gymCommunities, routine] = await Promise.all([
      listUserNodesByType(userId, 'Mess'),
      listUserNodesByType(userId, 'Gym'),
      BaselineRoutine.findOne({ userId }),
    ]);

    // Resolve the menu for the chosen (or first) Mess community.
    const messNodeId = user.primaryMessNodeId || messCommunities[0]?.nodeId || null;
    const menuDoc = messNodeId ? await MessMenu.findOne({ nodeId: messNodeId }) : null;

    return res.status(200).json({
      success: true,
      data: {
        financial: {
          monthlyBudget: user.financialConfig.monthlyBudget,
          safeBufferPct: user.financialConfig.safeBufferPct || 0,
          currency: user.financialConfig.currency,
          amazonPayBalance: user.financialConfig.amazonPayBalance,
        },
        primaryMessNodeId: user.primaryMessNodeId || null,
        primaryGymNodeId: user.primaryGymNodeId || null,
        messCommunities,
        gymCommunities,
        schedule: routine ? routine.slots : [],
        menu: menuToObject(menuDoc),
        aiEnabled: gemini.hasKey(),
      },
    });
  } catch (error) {
    console.error('Get Profile Error:', error);
    return res.status(500).json({ success: false, message: 'Server error loading profile.' });
  }
};

// PUT /api/v1/profile/financial   { monthlyBudget, safeBufferPct, primaryMessNodeId, primaryGymNodeId }
exports.updateFinancial = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const { monthlyBudget, safeBufferPct, primaryMessNodeId, primaryGymNodeId } = req.body;

    if (monthlyBudget != null) {
      const v = Number(monthlyBudget);
      if (!Number.isFinite(v) || v < 100) {
        return res.status(400).json({ success: false, message: 'Monthly budget must be at least ₹100.' });
      }
      user.financialConfig.monthlyBudget = Math.round(v);
    }
    if (safeBufferPct != null) {
      const v = Number(safeBufferPct);
      if (!Number.isFinite(v) || v < 0 || v > 50) {
        return res.status(400).json({ success: false, message: 'Safe buffer must be between 0 and 50%.' });
      }
      user.financialConfig.safeBufferPct = Math.round(v);
    }
    // Only allow pointing at a community the user actually belongs to.
    if (primaryMessNodeId !== undefined) {
      if (primaryMessNodeId && !user.communityNodeIds.includes(primaryMessNodeId)) {
        return res.status(400).json({ success: false, message: 'Join that Mess community first.' });
      }
      user.primaryMessNodeId = primaryMessNodeId || null;
    }
    if (primaryGymNodeId !== undefined) {
      if (primaryGymNodeId && !user.communityNodeIds.includes(primaryGymNodeId)) {
        return res.status(400).json({ success: false, message: 'Join that Gym community first.' });
      }
      user.primaryGymNodeId = primaryGymNodeId || null;
    }

    await user.save();
    return res.status(200).json({
      success: true,
      message: 'Profile updated.',
      data: {
        monthlyBudget: user.financialConfig.monthlyBudget,
        safeBufferPct: user.financialConfig.safeBufferPct,
        primaryMessNodeId: user.primaryMessNodeId,
        primaryGymNodeId: user.primaryGymNodeId,
      },
    });
  } catch (error) {
    console.error('Update Financial Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating profile.' });
  }
};

// POST /api/v1/profile/parse-document   { type: 'timetable'|'menu', image }
// Parses an uploaded image/PDF via Gemini and returns JSON for the user to
// VERIFY before it is written to the database (no DB write here).
exports.parseDocument = async (req, res) => {
  try {
    const { type, image } = req.body;
    if (!image) return res.status(400).json({ success: false, message: 'No document provided.' });

    if (type === 'timetable') {
      const result = await gemini.parseTimetableImage(image);
      return res.status(200).json({ success: true, data: { type, ...result } });
    }
    if (type === 'menu') {
      const result = await gemini.parseMenuImage(image);
      return res.status(200).json({ success: true, data: { type, ...result } });
    }
    return res.status(400).json({ success: false, message: "type must be 'timetable' or 'menu'." });
  } catch (error) {
    console.error('Parse Document Error:', error);
    return res.status(500).json({ success: false, message: 'Server error parsing document.' });
  }
};

// POST /api/v1/profile/schedule   { slots: [{day, subject, timeStart, timeEnd, room}] }
exports.saveSchedule = async (req, res) => {
  try {
    const userId = req.user.userId;
    const slots = Array.isArray(req.body.slots) ? req.body.slots : [];
    const clean = slots
      .filter((s) => s && s.subject && DAYS.includes(s.day))
      .map((s) => ({
        day: s.day,
        subject: String(s.subject).trim(),
        timeStart: s.timeStart || null,
        timeEnd: s.timeEnd || null,
        room: s.room || null,
      }));

    const routine = await BaselineRoutine.findOneAndUpdate(
      { userId },
      { $set: { slots: clean, source: req.body.source || 'gemini_upload' } },
      { new: true, upsert: true }
    );
    return res.status(200).json({ success: true, message: 'Schedule saved.', data: { slots: routine.slots } });
  } catch (error) {
    console.error('Save Schedule Error:', error);
    return res.status(500).json({ success: false, message: 'Server error saving schedule.' });
  }
};

// GET /api/v1/profile/schedule
exports.getSchedule = async (req, res) => {
  try {
    const routine = await BaselineRoutine.findOne({ userId: req.user.userId });
    return res.status(200).json({ success: true, data: { slots: routine ? routine.slots : [] } });
  } catch (error) {
    console.error('Get Schedule Error:', error);
    return res.status(500).json({ success: false, message: 'Server error loading schedule.' });
  }
};

// POST /api/v1/profile/menu   { nodeId, menu }
// Shared across the whole Mess community: one upload updates everyone's menu.
exports.saveMenu = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { nodeId, menu } = req.body;
    if (!nodeId) return res.status(400).json({ success: false, message: 'A Mess community is required.' });

    const node = await CommunityNode.findOne({ nodeId, members: userId });
    if (!node) {
      return res.status(403).json({ success: false, message: 'Join this Mess community to set its menu.' });
    }

    const clean = {};
    if (menu && typeof menu === 'object') {
      for (const day of DAYS) {
        const m = menu[day];
        if (m) {
          clean[day] = {
            breakfast: m.breakfast || '',
            lunch: m.lunch || '',
            snacks: m.snacks || '',
            dinner: m.dinner || '',
          };
        }
      }
    }

    const doc = await MessMenu.findOneAndUpdate(
      { nodeId },
      { $set: { menu: clean, uploadedBy: userId } },
      { new: true, upsert: true }
    );
    return res.status(200).json({ success: true, message: 'Menu saved for the community.', data: menuToObject(doc) });
  } catch (error) {
    console.error('Save Menu Error:', error);
    return res.status(500).json({ success: false, message: 'Server error saving menu.' });
  }
};

// GET /api/v1/profile/menu?nodeId=
exports.getMenu = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findOne({ userId });
    const nodeId = req.query.nodeId || user?.primaryMessNodeId;
    if (!nodeId) return res.status(200).json({ success: true, data: null });

    const node = await CommunityNode.findOne({ nodeId, members: userId });
    if (!node) return res.status(403).json({ success: false, message: 'Join this community to view its menu.' });

    const doc = await MessMenu.findOne({ nodeId });
    return res.status(200).json({ success: true, data: menuToObject(doc) });
  } catch (error) {
    console.error('Get Menu Error:', error);
    return res.status(500).json({ success: false, message: 'Server error loading menu.' });
  }
};
