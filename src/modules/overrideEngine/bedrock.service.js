// User 3 will implement real Amazon Bedrock OCR here.
// For now, we return mock data so User 1 (Frontend) and User 2 (Backend) can test.
exports.processImageWithBedrock = async (imageString) => {
  console.log("Mock Bedrock Service called with image length:", imageString.length);
  
  return {
    eventName: "CS301 Midterm",
    date: "2026-06-15T09:00:00.000Z",
    location: "Room 402",
    confidenceScore: 0.98
  };
};