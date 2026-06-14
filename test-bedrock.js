import fs from 'fs';
import { extractEventFromImage } from './src/modules/overrideEngine/bedrock.service.js';

async function runTest() {
  console.log("🚀 Starting Gemini OCR Test...");
  
  try {
    const imagePath = './test-flyer.jpg'; 
    if (!fs.existsSync(imagePath)) {
        throw new Error(`Cannot find image file at: ${imagePath}`);
    }

    console.log("📸 Reading image file...");
    const base64Image = fs.readFileSync(imagePath, { encoding: 'base64' });

    console.log("🧠 Transmitting to Google Gemini (Gemini 2.5 Flash)...");
    const result = await extractEventFromImage(base64Image);

    console.log("\n✅ SUCCESS! Extracted Event Data:");
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error("\n❌ Test Failed:");
    console.error(error.message || error);
  }
}

runTest();