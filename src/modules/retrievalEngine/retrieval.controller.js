const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
require('dotenv').config();

exports.askCampusFlow = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ success: false, message: 'Missing query' });
    }

    console.log(`User ${userId} asked: "${query}"`);

    // 1. Fetch the user's real context from the database
    const userEvents = await AcademicEvent.find({ userId }).sort({ date: 1 }).limit(3);
    const contextString = userEvents.length > 0 
      ? JSON.stringify(userEvents) 
      : "No upcoming events found in the schedule.";

    // 2. Build the System Prompt
// 2. Build the System Prompt
    const systemPrompt = `You are CampusFlow, an intelligent and helpful college OS assistant. 
    The student has asked: "${query}"
    
    Here is their actual upcoming schedule context from the database (Note: These timestamps are in UTC):
    ${contextString}

    IMPORTANT TIMEZONE RULE: The user is in the India Standard Time (IST) timezone. You MUST convert all UTC times from the database context into IST (UTC +5:30) before presenting them to the user.

    Answer the student's question directly, briefly, and conversationally based ONLY on the context provided. 
    If the schedule is empty, gently tell them to upload a syllabus using the Override Engine.
    Keep the response under 3 sentences.`;

    // 3. Use the proven gemini-2.5-flash endpoint via native fetch
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: systemPrompt }]
        }],
        generationConfig: { temperature: 0.7 } // Slightly higher temp for conversational tone
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Gemini API Request Failed");
    }

    const answer = data.candidates[0].content.parts[0].text.trim();

    // 4. Send the AI response back to User 1
    res.status(200).json({
      success: true,
      data: { answer }
    });

  } catch (error) {
    console.error('Retrieval Engine Error:', error);
    res.status(500).json({ success: false, message: 'Server error querying CampusFlow AI' });
  }
};