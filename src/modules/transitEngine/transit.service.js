const { calculateDistance, campusZones } = require('../presenceEngine/geofence.service');

// Rough India-centric speeds (km/h) for travel-time estimates.
const WALK_KMH = 5;
const AUTO_KMH = 18;
const WALK_MAX_KM = 1.2; // below this, walking is assumed

/** Parse "lat,lng" into coords, else null. */
const parseCoords = (loc) => {
  if (typeof loc !== 'string') return null;
  const m = loc.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
};

/**
 * Estimate transit mode + minutes from the user's current location to an event.
 * Uses real Haversine distance when both the current coords and the event's
 * campus zone are known; otherwise falls back to sensible on/off-campus defaults.
 */
const estimateTransit = (currentLocation, eventLocation) => {
  const coords = parseCoords(currentLocation);
  const zone = eventLocation ? campusZones[eventLocation] : null;

  let distanceKm = null;
  if (coords && zone) {
    distanceKm = calculateDistance(coords.lat, coords.lng, zone.lat, zone.lng) / 1000;
  }

  let transitMode;
  let minutes;
  if (distanceKm != null) {
    if (distanceKm <= WALK_MAX_KM) {
      transitMode = 'Walk';
      minutes = (distanceKm / WALK_KMH) * 60;
    } else {
      transitMode = 'Auto Rickshaw';
      minutes = (distanceKm / AUTO_KMH) * 60 + 5; // + hailing buffer
    }
  } else if (currentLocation === 'campus') {
    // On campus, destination unknown -> short walk.
    transitMode = 'Walk';
    minutes = 10;
  } else {
    // Off campus / unknown -> default auto ride.
    transitMode = 'Auto Rickshaw';
    minutes = 30;
  }

  return {
    transitMode,
    travelMinutes: Math.max(5, Math.round(minutes)),
    distanceKm: distanceKm != null ? Number(distanceKm.toFixed(2)) : null,
  };
};

module.exports = { estimateTransit };
