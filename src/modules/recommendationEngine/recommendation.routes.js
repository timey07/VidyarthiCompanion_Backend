const express = require('express');
const router = express.Router();
const { getSynergies } = require('./recommendation.controller');

// GET /api/v1/recommendations/synergies
router.get('/synergies', getSynergies);

module.exports = router;
