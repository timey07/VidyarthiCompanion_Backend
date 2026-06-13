import dotenv from 'dotenv';
dotenv.config();

/**
 * Extracts event details from a base64 image string using Gemini 2.5 Flash.
 */
export const extractEventFromImage = async (base64String) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY in process.env!");
    }

    // Strip out the data URL prefix if present to get raw base64
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

    // Target the ultra-fast multimodal model
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              { text: "Extract the details from this flyer image." },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: cleanBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json", // Forces Gemini to return pure JSON
          temperature: 0
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Gemini API Request Failed");
    }

    // Extract the text response block
    const responseText = data.candidates[0].content.parts[0].text.trim();
    
    return JSON.parse(responseText);

  } catch (error) {
    console.error("Gemini OCR Processing Error:", error);
    throw error;
  }
};