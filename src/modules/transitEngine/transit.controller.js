const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const AttendanceRecord = require('../../sharedModels/AttendanceRecord.model');
const { getUserNodeIds } = require('../communityEngine/node.controller');
const { estimateTransit, estimateModes } = require('./transit.service');
const { calculateDistance, campusZones } = require('../presenceEngine/geofence.service');

const fmtMins = (m) => (m <= 0 ? 'Leave now' : `${m} min`);
const normalize = (s) => String(s || '').trim().toLowerCase();
const parseCoords = (loc) => {
  const m = typeof loc === 'string' && loc.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
};

/**
 * Decide whether the user is already at the event's location (so no departure
 * alert is needed). Uses GPS-vs-zone proximity, then the latest presence ping.
 */
const isAlreadyThere = async (userId, currentLocation, eventLocation) => {
  const zone = campusZones[eventLocation];
  const coords = parseCoords(currentLocation);
  if (coords && zone) {
    const dist = calculateDistance(coords.lat, coords.lng, zone.lat, zone.lng);
    if (dist <= (zone.radius || 75)) return true;
  }
  const last = await AttendanceRecord.findOne({ userId }).sort({ timestamp: -1 });
  if (last && normalize(last.locationName) === normalize(eventLocation)) return true;
  return false;
};

// POST /api/v1/transit/calculate
// Departure alert ONLY for the next task that (a) is later TODAY and (b) is at
// a different location (travel actually required). Returns per-mode travel times.
exports.calculateDeparture = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentLocation } = req.body;
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    // Next upcoming event TODAY (own + node-shared, not rejected).
    const myNodeIds = await getUserNodeIds(userId);
    const nextEvent = await AcademicEvent.findOne({
      $or: [{ userId }, { nodeId: { $in: myNodeIds } }],
      date: { $gte: now, $lte: endOfToday },
      status: { $ne: 'rejected' },
    }).sort({ date: 1 });

    if (!nextEvent) {
      return res.status(200).json({
        success: true,
        data: { status: 'none', title: 'No more events today', message: "You're all caught up for today." },
      });
    }

    // No alert if there's no travel (already at the destination).
    if (await isAlreadyThere(userId, currentLocation, nextEvent.location)) {
      return res.status(200).json({
        success: true,
        data: {
          status: 'no_travel',
          title: nextEvent.eventName,
          location: nextEvent.location,
          message: `You're already at ${nextEvent.location}. No travel needed.`,
        },
      });
    }

    const { transitMode, travelMinutes, distanceKm } = estimateTransit(currentLocation, nextEvent.location);
    const minutesUntil = Math.round((nextEvent.date.getTime() - now.getTime()) / 60000);
    const leaveInMinutes = minutesUntil - travelMinutes;

    // Per-mode options (Walking / Cycling / Auto) with their own leave-in.
    const modes = estimateModes(currentLocation, nextEvent.location).map((m) => ({
      mode: m.mode,
      travelMinutes: m.travelMinutes,
      leaveIn: fmtMins(minutesUntil - m.travelMinutes),
    }));

    let status = 'safe';
    if (leaveInMinutes <= 0) status = 'critical';
    else if (leaveInMinutes <= 15) status = 'warning';

    const timeIST = nextEvent.date.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

    return res.status(200).json({
      success: true,
      data: {
        status,
        title: nextEvent.eventName,
        location: nextEvent.location,
        time: timeIST,
        transitMode,
        estTravelTime: `${travelMinutes} min`,
        leaveIn: fmtMins(leaveInMinutes),
        minutesUntil,
        distanceKm,
        modes,
      },
    });
  } catch (error) {
    console.error('Transit Calculation Error:', error);
    return res.status(500).json({ success: false, message: 'Server error calculating transit' });
  }
};
