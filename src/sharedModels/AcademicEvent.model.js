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
  // Override-engine classification of the source: an actionable "deadline"
  // (submission / due date / exam) vs an informational "alert" (notice,
  // announcement, or scheduled happening). Every ingested item is one or the other.
  category: {
    type: String,
    enum: ['alert', 'deadline'],
    default: 'alert',
    index: true,
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