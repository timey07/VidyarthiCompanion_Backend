const express = require('express');
const router = express.Router();
const {
  getProfile,
  updateFinancial,
  parseDocument,
  saveSchedule,
  getSchedule,
  saveMenu,
  getMenu,
} = require('./profile.controller');

// GET  /api/v1/profile               -> full profile (financial, communities, schedule, menu)
router.get('/', getProfile);

// PUT  /api/v1/profile/financial     -> monthly budget, safe buffer, primary communities
router.put('/financial', updateFinancial);

// POST /api/v1/profile/parse-document -> Gemini parse (timetable | menu), returns JSON to verify
router.post('/parse-document', parseDocument);

// Academic baseline (class schedule)
router.get('/schedule', getSchedule);
router.post('/schedule', saveSchedule);

// Mess menu (shared per community)
router.get('/menu', getMenu);
router.post('/menu', saveMenu);

module.exports = router;
