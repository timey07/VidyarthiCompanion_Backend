const express = require('express');
const router = express.Router();
const { register, login, me } = require('./auth.controller');
const { protect } = require('../../core/authMiddleware');

// POST /api/v1/auth/register
router.post('/register', register);

// POST /api/v1/auth/login
router.post('/login', login);

// GET /api/v1/auth/me
router.get('/me', protect, me);

module.exports = router;
