const mongoose = require('mongoose');

/**
 * One vote per user per academic event (the "Fast-Write Log").
 * Lightweight and uniquely constrained so a user cannot double-count;
 * re-voting updates the existing document.
 *
 * `weight` snapshots the voter's trustScore at vote time so the parent
 * event's consensusScore can be adjusted by exact deltas on vote changes.
 */
const consensusVoteSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicEvent',
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    voteType: { type: Number, enum: [1, -1], required: true }, // Echo / Flag
    weight: { type: Number, default: 1 },
  },
  { timestamps: true }
);

// A user has at most one vote per event.
consensusVoteSchema.index({ eventId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ConsensusVote', consensusVoteSchema);
