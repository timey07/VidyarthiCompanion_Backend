const AttendanceRecord = require('../../sharedModels/AttendanceRecord.model');
const { calculateDistance, campusZones } = require('./geofence.service');

exports.pingLocation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'Missing GPS data' });

    let checkedInZone = null;

    for (const [zoneName, zoneData] of Object.entries(campusZones)) {
      if (calculateDistance(lat, lng, zoneData.lat, zoneData.lng) <= zoneData.radius) {
        checkedInZone = zoneName;
        await AttendanceRecord.create({ userId, locationName: zoneName, action: 'check_in' });
        break; 
      }
    }

    res.status(200).json({
      success: true,
      data: { currentZone: checkedInZone || "Off Campus" }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error processing location' });
  }
};