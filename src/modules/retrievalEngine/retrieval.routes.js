const express = require('express');
const router = express.Router();
const { askCampusFlow } = require('./retrieval.controller');

// POST /api/v1/retrieval/ask
router.post('/ask', askCampusFlow);

module.exports = router;