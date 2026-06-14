const CommunityNode = require('../../sharedModels/CommunityNode.model');
const bedrockService = require('./bedrock.service');
const alertScheduler = require('../../core/alertScheduler');
const consensusService = require('../communityEngine/consensus.service');

/**
 * Build an event Date from a raw date + time. Defaults to TODAY when no
 * explicit date is given (never Jan 1). Applies a past-year hallucination catch.
 * @returns {Date|null} null when the result is unparseable.
 */
const buildEventDate = (rawDate, rawTime) => {
  const eventDate = new Date(); // default: today

  const dateStr = typeof rawDate === 'string' ? rawDate.trim() : '';
  const dateMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    eventDate.setFullYear(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }

  let hours = 0;
  let minutes = 0;
  if (typeof rawTime === 'string') {
    const timeMatch = rawTime.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
      const lower = rawTime.toLowerCase();
      if (lower.includes('pm') && hours < 12) hours += 12;
      if (lower.includes('am') && hours === 12) hours = 0;
    }
  }
  eventDate.setHours(hours, minutes, 0, 0);

  // Past-year hallucination catch.
  const currentYear = new Date().getFullYear();
  if (eventDate.getFullYear() < currentYear) eventDate.setFullYear(currentYear);

  return Number.isNaN(eventDate.getTime()) ? null : eventDate;
};

/** Resolve a node the user may post to (only if they're a member). */
const resolveTargetNode = async (nodeId, userId) => {
  if (!nodeId) return null;
  const node = await CommunityNode.findOne({ nodeId, members: userId });
  return node ? node.nodeId : null;
};

// POST /api/v1/overrides/verify  (image / PDF / CSV / ICS via Gemini OCR)
exports.verifyOverride = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { imageString, nodeId } = req.body;

    if (!imageString) {
      return res.status(400).json({ success: false, message: 'Missing image data' });
    }

    const targetNodeId = await resolveTargetNode(nodeId, userId);
    const extractedData = await bedrockService.extractEventFromImage(imageString);

    if (!extractedData || !Array.isArray(extractedData.events)) {
      return res.status(500).json({ success: false, message: 'Invalid data format from AI' });
    }

    const savedEvents = [];
    const counts = { created: 0, merged: 0, unchanged: 0 };

    for (const event of extractedData.events) {
      const eventDate = buildEventDate(event.date, event.time);
      if (!eventDate) {
        console.log(`[Warning] Skipping "${event.eventName}" - unparseable date.`);
        continue;
      }

      const { event: saved, status } = await consensusService.upsertEvent({
        userId,
        nodeId: targetNodeId,
        eventName: event.eventName || 'Untitled Event',
        date: eventDate,
        location: event.location || 'TBD',
        confidenceScore: event.confidenceScore || 0.5,
      });

      counts[status] += 1;
      if (status === 'created') alertScheduler.scheduleEventAlert(saved);
      savedEvents.push(saved);
    }

    return res.status(200).json({
      success: true,
      message: `Processed ${savedEvents.length} events (${counts.created} new, ${counts.merged} echoed, ${counts.unchanged} duplicates).`,
      data: savedEvents,
    });
  } catch (error) {
    console.error('Override Controller Error:', error);
    return res.status(500).json({ success: false, message: 'Server error processing override' });
  }
};

// POST /api/v1/overrides/manual  (direct text entry with chosen date + time)
exports.createManualEvent = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { eventName, date, time, location, nodeId } = req.body;

    if (!eventName || !eventName.trim()) {
      return res.status(400).json({ success: false, message: 'Event name is required.' });
    }

    const targetNodeId = await resolveTargetNode(nodeId, userId);
    const eventDate = buildEventDate(date, time);
    if (!eventDate) {
      return res.status(400).json({ success: false, message: 'Invalid date/time.' });
    }

    const { event: saved, status } = await consensusService.upsertEvent({
      userId,
      nodeId: targetNodeId,
      eventName: eventName.trim(),
      date: eventDate,
      location: (location && location.trim()) || 'TBD',
      confidenceScore: 1.0, // manual entry is high-confidence by definition
    });

    if (status === 'created') alertScheduler.scheduleEventAlert(saved);

    const messages = {
      created: 'Event added to your schedule.',
      merged: 'Matching event found — your vouch raised its consensus.',
      unchanged: "You've already added this event.",
    };

    return res.status(status === 'created' ? 201 : 200).json({
      success: true,
      status,
      message: messages[status],
      data: saved,
    });
  } catch (error) {
    console.error('Manual Event Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating event' });
  }
};
