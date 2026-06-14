require('dotenv').config();
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const User = require('../../sharedModels/User.model');
const CommunityAlert = require('../../sharedModels/CommunityAlert.model');
const { calculateBurnoutScore } = require('../empathyMesh/safeSkip.service');
const { calculateAffordableMeals, daysRemainingInMonth } = require('../pocketBuddy/meal.service');
const { getUserNodeIds } = require('../communityEngine/node.controller');

exports.askCampusFlow = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ success: false, message: 'Missing query' });
    }

    console.log(`User ${userId} asked: "${query}"`);

    // --- Gather the full ground-truth context (schedule + budget + wellbeing + mess) ---
    const myNodeIds = await getUserNodeIds(userId);
    const now = new Date();

    const [user, events, burnout, messAlerts] = await Promise.all([
      User.findOne({ userId }),
      AcademicEvent.find({
        $or: [{ userId }, { nodeId: { $in: myNodeIds } }],
        date: { $gte: now },
        status: { $ne: 'rejected' },
      })
        .sort({ date: 1 })
        .limit(5),
      calculateBurnoutScore(userId),
      CommunityAlert.find({ status: 'active', nodeType: /mess/i }).sort({ updatedAt: -1 }).limit(3),
    ]);

    let wallet = null;
    if (user) {
      const { amazonPayBalance, monthlyBudget, currency } = user.financialConfig;
      const daysLeft = daysRemainingInMonth();
      const meal = calculateAffordableMeals(amazonPayBalance, daysLeft);
      wallet = {
        balance: Number(amazonPayBalance.toFixed(2)),
        currency,
        monthlyBudget,
        daysLeftInMonth: daysLeft,
        perMealThreshold: meal.targetThreshold,
        affordableOptions: meal.affordableOptions.map((o) => `${o.name} (₹${o.averageCost})`),
      };
    }

    const context = {
      upcomingEvents: events.map((e) => ({
        eventName: e.eventName,
        dateUTC: e.date,
        location: e.location,
        status: e.status,
      })),
      wallet,
      wellbeing: { burnoutScore: burnout.burnoutScore, recommendSkip: burnout.recommendSkip },
      messStatus: messAlerts.map((a) => ({
        message: a.message,
        echoes: a.upvotes,
        flags: a.downvotes,
      })),
    };

    // --- Build the grounded prompt ---
    const systemPrompt = `You are CampusFlow, an intelligent, helpful college life + finance assistant for a student in India.
The student asked: "${query}"

Here is their LIVE context as JSON (use ONLY this; do not invent facts):
${JSON.stringify(context)}

RULES:
- Timezone: all dateUTC values are UTC. The student is in IST (UTC +5:30); convert before stating any time.
- Money: the currency is Indian Rupees (₹). Quote amounts in ₹.
- Schedule questions: answer from upcomingEvents.
- Budget/food questions: use wallet (balance, perMealThreshold, affordableOptions). If the mess is flagged in messStatus and the budget allows, you may suggest an affordable outside option; otherwise recommend the mess.
- Wellbeing questions: use wellbeing. If recommendSkip is true, gently mention a Safe-Skip is available.
- If the relevant context is empty, say so briefly and suggest the right action (e.g., upload a timetable via the Override Engine).
- Be direct and conversational. Keep the response under 3 sentences.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.6 },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini API Request Failed');
    }

    const answer = data.candidates[0].content.parts[0].text.trim();

    res.status(200).json({ success: true, data: { answer } });
  } catch (error) {
    console.error('Retrieval Engine Error:', error);
    res.status(500).json({ success: false, message: 'Server error querying CampusFlow AI' });
  }
};
