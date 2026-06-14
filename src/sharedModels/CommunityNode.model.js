const mongoose = require('mongoose');

/**
 * A CommunityNode is one social graph / shared space (a class section, gym
 * circle, mess community, carpool, etc.). Events posted to a node are visible
 * to all members, and the node's CR carries extra consensus weight.
 *
 * Members are stored as string userIds to match the rest of the schema.
 */
const communityNodeSchema = new mongoose.Schema(
  {
    nodeId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    nodeType: {
      type: String,
      enum: ['Academic', 'Empathy', 'Gym', 'Mess', 'Logistical', 'General'],
      default: 'General',
      index: true,
    },
    // The class representative / owner (extra trust weight in consensus).
    crUserId: { type: String, default: null },
    members: { type: [String], default: [], index: true },
    nodeRules: {
      privacy: { type: String, enum: ['open', 'invite'], default: 'open' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CommunityNode', communityNodeSchema);
