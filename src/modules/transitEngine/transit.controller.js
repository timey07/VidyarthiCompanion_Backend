const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const { getUserNodeIds } = require('../communityEngine/node.controller');
const { estimateTransit, estimateModes } = require('./transit.service');

const fmtMins = (m) => (m <= 0 ? 'Leave now' : `${m} min`);

// POST /api/v1/transit/calculate
// Real calc: finds the user's next event and derives a departure time from the
// time-until-event minus an estimated travel time.
exports.calculateDeparture = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentLocation } = req.body;
    const now = new Date();

    // Next upcoming event (own + node-shared, not rejected).
    const myNodeIds = await getUserNodeIds(userId);
    const nextEvent = await AcademicEvent.findOne({
      $or: [{ userId }, { nodeId: { $in: myNodeIds } }],
      date: { $gte: now },
      status: { $ne: 'rejected' },
    }).sort({ date: 1 });

    if (!nextEvent) {
      return res.status(200).json({
        success: true,
        data: {
          status: 'none',
          title: 'No upcoming events',
          message: "You're all caught up. Enjoy the free time.",
        },
      });
    }

    const { transitMode, travelMinutes, distanceKm } = estimateTransit(
      currentLocation,
      nextEvent.location
    );

    const minutesUntil = Math.round((nextEvent.date.getTime() - now.getTime()) / 60000);
    const leaveInMinutes = minutesUntil - travelMinutes;

    // Per-mode options (Walking / Cycling / Auto) with their own leave-in.
    const modes = estimateModes(currentLocation, nextEvent.location).map((m) => ({
      mode: m.mode,
      travelMinutes: m.travelMinutes,
      leaveIn: fmtMins(minutesUntil - m.travelMinutes),
    }));

    // Urgency: already late/now -> critical, within 15 min -> warning, else safe.
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
