const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const CommunityNode = require('../../sharedModels/CommunityNode.model');
const bedrockService = require('./bedrock.service');
const alertScheduler = require('../../core/alertScheduler');
const consensusService = require('../communityEngine/consensus.service');

exports.verifyOverride = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { eventType, imageString, nodeId } = req.body;

    if (!imageString) {
      return res.status(400).json({ success: false, message: 'Missing image data' });
    }

    // If posting to a community node, only allow it if the user is a member.
    let targetNodeId = null;
    if (nodeId) {
      const node = await CommunityNode.findOne({ nodeId, members: userId });
      if (node) targetNodeId = node.nodeId;
    }

    const extractedData = await bedrockService.extractEventFromImage(imageString);

    if (!extractedData || !extractedData.events || !Array.isArray(extractedData.events)) {
      return res.status(500).json({ success: false, message: "Invalid data format from AI" });
    }

    const savedEvents = [];

    for (const event of extractedData.events) {
      // Default to TODAY. We only override the date when the AI returns a real,
      // explicit YYYY-MM-DD. A null/placeholder date means "no date on the
      // image", so the event lands on today's date instead of Jan 1st.
      let eventDate = new Date();

      // 1. Robust Date Component Parsing
      const rawDate = typeof event.date === 'string' ? event.date.trim() : '';
      const dateMatch = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (dateMatch) {
        const [_, year, month, day] = dateMatch;
        eventDate.setFullYear(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
      } else {
        console.log(`[Sanitizer] No explicit date for "${event.eventName}" -> defaulting to today.`);
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

      // ==========================================
      // 3. THE NEW YEAR HALLUCINATION CATCH
      // ==========================================
      const currentYear = new Date().getFullYear();
      if (eventDate.getFullYear() < currentYear) {
        console.log(`[Sanitizer] Correcting hallucinated year ${eventDate.getFullYear()} -> ${currentYear} for event: "${event.eventName}"`);
        eventDate.setFullYear(currentYear);
      }

      // 4. Final Safety Check
      if (isNaN(eventDate.getTime())) {
        console.log(`[Warning] Skipping event "${event.eventName}" due to unparseable date values.`);
        continue;
      }

      // 5. Database Save (starts 'pending'; consensus decides verification)
      const newEvent = await AcademicEvent.create({
        userId,
        nodeId: targetNodeId,
        eventName: event.eventName || "Untitled Event",
        date: eventDate, 
        location: event.location || "TBD",
        confidenceScore: event.confidenceScore || 0.5,
      });

      // Seed the creator's trust-weighted vouch: a CR auto-verifies, a student
      // upload stays pending until peers echo it.
      await consensusService.seedCreatorConsensus(newEvent, userId);

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