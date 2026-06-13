const mongoose = require('mongoose');

const academicEventSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    index: true 
  },
  eventName: { 
    type: String, 
    required: true 
  },
  date: { 
    type: Date, 
    required: true 
  },
  location: { 
    type: String, 
    required: true 
  },
  confidenceScore: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['verified', 'pending', 'rejected'], 
    default: 'verified' 
  },
  source: { 
    type: String, 
    default: 'override_engine' 
  }
}, { timestamps: true });

module.exports = mongoose.model('AcademicEvent', academicEventSchema);