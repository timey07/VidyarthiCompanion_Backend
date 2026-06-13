const mongoose = require('mongoose');

const communityAlertSchema = new mongoose.Schema({
  alertId: { type: String, required: true, unique: true }, // e.g., 'event_mess_123'
  message: { type: String, required: true },
  nodeType: { type: String, required: true }, // e.g., 'Wellness Community'
  upvotes: { type: Number, default: 0 },
  downvotes: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'resolved', 'ignored'], default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('CommunityAlert', communityAlertSchema);