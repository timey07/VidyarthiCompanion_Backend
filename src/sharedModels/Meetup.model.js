const mongoose = require('mongoose');

/**
 * A scheduled "Meet Up" between two members of an Empathy Mesh (wellbeing)
 * community. Born from the burnout reach-out flow: a member (initiator) opens
 * a struggling member's (target) Meet Up free-slots and books one.
 *
 * Lifecycle (tentative -> confirmed):
 *   proposed  : a time has been put forward; pendingForId must respond.
 *   accepted  : the other side accepted -> confirmed on both calendars.
 *   rejected  : the other side declined.
 *   cancelled : a participant cancelled the (still-tentative) meetup.
 *
 * "Change time" is modelled symmetrically: the responder re-proposes a new
 * slot, which flips proposedById/pendingForId so the original initiator now
 * has to accept/reject/re-propose. Either side can therefore drive the time.
 */
const slotSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true }, // day start (00:00) of the slot
    day: { type: String, default: '' },
    dateLabel: { type: String, default: '' },
    start: { type: String, required: true }, // "HH:MM"
    end: { type: String, required: true }, // "HH:MM"
    durationMin: { type: Number, default: 0 },
  },
  { _id: false }
);

const meetupSchema = new mongoose.Schema(
  {
    nodeId: { type: String, required: true, index: true },
    // Who first scheduled the meetup (the reaching-out friend).
    initiatorId: { type: String, required: true, index: true },
    // The other participant (typically the burnt-out member being checked in on).
    targetId: { type: String, required: true, index: true },
    // Who proposed the CURRENT time, and who must respond to it next.
    proposedById: { type: String, required: true },
    pendingForId: { type: String, default: null, index: true },

    slot: { type: slotSchema, required: true },
    // Absolute instants derived from the slot, for calendar placement + ordering.
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },

    status: {
      type: String,
      enum: ['proposed', 'accepted', 'rejected', 'cancelled'],
      default: 'proposed',
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Meetup', meetupSchema);
