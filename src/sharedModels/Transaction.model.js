const mongoose = require('mongoose');

/**
 * A single PocketBuddy ledger entry (Amazon Pay sandbox + manual).
 * Keyed by the string userId like every other collection.
 */
const transactionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    vendor: { type: String, default: 'Unknown' },
    amount: { type: Number, required: true }, // positive magnitude, in INR
    type: { type: String, enum: ['debit', 'credit'], default: 'debit' },
    category: { type: String, default: 'general' }, // food | travel | general | ...
    balanceAfter: { type: Number, required: true }, // wallet balance after this txn
    note: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
