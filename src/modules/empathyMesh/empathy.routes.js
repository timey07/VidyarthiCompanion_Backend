const express = require('express');
const router = express.Router();
const { logLifestyleMetric, evaluateSafeSkip } = require('./empathy.controller');

// POST /api/v1/empathy/log
router.post('/log', logLifestyleMetric);

// GET /api/v1/empathy/evaluate
router.get('/evaluate', evaluateSafeSkip);

module.exports = router;