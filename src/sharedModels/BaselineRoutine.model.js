const mongoose = require('mongoose');

/**
 * The user's OFFICIAL academic baseline — the ERP timetable parsed from an
 * uploaded image/PDF. This is the 100% ground-truth the Verified Override
 * Engine mutates when a notice says "Math class moved to 4 PM".
 *
 * One document per user; `slots` is the full weekly grid.
 */
const slotSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      required: true,
    },
    subject: { type: String, required: true, trim: true },
    timeStart: { type: String, default: null }, // "HH:MM" (24h)
    timeEnd: { type: String, default: null },
    room: { type: String, default: null },
  },
  { _id: false }
);

const baselineRoutineSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    slots: { type: [slotSchema], default: [] },
    source: { type: String, default: 'gemini_upload' }, // gemini_upload | manual
  },
  { timestamps: true }
);

module.exports = mongoose.model('BaselineRoutine', baselineRoutineSchema);
