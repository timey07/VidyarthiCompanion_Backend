require('dotenv').config();

/**
 * Extracts all event details from a base64 image string using Gemini 2.5 Flash.
 */
const extractEventFromImage = async (base64String) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY in process.env!");
    }

    const systemPrompt = `You are a strict data extraction AI. Scan the provided schedule (it may be an image, a PDF, or CSV/ICS text) and extract ALL events listed on it.
    For each event, extract the event name, date, time, and location. Calculate a confidence score between 0.0 and 1.0.

    DATE RULES (critical):
    - Only output a date that is explicitly present in the source.
    - NEVER invent, guess, or default a date. If no date is shown, set "date" to null.
    - Do NOT fall back to January 1st or any placeholder date.
    Apply the same rule to "time" and "location": if not present, set them to null.

    Return ONLY a raw, valid JSON object matching this exact schema:
    {
      "events": [
        {
          "eventName": "string",
          "date": "YYYY-MM-DD or null",
          "time": "HH:MM or null",
          "location": "string or null",
          "confidenceScore": number
        }
      ]
    }`;

    // Detect the MIME type + payload from the data URL so we can support
    // images, PDFs, and text-based schedules (CSV / ICS) — not just JPEGs.
    const match = base64String.match(/^data:(.*?);base64,(.*)$/s);
    const mimeType = match ? match[1] : 'image/jpeg';
    const payload = match ? match[2] : base64String.replace(/^data:[^,]*,/, '');

    const isText = /^text\//i.test(mimeType) || /csv|calendar|ics/i.test(mimeType);

    let contentParts;
    if (isText) {
      // CSV / ICS / plain text: decode and feed the raw text to the model.
      const text = Buffer.from(payload, 'base64').toString('utf-8');
      contentParts = [
        { text: systemPrompt },
        { text: `Extract all events from this schedule text:\n\n${text}` },
      ];
    } else {
      // Image or PDF: send inline with its real MIME type.
      contentParts = [
        { text: systemPrompt },
        { text: 'Extract all listed events from this schedule file.' },
        { inlineData: { mimeType, data: payload } },
      ];
    }

    // Reverted back to the highly available Gemini 2.5 Flash model
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: contentParts
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0
        }
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

module.exports = {
  extractEventFromImage,
  // Backwards-compatible alias for the original controller call name.
  processImageWithBedrock: extractEventFromImage,
};
