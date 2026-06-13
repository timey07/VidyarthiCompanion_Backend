const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  locationName: { type: String, required: true },
  action: { type: String, enum: ['check_in', 'check_out'], required: true },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);