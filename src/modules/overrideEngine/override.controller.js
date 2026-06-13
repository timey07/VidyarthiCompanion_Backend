const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const bedrockService = require('./bedrock.service');
const alertScheduler = require('../../core/alertScheduler');

exports.verifyOverride = async (req, res) => {
  try {
    const { userId, eventType, imageString } = req.body;

    if (!userId || !imageString) {
      return res.status(400).json({ success: false, message: 'Missing userId or image data' });
    }

    const extractedData = await bedrockService.processImageWithBedrock(imageString);

    if (!extractedData || !extractedData.events || !Array.isArray(extractedData.events)) {
      return res.status(500).json({ success: false, message: "Invalid data format from AI" });
    }

    const savedEvents = [];

    for (const event of extractedData.events) {
      // Start with a clean instance of the current date/time as a base fallback
      let eventDate = new Date();

      // 1. Robust Date Component Parsing
      if (event.date && typeof event.date === 'string') {
        const dateMatch = event.date.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) {
          const [_, year, month, day] = dateMatch;
          eventDate.setFullYear(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
        }
      }

      // 2. Robust Time Component Parsing (handles 19:00, 7:00 PM, 07:00, etc.)
      let hours = 0;
      let minutes = 0;
      if (event.time && typeof event.time === 'string') {
        const timeMatch = event.time.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          hours = parseInt(timeMatch[1], 10);
          minutes = parseInt(timeMatch[2], 10);

          // Handle 12-hour clock adjustments if Gemini added AM/PM explicitly
          const lowerTime = event.time.toLowerCase();
          if (lowerTime.includes('pm') && hours < 12) hours += 12;
          if (lowerTime.includes('am') && hours === 12) hours = 0;
        }
      }
      
      // Apply clean time units
      eventDate.setHours(hours, minutes, 0, 0);

      // 3. Final Safety Check
      if (isNaN(eventDate.getTime())) {
        console.log(`[Warning] Skipping event "${event.eventName}" due to unparseable date values.`);
        continue;
      }

      // 4. Database Save
      const newEvent = await AcademicEvent.create({
        userId,
        eventName: event.eventName || "Untitled Event",
        date: eventDate, 
        location: event.location || "TBD",
        confidenceScore: event.confidenceScore || 0.5,
        status: 'verified'
      });

      alertScheduler.scheduleEventAlert(newEvent);
      savedEvents.push(newEvent);
    }

    res.status(200).json({
      success: true,
      message: `Successfully extracted and scheduled ${savedEvents.length} events.`,
      data: savedEvents 
    });

  } catch (error) {
    console.error('Override Controller Error:', error);
    res.status(500).json({ success: false, message: 'Server error processing override' });
  }
};