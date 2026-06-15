const express = require('express');
const router = express.Router();
const { askVidyarthiCompanion } = require('./retrieval.controller');

// POST /api/v1/retrieval/ask
router.post('/ask', askVidyarthiCompanion);

module.exports = router;