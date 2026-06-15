const mongoose = require('mongoose');

/**
 * A single member's verdict on one mess meal, on one day.
 *
 * Module 2 (Mess Community time-gated voting): members vote on the CURRENT
 * meal with a binary verdict — "eatable" (1) or "leave" (2). Votes are scoped
 * per community node, per local calendar day (dateKey = YYYY-MM-DD), and per
 * meal slot (breakfast / lunch / dinner). One vote per member per slot per day
 * (re-voting overwrites the previous verdict).
 *
 * The aggregate verdict feeds the PocketBuddy recommendation engine: a "leave"
 * majority flags the mess as poor and triggers an eat-outside / alt-meal card.
 */
const messMealVoteSchema = new mongoose.Schema(
  {
    nodeId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    // Local day key (YYYY-MM-DD) so a day's votes reset cleanly at midnight.
    dateKey: { type: String, required: true, index: true },
    slot: {
      type: String,
      enum: ['breakfast', 'lunch', 'dinner'],
      required: true,
    },
    // 'eatable' = the meal is fine; 'leave' = skip it (eat elsewhere).
    verdict: {
      type: String,
      enum: ['eatable', 'leave'],
      required: true,
    },
  },
  { timestamps: true }
);

// One vote per member, per node, per day, per meal slot.
messMealVoteSchema.index({ nodeId: 1, userId: 1, dateKey: 1, slot: 1 }, { unique: true });

module.exports = mongoose.model('MessMealVote', messMealVoteSchema);
