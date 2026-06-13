// Calculates distance between two GPS coordinates in meters
exports.calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth's radius
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

// Mock campus locations and their radius (in meters)
exports.campusZones = {
  "Room 402": { lat: 23.0338, lng: 72.5466, radius: 50 },
  "Campus Mess": { lat: 23.0345, lng: 72.5478, radius: 100 }
};