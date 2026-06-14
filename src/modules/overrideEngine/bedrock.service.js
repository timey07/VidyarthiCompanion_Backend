require('dotenv').config();

exports.processImageWithBedrock = async (base64String) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY in process.env!");
    }

    const cleanBase64 = base64String.replace(/^data:image\/\w+;base64,/, "");

    const systemPrompt = `You are a strict data extraction AI. Scan the provided image and extract ALL events listed on it.
    For each event, extract the event name, date, time, and location. Calculate a confidence score between 0.0 and 1.0.

    Return ONLY a raw, valid JSON object matching this exact schema:
    {
      "events": [
        {
          "eventName": "string",
          "date": "YYYY-MM-DD",
          "time": "HH:MM",
          "location": "string",
          "confidenceScore": number
        }
      ]
    }`;

    // Using User 3's specific 2.5-flash model via raw fetch
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt },
            { text: "Extract the details from this flyer image." },
            { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } }
          ]
        }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini API Request Failed");

    const responseText = data.candidates[0].content.parts[0].text.trim();
    return JSON.parse(responseText);

  } catch (error) {
    console.error("Gemini OCR Processing Error:", error);
    throw error;
  }
};