import fs from 'fs';
import { extractEventFromImage } from './src/modules/overrideEngine/bedrock.service.js';

async function runTest() {
  console.log("🚀 Starting Gemini OCR Test...");
  
  try {
    // 1. Ensure the image exists (Update the filename to match yours if needed)
    const imagePath = './test-flyer.jpg'; 
    if (!fs.existsSync(imagePath)) {
        throw new Error(`Cannot find image file at: ${imagePath}`);
    }

    // 2. Convert to Base64
    console.log("📸 Reading image file...");
    const base64Image = fs.readFileSync(imagePath, { encoding: 'base64' });

    // 3. Transmit (The service file now handles the Google Gemini routing)
    console.log("🧠 Transmitting to Google Gemini (Gemini 2.5 Flash)...");
    const result = await extractEventFromImage(base64Image);

    // 4. Print the Victory!
    console.log("\n✅ SUCCESS! Extracted Event Data:");
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error("\n❌ Test Failed:");
    console.error(error.message || error);
  }
}

runTest();