const { GoogleGenerativeAI } = require("@google/generative-ai");
const AcademicEvent = require('../../sharedModels/AcademicEvent.model');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.askCampusFlow = async (req, res) => {
  try {
    const { query, userId } = req.body;

    if (!query || !userId) {
      return res.status(400).json({ success: false, message: 'Missing query or userId' });
    }

    console.log(`User ${userId} asked: "${query}"`);

    // 1. Fetch the user's real context from the database
    const userEvents = await AcademicEvent.find({ userId }).sort({ date: 1 }).limit(3);
    const contextString = userEvents.length > 0 
      ? JSON.stringify(userEvents) 
      : "No upcoming events found in the schedule.";

    // 2. Build the System Prompt
    const prompt = `
      You are CampusFlow, an intelligent and helpful college OS assistant. 
      The student has asked: "${query}"
      
      Here is their actual upcoming schedule context from the database:
      ${contextString}

      Answer the student's question directly, briefly, and conversationally based ONLY on the context provided. 
      If the schedule is empty, gently tell them to upload a syllabus using the Override Engine.
      Keep the response under 3 sentences.
    `;

    // 3. Call the fast Gemini Flash model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const answer = result.response.text();

    // 4. Send the AI response back to User 1
    res.status(200).json({
      success: true,
      data: {
        answer: answer.trim()
      }
    });

  } catch (error) {
    console.error('Retrieval Engine Error:', error);
    res.status(500).json({ success: false, message: 'Server error querying CampusFlow AI' });
  }
};