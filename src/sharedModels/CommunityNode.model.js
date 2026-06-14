const mongoose = require('mongoose');

/**
 * A CommunityNode is one social graph / shared space (a class section, gym
 * circle, mess community, ADHD support circle, etc.). Updates posted to a node
 * are visible to all its members, and the node owner (CR) carries extra
 * consensus weight in the trust graph.
 *
 * Three NATURES drive behaviour (the product USP):
 *  - accountability : task/schedule groups (class, mess, gym). Members don't
 *                     need to know each other, but updates must reach everyone.
 *                     Consensus voting is ENABLED here.
 *  - individuality  : confidential safe-spaces (ADHD, LGBTQ+). Raw shared data,
 *                     consensus voting is DISABLED (a "Zero-Telemetry Zone").
 *  - wellbeing      : silent listeners that receive anonymous Empathy Nudges
 *                     when a member's wellness score drops.
 *
 * VISIBILITY + JOIN POLICY control discovery and access:
 *  - public + open   : discoverable, anyone can join instantly.
 *  - public + locked : discoverable, joining requires owner approval.
 *  - private         : NOT discoverable, join only via invite code.
 *
 * Members are stored as string userIds to match the rest of the schema.
 */
const communityNodeSchema = new mongoose.Schema(
  {
    nodeId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },

    // The functional "type" tag (kept for backwards-compatible filtering / chips).
    nodeType: {
      type: String,
      enum: ['Academic', 'Empathy', 'Gym', 'Mess', 'Logistical', 'General'],
      default: 'General',
      index: true,
    },

    // The behavioural nature of the community (drives consensus + telemetry rules).
    nature: {
      type: String,
      enum: ['accountability', 'individuality', 'wellbeing'],
      default: 'accountability',
      index: true,
    },

    // Discovery model.
    visibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
      index: true,
    },

    // Access model for PUBLIC nodes ('open' = instant, 'locked' = needs approval).
    joinPolicy: {
      type: String,
      enum: ['open', 'locked'],
      default: 'open',
    },

    // The class representative / owner (extra trust weight in consensus + admin).
    crUserId: { type: String, default: null },

    members: { type: [String], default: [], index: true },

    // Pending join requests for PUBLIC + locked nodes (awaiting owner approval).
    pendingRequests: { type: [String], default: [] },

    // Secret deep-link code used to join PRIVATE nodes (invite-based access).
    inviteCode: { type: String, default: null, index: true },

    // Legacy rules object retained for backwards compatibility.
    nodeRules: {
      privacy: { type: String, enum: ['open', 'invite'], default: 'open' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CommunityNode', communityNodeSchema);
