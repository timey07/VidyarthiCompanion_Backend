const express = require('express');
const router = express.Router();
const { submitVote, listScheduleEvents, submitEventVote } = require('./community.controller');

// POST /api/v1/community/vote          -> vote on a community alert (e.g. mess)
router.post('/vote', submitVote);

// GET  /api/v1/community/events        -> schedule feed with consensus state
router.get('/events', listScheduleEvents);

// POST /api/v1/community/events/vote   -> trust-weighted consensus vote on an event
router.post('/events/vote', submitEventVote);

module.exports = router;
