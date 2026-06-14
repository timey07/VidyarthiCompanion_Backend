const mongoose = require('mongoose');

/**
 * The crowdsourced Campus Merchant Graph.
 *
 * Each document is one real-world vendor keyed by its normalized merchant id
 * (the raw recipient string from a payment alert, e.g. "AMZNPAYVNDR992" or a
 * UPI VPA). The first time anyone pays a vendor it is created as 'unknown';
 * once ONE student tags it (or a note auto-infers it), every other student who
 * pays that same vendor is silently auto-categorized. The campus collaboratively
 * maps the local economy without anyone realising it.
 */
const campusMerchantSchema = new mongoose.Schema(
  {
    merchantId: { type: String, required: true, unique: true, index: true },

    // Best-known display name (improves as students tag it).
    displayName: { type: String, default: '' },

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
      index: true,
    },

    // How the current category was set:
    //  - 'user_tag' : a student explicitly tagged it (authoritative, locked)
    //  - 'auto'     : inferred from a payment note / merchant text
    //  - 'unknown'  : never categorized
    categorySource: {
      type: String,
      enum: ['user_tag', 'auto', 'unknown'],
      default: 'unknown',
    },

    // First student to tag it (credit for the crowdsource contribution).
    taggedBy: { type: String, default: null },

    // How many distinct confirmations the current category has (trust signal).
    confirmations: { type: Number, default: 0 },

    // Campus-wide popularity: how many transactions have hit this vendor.
    txnCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CampusMerchant', campusMerchantSchema);
