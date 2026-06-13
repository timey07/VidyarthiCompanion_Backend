const express = require('express');
const router = express.Router();
const { pingLocation } = require('./presence.controller');

router.post('/ping', pingLocation);
module.exports = router;