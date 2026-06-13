const express = require('express');
const router = express.Router();
const { verifyOverride } = require('./override.controller');

// POST /api/v1/overrides/verify
router.post('/verify', verifyOverride);

module.exports = router;