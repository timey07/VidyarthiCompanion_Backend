const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const bedrockService = require('./bedrock.service');
const alertScheduler = require('../../core/alertScheduler');

exports.verifyOverride = async (req, res) => {
  try {
    const { userId, eventType, imageString } = req.body;

    if (!imageString || !userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: userId and imageString' 
      });
    }

    // 1. Pass image to Bedrock Service
    const extractedData = await bedrockService.processImageWithBedrock(imageString);

    // 2. Save the verified event to MongoDB
    const newEvent = await AcademicEvent.create({
      userId,
      eventName: extractedData.eventName,
      date: extractedData.date,
      location: extractedData.location,
      confidenceScore: extractedData.confidenceScore,
      status: 'verified',
      source: 'override_engine'
    });
    alertScheduler.scheduleEventAlert(newEvent);

    // 3. Return the exact API Contract to User 1 (Frontend)
    res.status(200).json({
      success: true,
      data: {
        eventName: newEvent.eventName,
        date: newEvent.date,
        location: newEvent.location,
        confidenceScore: newEvent.confidenceScore,
        systemAction: "Routines paused. Safe-Skip activated."
      }
    });

  } catch (error) {
    console.error('Override Controller Error:', error);
    res.status(500).json({ success: false, message: 'Server Error processing override' });
  }
};