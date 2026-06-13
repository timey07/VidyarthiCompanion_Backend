const express = require('express');
const router = express.Router();
const { submitVote } = require('./community.controller');

// POST /api/v1/community/vote
router.post('/vote', submitVote);

module.exports = router;