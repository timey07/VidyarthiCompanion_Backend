const AcademicEvent = require('../../sharedModels/AcademicEvent.model');
const ConsensusVote = require('../../sharedModels/ConsensusVote.model');

/**
 * Simple majority consensus (raw head-count, not trust-weighted):
 *  - more echoes than flags  -> 'verified' (flows to Dashboard + Master Calendar)
 *  - more flags than echoes   -> 'rejected' (stays in the community feed only)
 *  - tie                      -> 'pending'  (stays in the community feed only)
 *
 * Only 'verified' updates ever reach the dashboard / master calendar.
 */
const computeStatus = (echoes, flags) => {
  if (echoes > flags) return 'verified';
  if (flags > echoes) return 'rejected';
  return 'pending';
};

/** Aggregate raw echo/flag tallies for an event. */
const getTallies = async (eventId) => {
  const votes = await ConsensusVote.find({ eventId }).select('voteType');
  const echoes = votes.filter((v) => v.voteType === 1).length;
  const flags = votes.filter((v) => v.voteType === -1).length;
  return { echoes, flags, totalVotes: votes.length };
};

/** Recompute an event's net score + status from its current votes and save. */
const recomputeEvent = async (event) => {
  const tallies = await getTallies(event._id);
  event.consensusScore = tallies.echoes - tallies.flags;
  event.status = computeStatus(tallies.echoes, tallies.flags);
  await event.save();
  return tallies;
};

/**
 * Apply (or change) a user's vote on an event, then recompute the net score
 * and majority status.
 *
 * @returns {Promise<{event: object, tallies: object}|null>} null if event missing.
 */
const applyVote = async ({ eventId, userId, voteType }) => {
  const event = await AcademicEvent.findById(eventId);
  if (!event) return null;

  const existing = await ConsensusVote.findOne({ eventId, userId });
  if (existing) {
    if (existing.voteType !== voteType) {
      existing.voteType = voteType;
      await existing.save();
    }
    // Same vote again => idempotent.
  } else {
    await ConsensusVote.create({ eventId, userId, voteType, weight: 1 });
  }

  const tallies = await recomputeEvent(event);
  return { event, tallies };
};

/**
 * Seed an event's consensus with the creator's own echo. A single upvote
 * (and no flags) means echoes > flags, so a freshly-posted update is verified
 * and reaches the calendar immediately — until peers flag it back down.
 * Mutates and saves the event; safe to call right after creation.
 */
const seedCreatorConsensus = async (event, creatorUserId) => {
  await ConsensusVote.create({
    eventId: event._id,
    userId: creatorUserId,
    voteType: 1,
    weight: 1,
  });
  await recomputeEvent(event);
  return event;
};

const normalize = (s) => String(s || '').trim().toLowerCase();

/**
 * Find an existing event that represents the SAME real-world entry as the
 * incoming one (same name + location + start minute, within the same scope).
 *  - Node-shared events match across users (so two members uploading the same
 *    class collapse into one shared event).
 *  - Personal events (no node) match only within the same user (privacy).
 */
const findDuplicate = async ({ userId, nodeId, eventName, date, location }) => {
  const minuteStart = new Date(date);
  minuteStart.setSeconds(0, 0);
  const minuteEnd = new Date(minuteStart);
  minuteEnd.setMinutes(minuteEnd.getMinutes() + 1);

  const query = { date: { $gte: minuteStart, $lt: minuteEnd } };
  if (nodeId) query.nodeId = nodeId;
  else {
    query.nodeId = null;
    query.userId = userId;
  }

  const candidates = await AcademicEvent.find(query);
  return (
    candidates.find(
      (e) => normalize(e.eventName) === normalize(eventName) && normalize(e.location) === normalize(location)
    ) || null
  );
};

/**
 * Create an event, or de-duplicate against an existing identical one:
 *  - new entry            -> create + seed the creator's echo
 *  - duplicate, new voter  -> echo it (consensus goes UP)
 *  - duplicate, same voter -> no change (idempotent)
 *
 * @returns {Promise<{event, status: 'created'|'merged'|'unchanged'}>}
 */
const upsertEvent = async ({ userId, nodeId, eventName, date, location, confidenceScore, category }) => {
  const dup = await findDuplicate({ userId, nodeId, eventName, date, location });

  if (dup) {
    const alreadyVoted = await ConsensusVote.findOne({ eventId: dup._id, userId });
    if (alreadyVoted) {
      return { event: dup, status: 'unchanged' };
    }
    const result = await applyVote({ eventId: dup._id.toString(), userId, voteType: 1 });
    return { event: result.event, status: 'merged' };
  }

  const created = await AcademicEvent.create({
    userId,
    nodeId: nodeId || null,
    eventName,
    date,
    location,
    confidenceScore: confidenceScore ?? 0.5,
    category: category === 'deadline' ? 'deadline' : 'alert',
  });
  await seedCreatorConsensus(created, userId);
  return { event: created, status: 'created' };
};

module.exports = {
  applyVote,
  seedCreatorConsensus,
  upsertEvent,
  computeStatus,
  getTallies,
};
