const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const ConsensusVote = require('../../sharedModels/ConsensusVote.model');
const User = require('../../sharedModels/User.model');

// Trust-weighted thresholds. A single CR (trustScore 3) verifies an event;
// three independent students (1 each) do the same. Symmetric for rejection.
const VERIFY_THRESHOLD = 3;
const REJECT_THRESHOLD = -3;

/** Map a numeric consensus score to a lifecycle status. */
const promoteStatus = (score) => {
  if (score >= VERIFY_THRESHOLD) return 'verified';
  if (score <= REJECT_THRESHOLD) return 'rejected';
  return 'pending';
};

/** Look up a voter's trust weight (defaults to 1 for unknown users). */
const getTrustWeight = async (userId) => {
  const user = await User.findOne({ userId });
  return user?.trustScore ?? 1;
};

/** Aggregate raw echo/flag tallies for an event (head-count, not weighted). */
const getTallies = async (eventId) => {
  const votes = await ConsensusVote.find({ eventId }).select('voteType');
  const echoes = votes.filter((v) => v.voteType === 1).length;
  const flags = votes.filter((v) => v.voteType === -1).length;
  return { echoes, flags, totalVotes: votes.length };
};

/**
 * Apply (or change) a user's vote on an event, adjust the trust-weighted
 * consensusScore by an exact delta, and promote/demote the status.
 *
 * @returns {Promise<{event: object, tallies: object}|null>} null if event missing.
 */
const applyVote = async ({ eventId, userId, voteType }) => {
  const event = await AcademicEvent.findById(eventId);
  if (!event) return null;

  const weight = await getTrustWeight(userId);
  const existing = await ConsensusVote.findOne({ eventId, userId });

  let delta = 0;
  if (existing) {
    if (existing.voteType !== voteType) {
      // Reverse the old weighted vote, apply the new one.
      delta = voteType * weight - existing.voteType * existing.weight;
      existing.voteType = voteType;
      existing.weight = weight;
      await existing.save();
    }
    // Same vote again => idempotent, no change.
  } else {
    delta = voteType * weight;
    await ConsensusVote.create({ eventId, userId, voteType, weight });
  }

  if (delta !== 0) {
    event.consensusScore = Number((event.consensusScore + delta).toFixed(2));
    event.status = promoteStatus(event.consensusScore);
    await event.save();
  }

  const tallies = await getTallies(eventId);
  return { event, tallies };
};

/**
 * Seed an event's consensus with the creator's own (weighted) vouch.
 * A CR upload auto-verifies; a student upload starts pending until peers echo.
 * Mutates and saves the event; safe to call right after creation.
 */
const seedCreatorConsensus = async (event, creatorUserId) => {
  const weight = await getTrustWeight(creatorUserId);
  await ConsensusVote.create({
    eventId: event._id,
    userId: creatorUserId,
    voteType: 1,
    weight,
  });
  event.consensusScore = weight;
  event.status = promoteStatus(weight);
  await event.save();
  return event;
};

module.exports = {
  applyVote,
  seedCreatorConsensus,
  promoteStatus,
  getTallies,
  VERIFY_THRESHOLD,
  REJECT_THRESHOLD,
};
