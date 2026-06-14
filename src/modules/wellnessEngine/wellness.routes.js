const express = require('express');
const router = express.Router();
const { getSummary, logSleep } = require('./wellness.controller');

// GET /api/v1/wellness/summary  -> tiredness, isolation, overall burnout scores
router.get('/summary', getSummary);

// POST /api/v1/wellness/sleep   -> log the nightly sleep-cycle dropdown value
router.post('/sleep', logSleep);

module.exports = router;
