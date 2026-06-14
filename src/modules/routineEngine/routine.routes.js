const express = require('express');
const router = express.Router();
const { getDailyPlan } = require('./routine.controller');

// GET /api/v1/routine/today -> prioritized daily plan (events + wellbeing + budget)
router.get('/today', getDailyPlan);

module.exports = router;
