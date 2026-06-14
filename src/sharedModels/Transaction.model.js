const mongoose = require('mongoose');

/**
 * A single PocketBuddy ledger entry. Ingested passively from a payment
 * notification / SMS / UPI alert (or a manual add), never hand-logged.
 * Keyed by the string userId like every other collection.
 */
const transactionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },

    // Human-friendly merchant label shown in the feed (resolved from the graph
    // when known, otherwise the raw recipient string).
    vendor: { type: String, default: 'Unknown' },

    // The raw, normalized recipient/merchant identifier as it appears in the
    // payment alert (e.g. "AMZNPAYVNDR992" or a UPI VPA). This is the key the
    // crowdsourced CampusMerchant graph is built on.
    merchantId: { type: String, default: null, index: true },

    amount: { type: Number, required: true }, // positive magnitude, in INR
    type: { type: String, enum: ['debit', 'credit'], default: 'debit' },

    // Crowdsourced spend category. 'unknown' means it still needs a tag.
    category: {
      type: String,
      enum: [
        'food',
        'cafe',
        'restaurant',
        'grocery',
        'stationery',
        'transport',
        'entertainment',
        'recharge',
        'general',
        'unknown',
      ],
      default: 'unknown',
    },

    balanceAfter: { type: Number, required: true }, // wallet balance after this txn
    note: { type: String }, // the payment "Add a note" field, used to infer tags

    // Where the ingest came from.
    source: {
      type: String,
      enum: ['notification', 'sms', 'upi', 'amazon_pay', 'manual'],
      default: 'amazon_pay',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
