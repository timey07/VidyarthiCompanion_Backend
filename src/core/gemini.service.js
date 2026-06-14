require('dotenv').config();
const merchantService = require('../modules/pocketBuddy/merchant.service');

/**
 * Shared Gemini integration for natural-language + vision parsing.
 *
 * Every function gracefully degrades when GEMINI_API_KEY is absent:
 *  - transaction parsing falls back to the local regex/keyword parser
 *  - image parsing reports that AI is unavailable so the UI can ask for manual entry
 *
 * This keeps the product fully functional in demos without a key, while using
 * real Gemini intelligence in production.
 */

const MODEL = 'gemini-2.5-flash';

const hasKey = () => Boolean(process.env.GEMINI_API_KEY);

/** Split a data URL into { mimeType, payload }. */
const splitDataUrl = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:(.*?);base64,(.*)$/s);
  return {
    mimeType: match ? match[1] : 'image/jpeg',
    payload: match ? match[2] : String(dataUrl || '').replace(/^data:[^,]*,/, ''),
  };
};

/**
 * Low-level call to Gemini generateContent. Returns parsed JSON (responseMimeType
 * is forced to application/json).
 * @param {Array} parts - Gemini content parts (text and/or inlineData).
 */
const callGeminiJSON = async (parts) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Gemini API request failed');
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty Gemini response');
  return JSON.parse(text);
};

/* ------------------------------ transactions ------------------------------- */

/**
 * Parse a raw payment SMS / notification string into structured fields and a
 * suggested category. Uses Gemini when available; otherwise the local parser.
 *
 * @returns {Promise<{amount:number|null, merchant:string|null, note:string|null,
 *   type:'debit'|'credit', inferredTag:string|null, via:'gemini'|'local'}>}
 */
const parseTransaction = async (raw) => {
  const local = merchantService.parseNotification(raw) || {};
  const localTag = merchantService.inferCategory(local.merchantRaw, local.note);

  if (!hasKey()) {
    return {
      amount: local.amount ?? null,
      merchant: local.merchantRaw ?? null,
      note: local.note ?? null,
      type: local.type || 'debit',
      inferredTag: localTag,
      via: 'local',
    };
  }

  try {
    const prompt = `You are a financial parser for an Indian student spending app.
Extract from the payment text below: amount (number, INR), merchant (string), note (string or null), and type ("debit" if money left the wallet, "credit" if received).
Also infer a single spending category ("inferred_tag") from this exact set: food, cafe, restaurant, grocery, stationery, transport, entertainment, recharge, general.
Output strictly as JSON: { "amount": number, "merchant": string, "note": string|null, "type": "debit"|"credit", "inferred_tag": string }.

Payment text: """${String(raw || '').slice(0, 500)}"""`;

    const out = await callGeminiJSON([{ text: prompt }]);
    const tag = merchantService.CATEGORIES.includes(out.inferred_tag)
      ? out.inferred_tag
      : merchantService.inferCategory(out.merchant, out.note) || localTag;

    return {
      amount: typeof out.amount === 'number' ? out.amount : local.amount ?? null,
      merchant: out.merchant || local.merchantRaw || null,
      note: out.note ?? local.note ?? null,
      type: out.type === 'credit' ? 'credit' : 'debit',
      inferredTag: tag && tag !== 'unknown' ? tag : null,
      via: 'gemini',
    };
  } catch (error) {
    console.error('Gemini parseTransaction failed, using local parser:', error.message);
    return {
      amount: local.amount ?? null,
      merchant: local.merchantRaw ?? null,
      note: local.note ?? null,
      type: local.type || 'debit',
      inferredTag: localTag,
      via: 'local',
    };
  }
};

/* -------------------------------- timetable -------------------------------- */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Parse an academic timetable image/PDF into structured slots.
 * @returns {Promise<{available:boolean, slots:Array, message?:string}>}
 *   slots: [{ day, subject, timeStart, timeEnd, room }]
 */
const parseTimetableImage = async (dataUrl) => {
  if (!hasKey()) {
    return {
      available: false,
      slots: [],
      message: 'AI parsing needs GEMINI_API_KEY. Add slots manually for now.',
    };
  }
  try {
    const { mimeType, payload } = splitDataUrl(dataUrl);
    const prompt = `Extract the weekly class timetable grid from this image.
Output strictly as JSON: { "slots": [ { "day": "Monday"|...|"Sunday", "subject": string, "timeStart": "HH:MM" (24h), "timeEnd": "HH:MM" (24h) or null, "room": string or null } ] }.
Only include slots actually present. Do not invent entries.`;
    const out = await callGeminiJSON([
      { text: prompt },
      { inlineData: { mimeType, data: payload } },
    ]);
    const slots = Array.isArray(out.slots)
      ? out.slots
          .filter((s) => s && s.subject && DAYS.includes(s.day))
          .map((s) => ({
            day: s.day,
            subject: String(s.subject).trim(),
            timeStart: s.timeStart || null,
            timeEnd: s.timeEnd || null,
            room: s.room || null,
          }))
      : [];
    return { available: true, slots };
  } catch (error) {
    console.error('Gemini parseTimetableImage failed:', error.message);
    return { available: false, slots: [], message: 'Could not parse the timetable. Try a clearer image.' };
  }
};

/* --------------------------------- menu ------------------------------------ */

/**
 * Parse a hostel mess menu board image into a day -> meals map.
 * @returns {Promise<{available:boolean, menu:object, message?:string}>}
 *   menu: { Monday: { breakfast, lunch, snacks, dinner }, ... }
 */
const parseMenuImage = async (dataUrl) => {
  if (!hasKey()) {
    return {
      available: false,
      menu: {},
      message: 'AI parsing needs GEMINI_API_KEY. Add the menu manually for now.',
    };
  }
  try {
    const { mimeType, payload } = splitDataUrl(dataUrl);
    const prompt = `Extract the weekly hostel mess menu from this image.
Output strictly as JSON: { "menu": { "Monday": { "breakfast": string, "lunch": string, "snacks": string, "dinner": string }, ... } }.
Use the day names Monday..Sunday. Leave a meal as an empty string if not shown. Do not invent dishes.`;
    const out = await callGeminiJSON([
      { text: prompt },
      { inlineData: { mimeType, data: payload } },
    ]);
    const menu = {};
    if (out.menu && typeof out.menu === 'object') {
      for (const day of DAYS) {
        const m = out.menu[day];
        if (m) {
          menu[day] = {
            breakfast: m.breakfast || '',
            lunch: m.lunch || '',
            snacks: m.snacks || '',
            dinner: m.dinner || '',
          };
        }
      }
    }
    return { available: true, menu };
  } catch (error) {
    console.error('Gemini parseMenuImage failed:', error.message);
    return { available: false, menu: {}, message: 'Could not parse the menu. Try a clearer image.' };
  }
};

module.exports = {
  hasKey,
  parseTransaction,
  parseTimetableImage,
  parseMenuImage,
  DAYS,
};
