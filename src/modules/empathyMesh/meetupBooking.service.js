const Meetup = require('../../sharedModels/Meetup.model');

// A meetup is "active" (occupies the pair + shows on calendars) while proposed
// or accepted. Rejected/cancelled meetups are inert history.
const ACTIVE_STATUSES = ['proposed', 'accepted'];

/** "HH:MM" -> minutes from midnight (null if unparseable). */
const minutesOf = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/**
 * Resolve a slot ({ date, start, end }) into absolute start/end instants.
 * Uses the slot's day-start date plus its "HH:MM" times (server-local, matching
 * how free slots are computed in meetup.service.js). Returns null if invalid.
 */
const slotToDates = (slot) => {
  if (!slot || !slot.date) return null;
  const base = new Date(slot.date);
  if (Number.isNaN(base.getTime())) return null;
  const startMin = minutesOf(slot.start);
  const endMin = minutesOf(slot.end);
  if (startMin == null || endMin == null || endMin <= startMin) return null;

  const startAt = new Date(base);
  startAt.setHours(0, 0, 0, 0);
  startAt.setMinutes(startMin);
  const endAt = new Date(base);
  endAt.setHours(0, 0, 0, 0);
  endAt.setMinutes(endMin);
  return { startAt, endAt };
};

/** Whether a free-slot row corresponds to a meetup's booked slot. */
const slotMatchesMeetup = (slot, meetup) => {
  if (!slot || !meetup) return false;
  const sameDay =
    new Date(slot.date).toDateString() === new Date(meetup.slot.date).toDateString();
  return sameDay && slot.start === meetup.slot.start && slot.end === meetup.slot.end;
};

/** The single active meetup between two users (either direction), or null. */
const getActiveMeetupForPair = (userA, userB) =>
  Meetup.findOne({
    status: { $in: ACTIVE_STATUSES },
    $or: [
      { initiatorId: userA, targetId: userB },
      { initiatorId: userB, targetId: userA },
    ],
  });

/** All active meetups the user participates in. */
const getActiveMeetupsForUser = (userId) =>
  Meetup.find({
    status: { $in: ACTIVE_STATUSES },
    $or: [{ initiatorId: userId }, { targetId: userId }],
  });

/**
 * Viewer-relative DTO. `nameOf` is a Map(userId -> displayName) used to label
 * the other participant.
 */
const toMeetupDTO = (m, viewerId, nameOf = new Map()) => {
  const otherId = m.initiatorId === viewerId ? m.targetId : m.initiatorId;
  return {
    meetupId: m._id.toString(),
    nodeId: m.nodeId,
    initiatorId: m.initiatorId,
    targetId: m.targetId,
    proposedById: m.proposedById,
    pendingForId: m.pendingForId,
    status: m.status,
    slot: {
      date: m.slot.date,
      day: m.slot.day,
      dateLabel: m.slot.dateLabel,
      start: m.slot.start,
      end: m.slot.end,
      durationMin: m.slot.durationMin,
    },
    startAt: m.startAt,
    endAt: m.endAt,
    // Viewer-relative helpers for the client.
    otherUserId: otherId,
    otherName: nameOf.get(otherId) || otherId,
    iAmProposer: m.proposedById === viewerId,
    isPendingOnMe: m.pendingForId === viewerId,
  };
};

module.exports = {
  ACTIVE_STATUSES,
  slotToDates,
  slotMatchesMeetup,
  getActiveMeetupForPair,
  getActiveMeetupsForUser,
  toMeetupDTO,
};
