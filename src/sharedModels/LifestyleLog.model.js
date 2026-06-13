const mongoose = require('mongoose');

const lifestyleLogSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    index: true 
  },
  logType: { 
    type: String, 
    enum: ['sleep', 'stress_level', 'meal_skipped', 'social_isolation'], 
    required: true 
  },
  severity: { 
    type: Number, 
    min: 1, 
    max: 10, 
    required: true // 10 is critical burnout
  },
  notes: { 
    type: String 
  }
}, { timestamps: true });

module.exports = mongoose.model('LifestyleLog', lifestyleLogSchema);