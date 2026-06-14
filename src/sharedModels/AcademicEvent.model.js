const mongoose = require('mongoose');

const academicEventSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    index: true 
  },
  // Community node this event is shared with (null = personal/private).
  nodeId: {
    type: String,
    default: null,
    index: true,
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
  // Trust-weighted community consensus. Drives the verification lifecycle:
  // seeded with the creator's trustScore, then moved by community votes.
  consensusScore: {
    type: Number,
    default: 0,
    index: true,
  },
  status: { 
    type: String, 
    enum: ['verified', 'pending', 'rejected'], 
    default: 'pending' 
  },
  source: { 
    type: String, 
    default: 'override_engine' 
  }
}, { timestamps: true });

module.exports = mongoose.model('AcademicEvent', academicEventSchema);