const mongoose = require('mongoose');

/**
 * User is the identity + profile hub for CampusFlow.
 *
 * Scalability note: every telemetry/event collection (AcademicEvent, LifestyleLog,
 * AttendanceRecord, ConsensusVote, ...) keys off a STRING `userId`. We keep that
 * contract intact here so the User document is the single source of truth without
 * forcing an ObjectId migration across the existing collections. `userId` is a
 * stable, unique, indexed public handle; Mongo's own `_id` stays internal.
 */
const userSchema = new mongoose.Schema(
  {
    // Stable cross-collection foreign key used by every other model.
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // never returned by default queries
    },
    // Drives trust-weighted community consensus. A CR/admin carries more weight.
    role: {
      type: String,
      enum: ['student', 'cr', 'admin'],
      default: 'student',
      index: true,
    },
    // Multiplier applied to this user's votes in the consensus engine.
    trustScore: {
      type: Number,
      default: 1.0,
      min: 0,
    },
    // Community graph membership (Academic, Empathy, Gym, Mess, Logistical, ...).
    communityNodeIds: {
      type: [String],
      default: [],
    },
    // India-centric financial profile (PocketBuddy x Amazon Pay).
    financialConfig: {
      monthlyBudget: { type: Number, default: 8000 }, // INR
      amazonPayBalance: { type: Number, default: 2000 }, // INR
      currency: { type: String, default: 'INR' },
    },
    // Personalisation thresholds for the Empathy Mesh / routine engine.
    wellnessThresholds: {
      minSleepHours: { type: Number, default: 6 },
      burnoutSkipThreshold: { type: Number, default: 7.0 },
    },
    // e.g. ['adhd'] — used for pacing/niche alert behaviour later.
    neurodivergentTags: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

/**
 * Safe public projection (never leaks passwordHash).
 */
userSchema.methods.toPublicJSON = function () {
  return {
    userId: this.userId,
    name: this.name,
    email: this.email,
    role: this.role,
    trustScore: this.trustScore,
    communityNodeIds: this.communityNodeIds,
    financialConfig: this.financialConfig,
    wellnessThresholds: this.wellnessThresholds,
    neurodivergentTags: this.neurodivergentTags,
  };
};

module.exports = mongoose.model('User', userSchema);
