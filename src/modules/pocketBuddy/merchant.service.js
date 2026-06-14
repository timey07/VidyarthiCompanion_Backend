/**
 * Merchant intelligence for PocketBuddy: parse raw payment alerts, normalize
 * merchant identifiers, and infer a spend category from free text.
 *
 * This is intentionally lightweight (regex + keyword intent matching) so it can
 * run on every ingested notification without an external AI call. The
 * crowdsourced CampusMerchant graph then layers community knowledge on top.
 */

const CATEGORIES = [
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
];

// Keyword -> category. First match wins (ordered most-specific first).
const CATEGORY_KEYWORDS = [
  { category: 'cafe', re: /\b(cafe|caf\u00e9|coffee|chai|tea|barista|starbucks|brew)\b/i },
  { category: 'restaurant', re: /\b(restaurant|dhaba|hotel|diner|biryani|pizza|burger|kfc|mcdonald|dominos|zomato|swiggy|eatery|kitchen|bhojan)\b/i },
  { category: 'grocery', re: /\b(grocery|kirana|mart|supermarket|bigbasket|blinkit|zepto|dmart|provision|vegetable|fruit)\b/i },
  { category: 'stationery', re: /\b(stationer\w*|xerox|photocopy|print|book ?shop|bookstore|notebook|pen|paper)\b/i },
  { category: 'transport', re: /\b(uber|ola|rapido|auto|cab|taxi|metro|bus|petrol|fuel|train|irctc|fare)\b/i },
  { category: 'recharge', re: /\b(recharge|airtel|jio|vodafone|vi|prepaid|data ?pack|dth|electricity|bill)\b/i },
  { category: 'entertainment', re: /\b(movie|cinema|pvr|inox|bookmyshow|netflix|spotify|game|gaming|concert)\b/i },
  { category: 'food', re: /\b(mess|canteen|tiffin|food|meal|thali|snack|samosa|maggi|juice)\b/i },
];

/**
 * Normalize a raw recipient/merchant string into a stable graph key.
 * Strips spaces and punctuation, uppercases. "amzn pay vndr-992" -> "AMZNPAYVNDR992".
 */
const normalizeMerchantId = (raw) =>
  String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9@.]/g, '')
    .slice(0, 64) || 'UNKNOWN';

/**
 * Pretty display name from a raw merchant string (Title Case, trimmed).
 */
const prettyName = (raw) => {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return 'Unknown merchant';
  return s
    .split(' ')
    .map((w) => (w.length > 3 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
};

/**
 * Infer a category from free text (merchant name + payment note).
 * @returns {string|null} a category, or null if nothing matched.
 */
const inferCategory = (...texts) => {
  const blob = texts.filter(Boolean).join(' ');
  if (!blob.trim()) return null;
  for (const { category, re } of CATEGORY_KEYWORDS) {
    if (re.test(blob)) return category;
  }
  return null;
};

/**
 * Best-effort parser for a raw payment notification / SMS string.
 * Extracts amount, a guess at the merchant, the note, and debit/credit.
 *
 * Handles common Indian UPI / Amazon Pay alert shapes, e.g.:
 *  "Paid Rs.150 to Campus Cafe via Amazon Pay UPI. Note: lunch"
 *  "INR 320.00 debited at AMZN-PAY-VNDR-992"
 *  "You received Rs 500 from Mom"
 */
const parseNotification = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;

  // Amount: ₹ / Rs / INR followed by a number (allow commas + decimals).
  const amountMatch = text.match(/(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;

  // Credit vs debit.
  const isCredit = /\b(received|credited|refund|added|cashback)\b/i.test(text);
  const type = isCredit ? 'credit' : 'debit';

  // Merchant: text after "to"/"at"/"towards"/"VPA". Uses a lookahead so the
  // trailing keyword/punctuation isn't consumed, and allows end-of-string.
  let merchantRaw = null;
  const merchantMatch =
    text.match(
      /\b(?:to|at|towards|paid to)\s+([A-Za-z0-9@.\-&][A-Za-z0-9@.\-&\s]{1,38}?)(?=\s+(?:via|on|using|ref|upi|for|note|remark|dated)\b|\s*[.,]|\s*$)/i
    ) ||
    text.match(/\bVPA[:\s]+([A-Za-z0-9@.\-]{3,40})/i) ||
    text.match(/\bfrom\s+([A-Za-z0-9@.\-&\s]{2,30}?)(?=\s+(?:via|on)\b|\s*[.,]|\s*$)/i);
  if (merchantMatch) merchantRaw = merchantMatch[1].trim();

  // Note: after "note", "remark", "for", or a trailing "- xyz".
  let note = null;
  const noteMatch =
    text.match(/\b(?:note|remark|remarks|message)[:\s]+([^.,\n]{1,60})/i) ||
    text.match(/\bfor\s+([a-z0-9 ]{3,40})(?:\.|,|$)/i);
  if (noteMatch) note = noteMatch[1].trim();

  return { amount, type, merchantRaw, note };
};

module.exports = {
  CATEGORIES,
  normalizeMerchantId,
  prettyName,
  inferCategory,
  parseNotification,
};
