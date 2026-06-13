const express = require('express');
const router = express.Router();
const { processTransaction } = require('./pocket.controller');

// POST /api/v1/pocket/webhook
router.post('/webhook', processTransaction);

module.exports = router;