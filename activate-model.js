import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

async function forceActivation() {
  console.log("⚡ Forcing account-level activation for Amazon Nova Lite...");
  
  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });

  // Sending a tiny payload forces AWS to execute the implicit marketplace handshake
  const command = new InvokeModelCommand({
    modelId: "us.amazon.nova-lite-v1:0", 
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      inferenceConfig: { maxTokens: 5 },
      messages: [{ role: "user", content: [{ text: "hi" }] }]
    })
  });

  try {
    const response = await client.send(command);
    console.log("✅ Model successfully activated on your account! You can now run your main script.");
  } catch (error) {
    console.error("❌ Activation Error Details:", error);
  }
}

forceActivation();