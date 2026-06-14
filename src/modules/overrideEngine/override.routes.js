const express = require('express');
const router = express.Router();
const { verifyOverride, createManualEvent } = require('./override.controller');

// POST /api/v1/overrides/verify  -> image / PDF / CSV / ICS via OCR
router.post('/verify', verifyOverride);

// POST /api/v1/overrides/manual  -> direct text entry with chosen date + time
router.post('/manual', createManualEvent);

module.exports = router;
