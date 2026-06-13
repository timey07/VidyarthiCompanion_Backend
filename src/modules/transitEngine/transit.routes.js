const express = require('express');
const router = express.Router();
const { calculateDeparture } = require('./transit.controller');

// POST /api/v1/transit/calculate
router.post('/calculate', calculateDeparture);

module.exports = router;