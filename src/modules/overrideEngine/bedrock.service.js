import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

// Initialize the Bedrock client
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });

/**
 * Extracts event details from a base64 image string.
 * @param {string} base64String - The image data (can include data URI prefix)
 * @returns {Promise<Object>} The parsed JSON event data
 */
export const extractEventFromImage = async (base64String) => {
  try {
    // Strip the data URI prefix if it exists to get pure base64
    const cleanBase64 = base64String.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(cleanBase64, "base64");

    const systemPrompt = `You are a strict data extraction AI. Extract the event name, date, time, and location from the provided image. 
    You must calculate a confidence score between 0.0 and 1.0 based on how clearly the text is legible.
    Return ONLY a valid JSON object matching this exact schema:
    {
      "eventName": "string",
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "location": "string",
      "confidenceScore": number
    }`;

    const command = new ConverseCommand({
      modelId: "anthropic.claude-3-haiku-20240307-v1:0",
      system: [{ text: systemPrompt }],
      messages: [
        {
          role: "user",
          content: [
            {
              image: {
                format: "jpeg", // Bedrock accepts jpeg, png, webp
                source: { bytes: imageBuffer },
              },
            },
            { text: "Extract the details from this flyer." }
          ],
        },
      ],
      inferenceConfig: { temperature: 0 }, // 0 ensures deterministic JSON output
    });

    const response = await bedrockClient.send(command);
    const responseText = response.output.message.content[0].text;
    
    return JSON.parse(responseText);

  } catch (error) {
    console.error("Bedrock OCR Error:", error);
    throw new Error("Failed to extract data from image.");
  }
};