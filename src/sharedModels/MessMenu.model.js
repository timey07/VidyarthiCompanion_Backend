const mongoose = require('mongoose');

/**
 * The official mess menu for a Mess community. Keyed by the community nodeId so
 * that when ONE member of "Hostel Block A" uploads the menu, every member of
 * that Accountability Group instantly sees it without re-uploading.
 *
 * `menu` is a day -> meals map, e.g. { Monday: { breakfast, lunch, snacks, dinner } }.
 */
const mealsSchema = new mongoose.Schema(
  {
    breakfast: { type: String, default: '' },
    lunch: { type: String, default: '' },
    snacks: { type: String, default: '' },
    dinner: { type: String, default: '' },
  },
  { _id: false }
);

const messMenuSchema = new mongoose.Schema(
  {
    nodeId: { type: String, required: true, unique: true, index: true },
    uploadedBy: { type: String, default: null },
    menu: {
      type: Map,
      of: mealsSchema,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MessMenu', messMenuSchema);
