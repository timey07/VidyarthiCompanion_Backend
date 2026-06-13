const express = require('express');
const router = express.Router();
const { logLifestyleMetric, evaluateSafeSkip } = require('./empathy.controller');

// POST /api/v1/empathy/log
router.post('/log', logLifestyleMetric);

// GET /api/v1/empathy/evaluate/:userId
router.get('/evaluate/:userId', evaluateSafeSkip);

module.exports = router;